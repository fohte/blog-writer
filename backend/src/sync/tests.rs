use std::{collections::HashMap, error::Error, time::Duration};

use axum::Router;
use futures_util::{SinkExt, StreamExt};
use sqlx::{AnyPool, ConnectOptions, postgres::PgPool, sqlite::SqlitePool};
use tokio::{net::TcpListener, task::JoinHandle, time::timeout};
use tokio_tungstenite::{WebSocketStream, connect_async, tungstenite::Message as ClientMessage};
use yrs::{
    Doc, GetString, ReadTxn, Transact, Update,
    sync::{Awareness, AwarenessUpdate, Message as YMessage, SyncMessage},
    types::Text,
    updates::decoder::Decode,
};

use crate::{
    app::{AppState, router},
    db,
    host_origin::HostOriginPolicy,
    sync::{SyncService, protocol},
};

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;
type Client = WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

struct TestServer {
    url: String,
    task: JoinHandle<()>,
    sync: SyncService,
}

async fn start_server(pool: AnyPool) -> TestResult<TestServer> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let host = address.to_string();
    let state = AppState::new(None, Some(pool))?;
    let sync = state
        .sync
        .clone()
        .ok_or("test server has no sync service")?;
    let policy = HostOriginPolicy::new(vec![host.clone()], Vec::new());
    let app: Router = router(state, policy);
    let task = tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            tracing::error!(%error, "test server failed");
        }
    });

    Ok(TestServer {
        url: format!("ws://{host}/api/sync"),
        task,
        sync,
    })
}

async fn open_client(server: &TestServer, doc_id: &str) -> TestResult<(Client, Doc)> {
    let (mut client, _) = connect_async(format!("{}/{doc_id}", server.url)).await?;
    let start = protocol::decode_messages(&receive_binary(&mut client).await?)?
        .into_iter()
        .map(|message| match message {
            YMessage::Sync(SyncMessage::SyncStep1(_)) => "sync-step-1",
            YMessage::Awareness(_) => "awareness",
            YMessage::Sync(SyncMessage::SyncStep2(_)) => "sync-step-2",
            YMessage::Sync(SyncMessage::Update(_)) => "update",
            YMessage::Auth(_) => "auth",
            YMessage::AwarenessQuery => "awareness-query",
            YMessage::Custom(_, _) => "custom",
        })
        .collect::<Vec<_>>();
    assert_eq!(start, ["sync-step-1", "awareness"]);
    let mut doc = Doc::new();
    let state_vector = doc.transact().state_vector();
    client
        .send(ClientMessage::Binary(
            protocol::encode_message(&yrs::sync::Message::Sync(
                yrs::sync::SyncMessage::SyncStep1(state_vector),
            ))
            .into(),
        ))
        .await?;
    let frame = receive_binary(&mut client).await?;
    apply_frame(&mut doc, &frame)?;
    Ok((client, doc))
}

async fn receive_binary(client: &mut Client) -> TestResult<Vec<u8>> {
    loop {
        let message = timeout(Duration::from_secs(5), client.next())
            .await?
            .ok_or("WebSocket closed before a binary frame arrived")??;
        if let ClientMessage::Binary(data) = message {
            return Ok(data.to_vec());
        }
    }
}

fn apply_frame(doc: &mut Doc, frame: &[u8]) -> TestResult {
    for message in protocol::decode_messages(frame)? {
        if let yrs::sync::Message::Sync(
            yrs::sync::SyncMessage::SyncStep2(update) | yrs::sync::SyncMessage::Update(update),
        ) = message
        {
            doc.transact_mut()
                .apply_update(Update::decode_v1(&update)?)?;
        }
    }
    Ok(())
}

fn create_text_update(doc: &Doc, index: u32, value: &str) -> Vec<u8> {
    let state_vector = doc.transact().state_vector();
    let text = doc.get_or_insert_text("body");
    text.insert(&mut doc.transact_mut(), index, value);
    doc.transact().encode_state_as_update_v1(&state_vector)
}

fn text_value(doc: &Doc) -> String {
    let text = doc.get_or_insert_text("body");
    text.get_string(&doc.transact())
}

async fn send_update(client: &mut Client, update: Vec<u8>) -> TestResult {
    let frame = protocol::encode_message(&yrs::sync::Message::Sync(
        yrs::sync::SyncMessage::Update(update),
    ));
    client.send(ClientMessage::Binary(frame.into())).await?;
    let _acknowledgement = receive_binary(client).await?;
    Ok(())
}

async fn connect_and_edit_twice(pool: AnyPool) -> TestResult {
    let server = start_server(pool).await?;
    let (mut first, mut first_doc) = open_client(&server, "shared-document").await?;
    let (mut second, mut second_doc) = open_client(&server, "shared-document").await?;

    let mut awareness = Awareness::new(first_doc.clone());
    awareness.set_local_state_raw(r#"{"user":"writer"}"#);
    let awareness_update = awareness.update()?;
    let awareness_message = YMessage::Awareness(awareness_update.clone());
    let awareness_frame = protocol::encode_message(&awareness_message);
    first
        .send(ClientMessage::Binary(awareness_frame.clone().into()))
        .await?;
    let second_awareness = receive_binary(&mut second).await?;
    let first_awareness = receive_binary(&mut first).await?;
    assert_eq!(
        (
            protocol::decode_messages(&second_awareness)?,
            protocol::decode_messages(&first_awareness)?,
        ),
        (vec![awareness_message.clone()], vec![awareness_message]),
    );

    let first_update = create_text_update(&first_doc, 0, "first");
    send_update(&mut first, first_update).await?;
    apply_frame(&mut second_doc, &receive_binary(&mut second).await?)?;

    let second_update = create_text_update(&second_doc, 5, " second");
    send_update(&mut second, second_update).await?;
    timeout(Duration::from_secs(5), async {
        while text_value(&first_doc) != "first second" {
            apply_frame(&mut first_doc, &receive_binary(&mut first).await?)?;
        }
        TestResult::Ok(())
    })
    .await??;

    assert_eq!(
        (text_value(&first_doc), text_value(&second_doc)),
        ("first second".to_owned(), "first second".to_owned()),
    );
    first.close(None).await?;
    let removal_frame = receive_binary(&mut second).await?;
    let removal_messages = protocol::decode_messages(&removal_frame)?;
    let client_id = awareness.client_id();
    let previous_clock = awareness_update
        .clients
        .get(&client_id)
        .ok_or("awareness client id missing from update")?
        .clock;
    assert_eq!(
        removal_messages,
        vec![YMessage::Awareness(AwarenessUpdate {
            clients: HashMap::from([(
                client_id,
                yrs::sync::awareness::AwarenessUpdateEntry {
                    clock: previous_clock + 1,
                    json: "null".into(),
                },
            )]),
        })],
    );
    second.close(None).await?;
    server.task.abort();
    Ok(())
}

async fn survives_restart_and_compacts(pool: AnyPool) -> TestResult {
    let server = start_server(pool.clone()).await?;
    let (mut client, doc) = open_client(&server, "persistent-document").await?;
    send_update(&mut client, create_text_update(&doc, 0, "one")).await?;
    send_update(&mut client, create_text_update(&doc, 3, " two")).await?;
    client.close(None).await?;
    drop(client);
    drop(doc);
    server.task.abort();

    let restarted = start_server(pool.clone()).await?;
    let (mut client, doc) = open_client(&restarted, "persistent-document").await?;
    let query = if pool.connect_options().to_url_lossy().scheme() == "sqlite" {
        "SELECT COUNT(*) FROM sync_updates WHERE doc_id = ?1"
    } else {
        "SELECT COUNT(*) FROM sync_updates WHERE doc_id = $1"
    };
    let rows = sqlx::query_scalar::<_, i64>(query)
        .bind("persistent-document")
        .fetch_one(&pool)
        .await?;

    assert_eq!((text_value(&doc), rows), ("one two".to_owned(), 1));
    client.close(None).await?;
    restarted.task.abort();
    Ok(())
}

async fn forwards_server_side_updates(pool: AnyPool) -> TestResult {
    let server = start_server(pool).await?;
    let (mut client, mut client_doc) = open_client(&server, "server-written-document").await?;
    let document = server.sync.open_document("server-written-document").await?;
    let mut updates = document.subscribe_updates();
    let server_doc = Doc::new();
    server_doc
        .transact_mut()
        .apply_update(Update::decode_v1(&document.encode_state().await)?)?;
    let update = create_text_update(&server_doc, 0, "server edit");
    document.apply_update(&update).await?;
    let published = updates.recv().await?;
    apply_frame(&mut client_doc, &receive_binary(&mut client).await?)?;

    assert_eq!(
        (published, text_value(&client_doc)),
        (update, "server edit".to_owned()),
    );
    client.close(None).await?;
    server.task.abort();
    Ok(())
}

async fn any_pool(url: &str) -> TestResult<AnyPool> {
    Ok(db::initialize(Some(url)).await?)
}

#[tokio::test]
async fn rejects_websocket_when_sync_is_not_configured() -> TestResult {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let host = address.to_string();
    let policy = HostOriginPolicy::new(vec![host], Vec::new());
    let app: Router = router(AppState::default(), policy);
    let task = tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            tracing::error!(%error, "test server failed");
        }
    });
    let response = match connect_async(format!("ws://{address}/api/sync/sample-document")).await {
        Ok(_) => return Err("unexpected WebSocket upgrade".into()),
        Err(tokio_tungstenite::tungstenite::Error::Http(response)) => response,
        Err(error) => return Err(error.into()),
    };
    let actual = (response.status().as_u16(), response.body().clone());
    task.abort();

    assert_eq!(
        actual,
        (
            503,
            Some(br#"{"error":"Synchronization is not configured"}"#.to_vec()),
        ),
    );
    Ok(())
}

#[sqlx::test]
async fn synchronizes_two_websocket_clients_over_postgres(pool: PgPool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    connect_and_edit_twice(any_pool(&url).await?).await
}

#[sqlx::test]
async fn synchronizes_two_websocket_clients_over_sqlite(pool: SqlitePool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    connect_and_edit_twice(any_pool(&url).await?).await
}

#[sqlx::test]
async fn restores_and_compacts_after_postgres_restart(pool: PgPool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    survives_restart_and_compacts(any_pool(&url).await?).await
}

#[sqlx::test]
async fn restores_and_compacts_after_sqlite_restart(pool: SqlitePool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    survives_restart_and_compacts(any_pool(&url).await?).await
}

#[sqlx::test]
async fn broadcasts_server_side_updates_from_postgres(pool: PgPool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    forwards_server_side_updates(any_pool(&url).await?).await
}

#[sqlx::test]
async fn broadcasts_server_side_updates_from_sqlite(pool: SqlitePool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    forwards_server_side_updates(any_pool(&url).await?).await
}

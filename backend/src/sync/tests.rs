use std::{collections::HashMap, error::Error, time::Duration};

use axum::Router;
use futures_util::{SinkExt, StreamExt};
use sqlx::{AnyPool, ConnectOptions, postgres::PgPool, sqlite::SqlitePool};
use tokio::{net::TcpListener, task::JoinHandle, time::timeout};
use tokio_tungstenite::{WebSocketStream, connect_async, tungstenite::Message as ClientMessage};
use yrs::{
    Array, ArrayPrelim, Doc, GetString, ReadTxn, StateVector, Transact, Update,
    sync::{Awareness, AwarenessUpdate, Message as YMessage, SyncMessage},
    types::{Text, ToJson},
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
    let (client, doc, _) = open_client_with_startup_frames(server, doc_id).await?;
    Ok((client, doc))
}

async fn open_client_with_startup_frames(
    server: &TestServer,
    doc_id: &str,
) -> TestResult<(Client, Doc, Vec<Vec<u8>>)> {
    let (mut client, _) = connect_async(format!("{}/{doc_id}", server.url)).await?;
    let startup_frames = vec![
        receive_binary(&mut client).await?,
        receive_binary(&mut client).await?,
    ];
    let start = describe_frames(&startup_frames)?;
    assert_eq!(start, vec![vec!["sync-step-1"], vec!["awareness"]]);
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
    Ok((client, doc, startup_frames))
}

fn message_kind(message: &YMessage) -> &'static str {
    match message {
        YMessage::Sync(SyncMessage::SyncStep1(_)) => "sync-step-1",
        YMessage::Awareness(_) => "awareness",
        YMessage::Sync(SyncMessage::SyncStep2(_)) => "sync-step-2",
        YMessage::Sync(SyncMessage::Update(_)) => "update",
        YMessage::Auth(_) => "auth",
        YMessage::AwarenessQuery => "awareness-query",
        YMessage::Custom(_, _) => "custom",
    }
}

fn describe_frame(frame: &[u8]) -> TestResult<Vec<&'static str>> {
    Ok(protocol::decode_messages(frame)?
        .iter()
        .map(message_kind)
        .collect())
}

fn describe_frames(frames: &[Vec<u8>]) -> TestResult<Vec<Vec<&'static str>>> {
    frames.iter().map(|frame| describe_frame(frame)).collect()
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

fn updates_with_invalid_parent() -> (Vec<u8>, Vec<u8>) {
    let primitive_doc = Doc::with_client_id(41);
    let items = primitive_doc.get_or_insert_array("items");
    items.insert(&mut primitive_doc.transact_mut(), 0, "scalar");
    let primitive_update = primitive_doc
        .transact()
        .encode_state_as_update_v1(&StateVector::default());

    let nested_doc = Doc::with_client_id(41);
    let items = nested_doc.get_or_insert_array("items");
    let nested = items.insert(&mut nested_doc.transact_mut(), 0, ArrayPrelim::default());
    nested.insert(&mut nested_doc.transact_mut(), 0, "nested");
    let invalid_update = nested_doc
        .transact()
        .encode_state_as_update_v1(&StateVector::default());

    (primitive_update, invalid_update)
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

async fn send_empty_update(client: &mut Client, doc: &Doc) -> TestResult {
    let empty_update = protocol::encode_message(&YMessage::Sync(SyncMessage::SyncStep2(
        Update::EMPTY_V1.to_vec(),
    )));
    client
        .send(ClientMessage::Binary(empty_update.into()))
        .await?;

    let sync_request = protocol::encode_message(&YMessage::Sync(SyncMessage::SyncStep1(
        doc.transact().state_vector(),
    )));
    client
        .send(ClientMessage::Binary(sync_request.into()))
        .await?;
    let _response = receive_binary(client).await?;
    Ok(())
}

async fn publish_awareness(client: &mut Client, doc: &Doc) -> TestResult<AwarenessUpdate> {
    let mut awareness = Awareness::new(doc.clone());
    awareness.set_local_state_raw(r#"{"user":"writer"}"#);
    let update = awareness.update()?;
    let frame = protocol::encode_message(&YMessage::Awareness(update.clone()));
    client.send(ClientMessage::Binary(frame.into())).await?;
    let _broadcast = receive_binary(client).await?;
    Ok(update)
}

async fn connect_and_edit_twice(pool: AnyPool) -> TestResult {
    let server = start_server(pool).await?;
    let (mut first, mut first_doc) = open_client(&server, "shared-document").await?;
    let (mut second, mut second_doc) = open_client(&server, "shared-document").await?;

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
    second.close(None).await?;
    server.task.abort();
    Ok(())
}

async fn sends_existing_awareness_to_late_joiners(pool: AnyPool) -> TestResult {
    let server = start_server(pool).await?;
    let (mut first, first_doc) = open_client(&server, "awareness-document").await?;
    let awareness_update = publish_awareness(&mut first, &first_doc).await?;
    let (mut second, _, startup_frames) =
        open_client_with_startup_frames(&server, "awareness-document").await?;

    assert_eq!(
        protocol::decode_messages(&startup_frames[1])?,
        vec![YMessage::Awareness(awareness_update)],
    );
    second.close(None).await?;
    first.close(None).await?;
    server.task.abort();
    Ok(())
}

async fn broadcasts_and_removes_awareness(pool: AnyPool) -> TestResult {
    let server = start_server(pool).await?;
    let (mut first, first_doc) = open_client(&server, "awareness-document").await?;
    let (mut second, _) = open_client(&server, "awareness-document").await?;
    let awareness_update = publish_awareness(&mut first, &first_doc).await?;
    let second_awareness = protocol::decode_messages(&receive_binary(&mut second).await?)?;
    let client_id = *awareness_update
        .clients
        .keys()
        .next()
        .ok_or("awareness update has no client")?;
    let previous_clock = awareness_update
        .clients
        .get(&client_id)
        .ok_or("awareness client id missing from update")?
        .clock;

    first.close(None).await?;
    let removal = protocol::decode_messages(&receive_binary(&mut second).await?)?;
    second.close(None).await?;
    server.task.abort();

    assert_eq!(
        (second_awareness, removal),
        (
            vec![YMessage::Awareness(awareness_update)],
            vec![YMessage::Awareness(AwarenessUpdate {
                clients: HashMap::from([(
                    client_id,
                    yrs::sync::awareness::AwarenessUpdateEntry {
                        clock: previous_clock + 1,
                        json: "null".into(),
                    },
                )]),
            })],
        ),
    );
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
    let (mut client, first_doc) = open_client(&restarted, "persistent-document").await?;
    let first_value = text_value(&first_doc);
    let first_rows = count_updates(&pool, "persistent-document").await?;
    client.close(None).await?;
    drop(client);
    drop(first_doc);
    restarted.task.abort();

    let compacted_restart = start_server(pool.clone()).await?;
    let (mut client, second_doc) = open_client(&compacted_restart, "persistent-document").await?;
    let second_value = text_value(&second_doc);
    let second_rows = count_updates(&pool, "persistent-document").await?;
    client.close(None).await?;
    compacted_restart.task.abort();

    assert_eq!(
        (first_value, first_rows, second_value, second_rows),
        ("one two".to_owned(), 1, "one two".to_owned(), 1),
    );
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

async fn count_updates(pool: &AnyPool, doc_id: &str) -> TestResult<i64> {
    let query = if pool.connect_options().to_url_lossy().scheme() == "sqlite" {
        "SELECT COUNT(*) FROM sync_updates WHERE doc_id = ?1"
    } else {
        "SELECT COUNT(*) FROM sync_updates WHERE doc_id = $1"
    };
    Ok(sqlx::query_scalar::<_, i64>(query)
        .bind(doc_id)
        .fetch_one(pool)
        .await?)
}

async fn rejects_unapplicable_updates(pool: AnyPool) -> TestResult {
    let server = start_server(pool.clone()).await?;
    let document = server.sync.open_document("invalid-update-document").await?;
    let (valid_update, invalid_update) = updates_with_invalid_parent();
    document.apply_update(&valid_update).await?;
    let result = document.apply_update(&invalid_update).await;
    let outcome = match result {
        Err(crate::sync::SyncError::Update(yrs::error::UpdateError::InvalidParent(..))) => {
            "invalid-parent"
        }
        Err(error) => return Err(error.into()),
        Ok(()) => return Err("invalid update was applied".into()),
    };
    let stored_updates = count_updates(&pool, "invalid-update-document").await?;

    let restored_service = SyncService::new(pool.clone())?;
    let restored = restored_service
        .open_document("invalid-update-document")
        .await?;
    let restored_doc = Doc::new();
    restored_doc
        .transact_mut()
        .apply_update(Update::decode_v1(&restored.encode_state().await)?)?;
    let contents = restored_doc
        .get_or_insert_array("items")
        .to_json(&restored_doc.transact());
    let restored_updates = count_updates(&pool, "invalid-update-document").await?;
    server.task.abort();

    assert_eq!(
        (outcome, stored_updates, contents, restored_updates),
        (
            "invalid-parent",
            1,
            yrs::Any::Array(vec![yrs::Any::from("scalar")].into()),
            1,
        ),
    );
    Ok(())
}

async fn does_not_store_empty_updates(pool: AnyPool) -> TestResult {
    let server = start_server(pool.clone()).await?;
    let (mut client, doc) = open_client(&server, "empty-update-document").await?;
    send_empty_update(&mut client, &doc).await?;
    let updates = count_updates(&pool, "empty-update-document").await?;
    client.close(None).await?;
    server.task.abort();

    assert_eq!(updates, 0);
    Ok(())
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
async fn sends_existing_awareness_to_late_postgres_clients(pool: PgPool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    sends_existing_awareness_to_late_joiners(any_pool(&url).await?).await
}

#[sqlx::test]
async fn sends_existing_awareness_to_late_sqlite_clients(pool: SqlitePool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    sends_existing_awareness_to_late_joiners(any_pool(&url).await?).await
}

#[sqlx::test]
async fn broadcasts_and_removes_awareness_over_postgres(pool: PgPool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    broadcasts_and_removes_awareness(any_pool(&url).await?).await
}

#[sqlx::test]
async fn broadcasts_and_removes_awareness_over_sqlite(pool: SqlitePool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    broadcasts_and_removes_awareness(any_pool(&url).await?).await
}

#[sqlx::test]
async fn does_not_persist_empty_updates_over_postgres(pool: PgPool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    does_not_store_empty_updates(any_pool(&url).await?).await
}

#[sqlx::test]
async fn does_not_persist_empty_updates_over_sqlite(pool: SqlitePool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    does_not_store_empty_updates(any_pool(&url).await?).await
}

#[sqlx::test]
async fn removes_unapplicable_updates_over_postgres(pool: PgPool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    rejects_unapplicable_updates(any_pool(&url).await?).await
}

#[sqlx::test]
async fn removes_unapplicable_updates_over_sqlite(pool: SqlitePool) -> TestResult {
    let url = pool.connect_options().to_url_lossy().to_string();
    rejects_unapplicable_updates(any_pool(&url).await?).await
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

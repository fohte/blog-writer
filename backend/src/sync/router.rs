use axum::{
    extract::{
        Path, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::{IntoResponse, Response},
};
use std::collections::HashSet;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{app::AppState, error::AppError};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(websocket))
}

#[utoipa::path(get, path = "/sync/{doc_id}", params(("doc_id" = String, Path, description = "Document identifier")), responses((status = 101, description = "WebSocket connection")))]
async fn websocket(
    State(state): State<AppState>,
    Path(doc_id): Path<String>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Some(sync) = state.sync else {
        return AppError::Client {
            status: axum::http::StatusCode::SERVICE_UNAVAILABLE,
            message: "Synchronization is not configured".to_owned(),
        }
        .into_response();
    };
    let document = match sync.open_document(doc_id).await {
        Ok(document) => document,
        Err(error) => {
            tracing::error!(%error, "failed to open synchronized document");
            return AppError::Internal("Failed to open document".to_owned()).into_response();
        }
    };

    upgrade
        .on_upgrade(move |socket| handle_socket(socket, document))
        .into_response()
}

async fn handle_socket(mut socket: WebSocket, document: super::SyncDocument) {
    let mut outgoing = document.subscribe_protocol();
    match document.start_protocol().await {
        Ok(frame) => {
            if socket.send(Message::Binary(frame.into())).await.is_err() {
                return;
            }
        }
        Err(error) => {
            tracing::error!(%error, "failed to start synchronization protocol");
            return;
        }
    }

    let mut awareness_clients = HashSet::new();
    run_socket(
        &mut socket,
        &document,
        &mut outgoing,
        &mut awareness_clients,
    )
    .await;
    document.remove_awareness_clients(awareness_clients).await;
}

async fn run_socket(
    socket: &mut WebSocket,
    document: &super::SyncDocument,
    outgoing: &mut tokio::sync::broadcast::Receiver<Vec<u8>>,
    awareness_clients: &mut HashSet<yrs::ClientID>,
) {
    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Binary(data))) => match document.handle_protocol_frame(&data, awareness_clients).await {
                    Ok(responses) => {
                        for response in responses {
                            if socket.send(Message::Binary(response.into())).await.is_err() {
                                return;
                            }
                        }
                    }
                    Err(error) => {
                        tracing::warn!(%error, "rejected invalid synchronization message");
                        return;
                    }
                },
                Some(Ok(Message::Ping(data))) => {
                    if socket.send(Message::Pong(data)).await.is_err() {
                        return;
                    }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                Some(Ok(Message::Text(_))) | Some(Ok(Message::Pong(_))) => {}
            },
            update = outgoing.recv() => match update {
                Ok(frame) => {
                    if socket.send(Message::Binary(frame.into())).await.is_err() {
                        return;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
            }
        }
    }
}

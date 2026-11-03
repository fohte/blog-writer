use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex as StdMutex, Weak},
};

use sqlx::AnyPool;
use thiserror::Error;
use tokio::sync::{Mutex, broadcast};
use yrs::{ClientID, Update, updates::decoder::Decode};

use super::{
    database::{self, DatabaseError, DatabaseKind},
    protocol,
};

#[derive(Debug, Error)]
pub enum SyncError {
    #[error(transparent)]
    Database(Box<dyn std::error::Error + Send + Sync>),
    #[error(transparent)]
    Protocol(#[from] yrs::sync::protocol::Error),
    #[error(transparent)]
    UpdateDecode(#[from] yrs::encoding::read::Error),
    #[error(transparent)]
    Update(#[from] yrs::error::UpdateError),
}

impl From<DatabaseError> for SyncError {
    fn from(error: DatabaseError) -> Self {
        Self::Database(Box::new(error))
    }
}

#[derive(Clone)]
pub struct SyncService {
    inner: Arc<SyncServiceInner>,
}

struct SyncServiceInner {
    pool: AnyPool,
    kind: DatabaseKind,
    documents: Mutex<HashMap<String, Arc<DocumentSlot>>>,
}

struct DocumentSlot {
    document: StdMutex<Weak<DocumentInner>>,
    load_lock: Mutex<()>,
}

impl Default for DocumentSlot {
    fn default() -> Self {
        Self {
            document: StdMutex::new(Weak::new()),
            load_lock: Mutex::new(()),
        }
    }
}

#[derive(Clone)]
pub struct SyncDocument {
    inner: Arc<DocumentInner>,
}

struct DocumentInner {
    id: String,
    pool: AnyPool,
    kind: DatabaseKind,
    state: Mutex<protocol::DocumentState>,
    update_subscribers: broadcast::Sender<Vec<u8>>,
    protocol_subscribers: broadcast::Sender<Vec<u8>>,
}

impl SyncService {
    pub fn new(pool: AnyPool) -> Result<Self, SyncError> {
        let kind = DatabaseKind::from_pool(&pool)?;
        Ok(Self {
            inner: Arc::new(SyncServiceInner {
                pool,
                kind,
                documents: Mutex::new(HashMap::new()),
            }),
        })
    }

    pub async fn open_document(
        &self,
        doc_id: impl Into<String>,
    ) -> Result<SyncDocument, SyncError> {
        let doc_id = doc_id.into();
        let slot = {
            let mut documents = self.inner.documents.lock().await;
            documents.retain(|_, slot| {
                let has_document = slot
                    .document
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .strong_count()
                    > 0;
                has_document || Arc::strong_count(slot) > 1
            });
            documents
                .entry(doc_id.clone())
                .or_insert_with(|| Arc::new(DocumentSlot::default()))
                .clone()
        };
        let _load_guard = slot.load_lock.lock().await;
        if let Some(inner) = slot
            .document
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .upgrade()
        {
            return Ok(SyncDocument { inner });
        }

        let doc = database::load_and_compact(&self.inner.pool, self.inner.kind, &doc_id).await?;
        let (update_subscribers, _) = broadcast::channel(128);
        let (protocol_subscribers, _) = broadcast::channel(128);
        let inner = Arc::new(DocumentInner {
            id: doc_id.clone(),
            pool: self.inner.pool.clone(),
            kind: self.inner.kind,
            state: Mutex::new(protocol::DocumentState::new(doc)),
            update_subscribers,
            protocol_subscribers,
        });
        *slot
            .document
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Arc::downgrade(&inner);

        Ok(SyncDocument { inner })
    }
}

impl SyncDocument {
    pub async fn encode_state(&self) -> Vec<u8> {
        let state = self.inner.state.lock().await;
        protocol::encode_state(&state)
    }

    pub fn subscribe_updates(&self) -> broadcast::Receiver<Vec<u8>> {
        self.inner.update_subscribers.subscribe()
    }

    pub(super) fn subscribe_protocol(&self) -> broadcast::Receiver<Vec<u8>> {
        self.inner.protocol_subscribers.subscribe()
    }

    pub async fn apply_update(&self, update: &[u8]) -> Result<(), SyncError> {
        let update_value = Update::decode_v1(update)?;
        if update_value.is_empty() {
            return Ok(());
        }
        let mut state = self.inner.state.lock().await;
        let update_id =
            database::append_update(&self.inner.pool, self.inner.kind, &self.inner.id, update)
                .await?;
        if let Err(error) = state.apply_update(update_value) {
            if let Err(cleanup_error) =
                database::delete_update(&self.inner.pool, self.inner.kind, update_id).await
            {
                tracing::error!(%cleanup_error, %error, "failed to remove unapplied synchronization update");
                return Err(cleanup_error.into());
            }
            return Err(error.into());
        }
        let _ = self.inner.update_subscribers.send(update.to_vec());
        let message = protocol::encode_sync_update(update);
        let _ = self.inner.protocol_subscribers.send(message);
        Ok(())
    }

    pub(super) async fn start_protocol(&self) -> Result<Vec<Vec<u8>>, SyncError> {
        let state = self.inner.state.lock().await;
        protocol::start(&state).map_err(Into::into)
    }

    pub(super) async fn handle_protocol_frame(
        &self,
        data: &[u8],
        awareness_clients: &mut HashSet<ClientID>,
    ) -> Result<Vec<Vec<u8>>, SyncError> {
        let messages = protocol::decode_messages(data)?;
        let mut responses = Vec::new();
        for message in messages {
            match message {
                yrs::sync::Message::Sync(yrs::sync::SyncMessage::SyncStep2(update))
                | yrs::sync::Message::Sync(yrs::sync::SyncMessage::Update(update)) => {
                    self.apply_update(&update).await?;
                }
                yrs::sync::Message::Awareness(update) => {
                    for (client_id, entry) in &update.clients {
                        if entry.json.as_ref() == "null" {
                            awareness_clients.remove(client_id);
                        } else {
                            awareness_clients.insert(*client_id);
                        }
                    }
                    let response = {
                        let mut state = self.inner.state.lock().await;
                        protocol::handle_message(
                            &mut state,
                            yrs::sync::Message::Awareness(update.clone()),
                        )?
                    };
                    let frame = protocol::encode_message(&yrs::sync::Message::Awareness(update));
                    let _ = self.inner.protocol_subscribers.send(frame);
                    if let Some(response) = response {
                        responses.push(protocol::encode_message(&response));
                    }
                }
                message => {
                    let response = {
                        let mut state = self.inner.state.lock().await;
                        protocol::handle_message(&mut state, message)?
                    };
                    if let Some(response) = response {
                        responses.push(protocol::encode_message(&response));
                    }
                }
            }
        }
        Ok(responses)
    }

    pub(super) async fn remove_awareness_clients(&self, client_ids: HashSet<ClientID>) {
        if client_ids.is_empty() {
            return;
        }
        let mut state = self.inner.state.lock().await;
        for client_id in &client_ids {
            state.remove_awareness_client(*client_id);
        }
        match state.awareness_update(client_ids) {
            Ok(update) => {
                let frame = protocol::encode_message(&yrs::sync::Message::Awareness(update));
                let _ = self.inner.protocol_subscribers.send(frame);
            }
            Err(error) => tracing::warn!(%error, "failed to publish awareness disconnect"),
        }
    }
}

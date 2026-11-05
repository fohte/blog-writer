use std::{
    collections::HashMap,
    io,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use thiserror::Error;
use tokio::{
    sync::{Mutex, watch},
    task::JoinHandle,
    time::sleep,
};
use yrs::{
    Any, Doc, GetString, Map, MapPrelim, MapRef, Out, ReadTxn, Transact, Update, WriteTxn,
    updates::decoder::Decode,
};

use crate::sync::{SyncDocument, SyncService};

use super::storage;

const ARTICLE_INDEX_ID: &str = "article-index";
const ARTICLE_INDEX_MAP: &str = "articles";
pub const PATH_KEY: &str = "syncFilePath";
pub const HASH_KEY: &str = "syncFileHash";
pub const STATUS_KEY: &str = "syncFileStatus";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileSyncStatus {
    Unset,
    Synced,
    ExternalChanged,
}

impl FileSyncStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Unset => "unset",
            Self::Synced => "synced",
            Self::ExternalChanged => "external_changed",
        }
    }

    fn from_str(value: &str) -> Self {
        match value {
            "synced" => Self::Synced,
            "external_changed" => Self::ExternalChanged,
            _ => Self::Unset,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArticleFileState {
    pub path: Option<String>,
    pub hash: Option<String>,
    pub status: FileSyncStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArticleFileContent {
    pub state: ArticleFileState,
    pub content: Option<String>,
    pub content_hash: Option<String>,
}

#[derive(Debug, Error)]
pub enum FileSyncError {
    #[error("file synchronization is unavailable")]
    Unavailable,
    #[error("invalid synchronization file path")]
    InvalidPath,
    #[error("synchronization file changed while importing")]
    FileChanged,
    #[error("synchronization document failed: {0}")]
    Sync(#[from] crate::sync::SyncError),
    #[error("invalid synchronization document: {0}")]
    Yrs(#[from] yrs::encoding::read::Error),
    #[error("synchronization document update failed: {0}")]
    Update(#[from] yrs::error::UpdateError),
    #[error("file synchronization I/O failed: {0}")]
    Io(#[from] io::Error),
}

#[derive(Clone)]
pub struct LocalFileSyncService {
    inner: Arc<LocalFileSyncInner>,
}

struct LocalFileSyncInner {
    sync: SyncService,
    directory: PathBuf,
    delay: Duration,
    operations: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    watchers: Mutex<HashMap<String, ActiveWatcher>>,
}

struct ActiveWatcher {
    path: String,
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
}

impl LocalFileSyncService {
    pub fn new(sync: SyncService, directory: PathBuf) -> Self {
        Self::with_delay(sync, directory, Duration::from_secs(1))
    }

    pub fn with_delay(sync: SyncService, directory: PathBuf, delay: Duration) -> Self {
        Self {
            inner: Arc::new(LocalFileSyncInner {
                sync,
                directory,
                delay,
                operations: Mutex::new(HashMap::new()),
                watchers: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub fn directory(&self) -> &Path {
        &self.inner.directory
    }

    pub async fn start(&self) -> Result<(), FileSyncError> {
        let index = self.inner.sync.open_document(ARTICLE_INDEX_ID).await?;
        let mut index_updates = index.subscribe_updates();
        self.refresh_watchers().await?;
        let service = self.clone();
        tokio::spawn(async move {
            loop {
                match index_updates.recv().await {
                    Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        if let Err(error) = service.refresh_watchers().await {
                            tracing::error!(%error, "failed to refresh article file sync watchers");
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                }
            }
        });
        Ok(())
    }

    pub async fn article_file_state(
        &self,
        article_id: &str,
    ) -> Result<ArticleFileContent, FileSyncError> {
        let _guard = self.operation_lock(article_id).await.lock_owned().await;
        let mut state = self.read_state(article_id).await?;
        let Some(path) = state.path.as_deref() else {
            return Ok(ArticleFileContent {
                state,
                content: None,
                content_hash: None,
            });
        };

        let content = storage::read_file(&self.inner.directory, path)?;
        let content_hash = content.as_deref().map(storage::sha256_hex);
        if state.status == FileSyncStatus::Synced
            && content_hash.as_deref() != state.hash.as_deref()
        {
            state.status = FileSyncStatus::ExternalChanged;
            self.write_state(article_id, &state).await?;
        }
        let content = content
            .map(|bytes| String::from_utf8(bytes).map_err(|_| FileSyncError::InvalidPath))
            .transpose()?;

        Ok(ArticleFileContent {
            state,
            content,
            content_hash,
        })
    }

    pub async fn set_article_file(
        &self,
        article_id: &str,
        path: &str,
    ) -> Result<ArticleFileContent, FileSyncError> {
        let _guard = self.operation_lock(article_id).await.lock_owned().await;
        storage::validate_path(&self.inner.directory, path)?;
        let existing = storage::read_file(&self.inner.directory, path)?;
        let state = if existing.is_some() {
            ArticleFileState {
                path: Some(path.to_owned()),
                hash: None,
                status: FileSyncStatus::ExternalChanged,
            }
        } else {
            let body = self.read_article_body(article_id).await?;
            let bytes = body.as_bytes();
            storage::atomic_write(&self.inner.directory, path, bytes)?;
            ArticleFileState {
                path: Some(path.to_owned()),
                hash: Some(storage::sha256_hex(bytes)),
                status: FileSyncStatus::Synced,
            }
        };
        self.write_state(article_id, &state).await?;
        self.article_file_state_unlocked(state).await
    }

    pub async fn resume_article_file_sync(
        &self,
        article_id: &str,
        imported_hash: &str,
    ) -> Result<ArticleFileContent, FileSyncError> {
        let _guard = self.operation_lock(article_id).await.lock_owned().await;
        let mut state = self.read_state(article_id).await?;
        let path = state.path.as_deref().ok_or(FileSyncError::InvalidPath)?;
        let bytes =
            storage::read_file(&self.inner.directory, path)?.ok_or(FileSyncError::FileChanged)?;
        let actual_hash = storage::sha256_hex(&bytes);
        if imported_hash != actual_hash {
            return Err(FileSyncError::FileChanged);
        }
        state.hash = Some(actual_hash);
        state.status = FileSyncStatus::Synced;
        self.write_state(article_id, &state).await?;
        self.article_file_state_unlocked(state).await
    }

    pub async fn overwrite_article_file(
        &self,
        article_id: &str,
    ) -> Result<ArticleFileContent, FileSyncError> {
        let _guard = self.operation_lock(article_id).await.lock_owned().await;
        let mut state = self.read_state(article_id).await?;
        let path = state.path.as_deref().ok_or(FileSyncError::InvalidPath)?;
        let previous = storage::read_file(&self.inner.directory, path)?;
        let body = self.read_article_body(article_id).await?;
        let bytes = storage::line_endings(body.as_bytes(), previous.as_deref());
        storage::atomic_write(&self.inner.directory, path, &bytes)?;
        state.hash = Some(storage::sha256_hex(&bytes));
        state.status = FileSyncStatus::Synced;
        self.write_state(article_id, &state).await?;
        self.article_file_state_unlocked(state).await
    }

    async fn article_file_state_unlocked(
        &self,
        state: ArticleFileState,
    ) -> Result<ArticleFileContent, FileSyncError> {
        let Some(path) = state.path.as_deref() else {
            return Ok(ArticleFileContent {
                state,
                content: None,
                content_hash: None,
            });
        };
        let content = storage::read_file(&self.inner.directory, path)?;
        let content_hash = content.as_deref().map(storage::sha256_hex);
        let content = content
            .map(|bytes| String::from_utf8(bytes).map_err(|_| FileSyncError::InvalidPath))
            .transpose()?;
        Ok(ArticleFileContent {
            state,
            content,
            content_hash,
        })
    }

    async fn refresh_watchers(&self) -> Result<(), FileSyncError> {
        let index = self.inner.sync.open_document(ARTICLE_INDEX_ID).await?;
        let entries = read_index_entries(&index).await?;
        let mut watchers = self.inner.watchers.lock().await;
        for (article_id, watcher) in watchers.iter() {
            let replacement_path = entries.get(article_id);
            if replacement_path != Some(&watcher.path) {
                watcher.stop.send_replace(true);
                watcher.task.abort();
            }
        }
        watchers.retain(|article_id, watcher| {
            if entries.get(article_id) == Some(&watcher.path) {
                true
            } else {
                watcher.task.abort();
                false
            }
        });
        for (article_id, path) in entries {
            if watchers.contains_key(&article_id) {
                continue;
            }
            let document = self.inner.sync.open_document(article_id.clone()).await?;
            let updates = document.subscribe_updates();
            let (stop, stopped) = watch::channel(false);
            let service = self.clone();
            let watched_id = article_id.clone();
            let task = tokio::spawn(async move {
                service
                    .watch_article(watched_id, document, updates, stopped)
                    .await;
            });
            watchers.insert(article_id, ActiveWatcher { path, stop, task });
        }
        Ok(())
    }

    async fn watch_article(
        &self,
        article_id: String,
        _document: SyncDocument,
        mut updates: tokio::sync::broadcast::Receiver<Vec<u8>>,
        mut stopped: watch::Receiver<bool>,
    ) {
        loop {
            tokio::select! {
                changed = stopped.changed() => {
                    if changed.is_err() || *stopped.borrow() { return; }
                }
                update = updates.recv() => match update {
                    Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        loop {
                            tokio::select! {
                                _ = sleep(self.inner.delay) => break,
                                changed = stopped.changed() => {
                                    if changed.is_err() || *stopped.borrow() { return; }
                                }
                                next = updates.recv() => match next {
                                    Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                                }
                            }
                        }
                        if let Err(error) = self.process_article_update(&article_id).await {
                            tracing::error!(article_id, %error, "failed to synchronize article file");
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                }
            }
        }
    }

    async fn process_article_update(&self, article_id: &str) -> Result<(), FileSyncError> {
        let _guard = self.operation_lock(article_id).await.lock_owned().await;
        let state = self.read_state(article_id).await?;
        if state.status != FileSyncStatus::Synced {
            return Ok(());
        }
        let path = state.path.as_deref().ok_or(FileSyncError::InvalidPath)?;
        let current = storage::read_file(&self.inner.directory, path)?;
        if current.as_deref().map(storage::sha256_hex) != state.hash {
            let mut updated = state;
            updated.status = FileSyncStatus::ExternalChanged;
            self.write_state(article_id, &updated).await?;
            return Ok(());
        }
        let body = self.read_article_body(article_id).await?;
        let bytes = storage::line_endings(body.as_bytes(), current.as_deref());
        storage::atomic_write(&self.inner.directory, path, &bytes)?;
        let mut updated = state;
        updated.hash = Some(storage::sha256_hex(&bytes));
        self.write_state(article_id, &updated).await
    }

    async fn read_article_body(&self, article_id: &str) -> Result<String, FileSyncError> {
        let document = self.inner.sync.open_document(article_id.to_owned()).await?;
        let doc = decode_document(&document.encode_state().await)?;
        let transaction = doc.transact();
        Ok(transaction
            .get_text("body")
            .map(|text| text.get_string(&transaction))
            .unwrap_or_default())
    }

    async fn read_state(&self, article_id: &str) -> Result<ArticleFileState, FileSyncError> {
        let document = self.inner.sync.open_document(ARTICLE_INDEX_ID).await?;
        let doc = decode_document(&document.encode_state().await)?;
        let transaction = doc.transact();
        let article = transaction
            .get_map(ARTICLE_INDEX_MAP)
            .and_then(|articles| articles.get(&transaction, article_id))
            .and_then(|entry| MapRef::try_from(entry).ok());
        let Some(article) = article else {
            return Ok(ArticleFileState {
                path: None,
                hash: None,
                status: FileSyncStatus::Unset,
            });
        };
        let path = map_string(&article, &transaction, PATH_KEY);
        let hash = map_string(&article, &transaction, HASH_KEY);
        let status = map_string(&article, &transaction, STATUS_KEY)
            .map(|value| FileSyncStatus::from_str(&value))
            .unwrap_or(FileSyncStatus::Unset);
        Ok(ArticleFileState { path, hash, status })
    }

    async fn write_state(
        &self,
        article_id: &str,
        state: &ArticleFileState,
    ) -> Result<(), FileSyncError> {
        let document = self.inner.sync.open_document(ARTICLE_INDEX_ID).await?;
        let current = decode_document(&document.encode_state().await)?;
        let state_vector = current.transact().state_vector();
        let mut transaction = current.transact_mut();
        let articles = transaction.get_or_insert_map(ARTICLE_INDEX_MAP);
        let article = articles
            .get(&transaction, article_id)
            .and_then(|entry| MapRef::try_from(entry).ok())
            .unwrap_or_else(|| articles.insert(&mut transaction, article_id, MapPrelim::default()));
        if let Some(path) = &state.path {
            article.try_update(&mut transaction, PATH_KEY, path.as_str());
        }
        if let Some(hash) = &state.hash {
            article.try_update(&mut transaction, HASH_KEY, hash.as_str());
        } else {
            article.remove(&mut transaction, HASH_KEY);
        }
        article.try_update(&mut transaction, STATUS_KEY, state.status.as_str());
        let update = transaction.encode_diff_v1(&state_vector);
        drop(transaction);
        if !update.is_empty() {
            document.apply_update(&update).await?;
        }
        Ok(())
    }

    async fn operation_lock(&self, article_id: &str) -> Arc<Mutex<()>> {
        let mut locks = self.inner.operations.lock().await;
        locks
            .entry(article_id.to_owned())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

async fn read_index_entries(
    document: &SyncDocument,
) -> Result<HashMap<String, String>, FileSyncError> {
    let doc = decode_document(&document.encode_state().await)?;
    let transaction = doc.transact();
    let Some(articles) = transaction.get_map(ARTICLE_INDEX_MAP) else {
        return Ok(HashMap::new());
    };
    Ok(articles
        .iter(&transaction)
        .filter_map(|(article_id, entry)| {
            let entry = MapRef::try_from(entry).ok()?;
            map_string(&entry, &transaction, PATH_KEY).map(|path| (article_id.to_owned(), path))
        })
        .collect())
}

fn decode_document(update: &[u8]) -> Result<Doc, FileSyncError> {
    let doc = Doc::new();
    if !update.is_empty() {
        doc.transact_mut()
            .apply_update(Update::decode_v1(update)?)?;
    }
    Ok(doc)
}

fn map_string<T: ReadTxn>(map: &MapRef, transaction: &T, key: &str) -> Option<String> {
    match map.get(transaction, key)? {
        Out::Any(Any::String(value)) => Some(value.to_string()),
        _ => None,
    }
}

use std::{
    collections::HashMap,
    io,
    path::{Path, PathBuf},
    sync::{Arc, Weak},
    time::Duration,
};

use thiserror::Error;
use tokio::{
    sync::{Mutex, watch},
    task::JoinHandle,
    time::sleep,
};
use yrs::{Doc, GetString, ReadTxn, Transact};

use crate::sync::SyncService;

use super::{state, storage};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileSyncStatus {
    Unset,
    Synced,
    ExternalChanged,
}

impl FileSyncStatus {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Unset => "unset",
            Self::Synced => "synced",
            Self::ExternalChanged => "external_changed",
        }
    }

    pub(super) fn from_str(value: &str) -> Self {
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
    #[error("invalid synchronization file path")]
    InvalidPath,
    #[error("synchronization file changed while importing")]
    FileChanged,
    #[error("synchronization file is not valid UTF-8")]
    NonUtf8,
    #[error("article was not found")]
    ArticleNotFound,
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
    index_client_id: u64,
    index_state_lock: Mutex<()>,
    operations: Mutex<HashMap<String, Weak<Mutex<()>>>>,
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

    pub(super) fn with_delay(sync: SyncService, directory: PathBuf, delay: Duration) -> Self {
        let index_client_id = Doc::new().client_id().get();
        Self {
            inner: Arc::new(LocalFileSyncInner {
                sync,
                directory,
                delay,
                index_client_id,
                index_state_lock: Mutex::new(()),
                operations: Mutex::new(HashMap::new()),
                watchers: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub fn directory(&self) -> &Path {
        &self.inner.directory
    }

    pub async fn start(&self) -> Result<(), FileSyncError> {
        let index = self
            .inner
            .sync
            .open_document(state::ARTICLE_INDEX_ID)
            .await?;
        let mut index_updates = index.subscribe_updates();
        self.refresh_watchers().await?;
        let service = self.clone();
        tokio::spawn(async move {
            let _index_document_guard = index;
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
        let state = state::read_state(&self.inner.sync, article_id).await?;
        self.article_file_state_unlocked(article_id, state).await
    }

    pub async fn set_article_file(
        &self,
        article_id: &str,
        path: &str,
    ) -> Result<ArticleFileContent, FileSyncError> {
        let _guard = self.operation_lock(article_id).await.lock_owned().await;
        state::read_state(&self.inner.sync, article_id).await?;
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
        self.persist_state(article_id, &state).await?;
        self.refresh_watchers().await?;
        self.article_file_state_unlocked(article_id, state).await
    }

    pub async fn resume_article_file_sync(
        &self,
        article_id: &str,
        imported_hash: &str,
    ) -> Result<ArticleFileContent, FileSyncError> {
        let _guard = self.operation_lock(article_id).await.lock_owned().await;
        let mut state = state::read_state(&self.inner.sync, article_id).await?;
        let path = state.path.as_deref().ok_or(FileSyncError::InvalidPath)?;
        let bytes =
            storage::read_file(&self.inner.directory, path)?.ok_or(FileSyncError::FileChanged)?;
        std::str::from_utf8(&bytes).map_err(|_| FileSyncError::NonUtf8)?;
        let actual_hash = storage::sha256_hex(&bytes);
        if imported_hash != actual_hash {
            return Err(FileSyncError::FileChanged);
        }
        state.hash = Some(actual_hash);
        state.status = FileSyncStatus::Synced;
        self.persist_state(article_id, &state).await?;
        self.article_file_state_unlocked(article_id, state).await
    }

    pub async fn overwrite_article_file(
        &self,
        article_id: &str,
    ) -> Result<ArticleFileContent, FileSyncError> {
        let _guard = self.operation_lock(article_id).await.lock_owned().await;
        let mut state = state::read_state(&self.inner.sync, article_id).await?;
        let path = state.path.as_deref().ok_or(FileSyncError::InvalidPath)?;
        let previous = storage::read_file(&self.inner.directory, path)?;
        let body = self.read_article_body(article_id).await?;
        let bytes = storage::line_endings(body.as_bytes(), previous.as_deref());
        storage::atomic_write(&self.inner.directory, path, &bytes)?;
        state.hash = Some(storage::sha256_hex(&bytes));
        state.status = FileSyncStatus::Synced;
        self.persist_state(article_id, &state).await?;
        self.article_file_state_unlocked(article_id, state).await
    }

    async fn article_file_state_unlocked(
        &self,
        article_id: &str,
        mut state: ArticleFileState,
    ) -> Result<ArticleFileContent, FileSyncError> {
        let Some(path) = state.path.as_deref() else {
            return Ok(ArticleFileContent {
                state,
                content: None,
                content_hash: None,
            });
        };
        let bytes = storage::read_file(&self.inner.directory, path)?;
        let content_hash = bytes.as_deref().map(storage::sha256_hex);
        if state.status == FileSyncStatus::Synced
            && (state.hash.is_none() || content_hash.as_deref() != state.hash.as_deref())
        {
            state.status = FileSyncStatus::ExternalChanged;
            self.persist_state(article_id, &state).await?;
        }
        let content = bytes
            .map(|bytes| String::from_utf8(bytes).map_err(|_| FileSyncError::NonUtf8))
            .transpose()?;
        Ok(ArticleFileContent {
            state,
            content,
            content_hash,
        })
    }

    async fn refresh_watchers(&self) -> Result<(), FileSyncError> {
        let index = self
            .inner
            .sync
            .open_document(state::ARTICLE_INDEX_ID)
            .await?;
        let mut watchers = self.inner.watchers.lock().await;
        let entries = state::read_index_entries(&index).await?;
        watchers.retain(|article_id, watcher| {
            if entries.get(article_id) == Some(&watcher.path) {
                true
            } else {
                watcher.stop.send_replace(true);
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
                // SyncService caches documents weakly, so keep the sender alive for this receiver.
                let _document_guard = document;
                service.watch_article(watched_id, updates, stopped).await;
            });
            watchers.insert(article_id, ActiveWatcher { path, stop, task });
        }
        Ok(())
    }

    async fn watch_article(
        &self,
        article_id: String,
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
                            match error {
                                FileSyncError::ArticleNotFound => return,
                                error => tracing::error!(article_id, %error, "failed to synchronize article file"),
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                }
            }
        }
    }

    async fn process_article_update(&self, article_id: &str) -> Result<(), FileSyncError> {
        let _guard = self.operation_lock(article_id).await.lock_owned().await;
        let state = state::read_state(&self.inner.sync, article_id).await?;
        if state.status != FileSyncStatus::Synced {
            return Ok(());
        }
        let path = state.path.as_deref().ok_or(FileSyncError::InvalidPath)?;
        let current = match storage::read_file(&self.inner.directory, path) {
            Ok(current) => current,
            Err(error) if is_file_error(&error) => {
                let mut updated = state;
                updated.status = FileSyncStatus::ExternalChanged;
                self.persist_state(article_id, &updated).await?;
                tracing::warn!(article_id, %error, "paused article file synchronization after a file error");
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        let current_hash = current.as_deref().map(storage::sha256_hex);
        if state.hash.is_none() || current_hash != state.hash {
            let mut updated = state;
            updated.status = FileSyncStatus::ExternalChanged;
            self.persist_state(article_id, &updated).await?;
            return Ok(());
        }
        let body = self.read_article_body(article_id).await?;
        let bytes = storage::line_endings(body.as_bytes(), current.as_deref());
        if let Err(error) = storage::atomic_write(&self.inner.directory, path, &bytes) {
            if is_file_error(&error) {
                let mut updated = state;
                updated.status = FileSyncStatus::ExternalChanged;
                self.persist_state(article_id, &updated).await?;
                tracing::warn!(article_id, %error, "paused article file synchronization after a file error");
                return Ok(());
            }
            return Err(error);
        }
        let mut updated = state;
        updated.hash = Some(storage::sha256_hex(&bytes));
        self.persist_state(article_id, &updated).await
    }

    async fn read_article_body(&self, article_id: &str) -> Result<String, FileSyncError> {
        let document = self.inner.sync.open_document(article_id.to_owned()).await?;
        let doc = state::decode_document(&document.encode_state().await)?;
        let transaction = doc.transact();
        Ok(transaction
            .get_text("body")
            .map(|text| text.get_string(&transaction))
            .unwrap_or_default())
    }

    async fn operation_lock(&self, article_id: &str) -> Arc<Mutex<()>> {
        let mut locks = self.inner.operations.lock().await;
        locks.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = locks.get(article_id).and_then(Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(Mutex::new(()));
        locks.insert(article_id.to_owned(), Arc::downgrade(&lock));
        lock
    }

    async fn persist_state(
        &self,
        article_id: &str,
        state: &ArticleFileState,
    ) -> Result<(), FileSyncError> {
        let _guard = self.inner.index_state_lock.lock().await;
        state::write_state(
            &self.inner.sync,
            article_id,
            state,
            self.inner.index_client_id,
        )
        .await
    }
}

fn is_file_error(error: &FileSyncError) -> bool {
    matches!(error, FileSyncError::InvalidPath | FileSyncError::Io(_))
}

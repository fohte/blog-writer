use std::{collections::HashMap, io};

use thiserror::Error;
use yrs::{Any, Doc, Map, MapRef, Out, ReadTxn, Transact, Update, updates::decoder::Decode};

use crate::sync::{SyncDocument, SyncService};

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

pub(super) const ARTICLE_INDEX_ID: &str = "article-index";
const ARTICLE_INDEX_MAP: &str = "articles";
const PATH_KEY: &str = "syncFilePath";
const HASH_KEY: &str = "syncFileHash";
const STATUS_KEY: &str = "syncFileStatus";

pub(super) async fn read_state(
    sync: &SyncService,
    article_id: &str,
) -> Result<ArticleFileState, FileSyncError> {
    let document = sync.open_document(ARTICLE_INDEX_ID).await?;
    let doc = decode_document(&document.encode_state().await)?;
    let transaction = doc.transact();
    let article = transaction
        .get_map(ARTICLE_INDEX_MAP)
        .and_then(|articles| articles.get(&transaction, article_id))
        .and_then(|entry| MapRef::try_from(entry).ok())
        .ok_or(FileSyncError::ArticleNotFound)?;
    let path = map_string(&article, &transaction, PATH_KEY);
    let hash = map_string(&article, &transaction, HASH_KEY);
    let status = map_string(&article, &transaction, STATUS_KEY)
        .map(|value| FileSyncStatus::from_str(&value))
        .unwrap_or(FileSyncStatus::Unset);
    Ok(ArticleFileState { path, hash, status })
}

pub(super) async fn write_state(
    sync: &SyncService,
    article_id: &str,
    state: &ArticleFileState,
    client_id: u64,
) -> Result<(), FileSyncError> {
    let document = sync.open_document(ARTICLE_INDEX_ID).await?;
    let current = decode_document_with_client_id(&document.encode_state().await, client_id)?;
    let state_vector = current.transact().state_vector();
    let mut transaction = current.transact_mut();
    let article = transaction
        .get_map(ARTICLE_INDEX_MAP)
        .and_then(|articles| {
            articles
                .get(&transaction, article_id)
                .and_then(|entry| MapRef::try_from(entry).ok())
        })
        .ok_or(FileSyncError::ArticleNotFound)?;
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

pub(super) async fn read_index_entries(
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

pub(super) fn decode_document(update: &[u8]) -> Result<Doc, FileSyncError> {
    decode_document_with_client_id(update, Doc::new().client_id().get())
}

fn decode_document_with_client_id(update: &[u8], client_id: u64) -> Result<Doc, FileSyncError> {
    let doc = Doc::with_client_id(client_id);
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

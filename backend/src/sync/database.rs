use sqlx::{AnyPool, ConnectOptions, Row};
use thiserror::Error;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update, updates::decoder::Decode};

#[derive(Clone, Copy)]
pub(super) enum DatabaseKind {
    Postgres,
    Sqlite,
}

#[derive(Debug, Error)]
pub(super) enum DatabaseError {
    #[error("unsupported sync database: {0}")]
    Unsupported(String),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Yrs(#[from] yrs::error::UpdateError),
    #[error(transparent)]
    Decode(#[from] yrs::encoding::read::Error),
}

impl DatabaseKind {
    pub(super) fn from_pool(pool: &AnyPool) -> Result<Self, DatabaseError> {
        let scheme = pool.connect_options().to_url_lossy().scheme().to_owned();
        match scheme.as_str() {
            "postgres" | "postgresql" => Ok(Self::Postgres),
            "sqlite" => Ok(Self::Sqlite),
            _ => Err(DatabaseError::Unsupported(scheme)),
        }
    }

    fn select_updates(self) -> &'static str {
        match self {
            Self::Postgres => {
                "SELECT update_data FROM sync_updates WHERE doc_id = $1 ORDER BY update_id"
            }
            Self::Sqlite => {
                "SELECT update_data FROM sync_updates WHERE doc_id = ?1 ORDER BY update_id"
            }
        }
    }

    fn delete_updates(self) -> &'static str {
        match self {
            Self::Postgres => "DELETE FROM sync_updates WHERE doc_id = $1",
            Self::Sqlite => "DELETE FROM sync_updates WHERE doc_id = ?1",
        }
    }

    fn insert_update(self) -> &'static str {
        match self {
            Self::Postgres => {
                "INSERT INTO sync_updates (doc_id, update_data) VALUES ($1, $2) RETURNING update_id"
            }
            Self::Sqlite => {
                "INSERT INTO sync_updates (doc_id, update_data) VALUES (?1, ?2) RETURNING update_id"
            }
        }
    }

    fn delete_update(self) -> &'static str {
        match self {
            Self::Postgres => "DELETE FROM sync_updates WHERE update_id = $1",
            Self::Sqlite => "DELETE FROM sync_updates WHERE update_id = ?1",
        }
    }
}

pub(super) async fn load_and_compact(
    pool: &AnyPool,
    kind: DatabaseKind,
    doc_id: &str,
) -> Result<Doc, DatabaseError> {
    let mut transaction = pool.begin().await?;
    let rows = sqlx::query(kind.select_updates())
        .bind(doc_id)
        .fetch_all(&mut *transaction)
        .await?;
    let doc = Doc::new();
    for row in &rows {
        let update = row.try_get::<Vec<u8>, _>(0)?;
        doc.transact_mut()
            .apply_update(Update::decode_v1(&update)?)?;
    }

    if !rows.is_empty() {
        let compacted = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        sqlx::query(kind.delete_updates())
            .bind(doc_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query(kind.insert_update())
            .bind(doc_id)
            .bind(compacted)
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;

    Ok(doc)
}

pub(super) async fn append_update(
    pool: &AnyPool,
    kind: DatabaseKind,
    doc_id: &str,
    update: &[u8],
) -> Result<i64, DatabaseError> {
    let row = sqlx::query(kind.insert_update())
        .bind(doc_id)
        .bind(update)
        .fetch_one(pool)
        .await?;
    Ok(row.try_get("update_id")?)
}

pub(super) async fn delete_update(
    pool: &AnyPool,
    kind: DatabaseKind,
    update_id: i64,
) -> Result<(), DatabaseError> {
    sqlx::query(kind.delete_update())
        .bind(update_id)
        .execute(pool)
        .await?;
    Ok(())
}

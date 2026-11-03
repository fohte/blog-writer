use sqlx::{AnyPool, any::AnyPoolOptions, migrate::Migrator};
use thiserror::Error;

static POSTGRES_MIGRATOR: Migrator = sqlx::migrate!("migrations/postgres");
static SQLITE_MIGRATOR: Migrator = sqlx::migrate!("migrations/sqlite");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DatabaseKind {
    Postgres,
    Sqlite,
}

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("DATABASE_URL is required for database initialization")]
    MissingUrl,
    #[error("unsupported DATABASE_URL scheme: {0}")]
    UnsupportedScheme(String),
    #[error(transparent)]
    Connect(#[from] sqlx::Error),
    #[error(transparent)]
    Migrate(#[from] sqlx::migrate::MigrateError),
}

impl DatabaseKind {
    fn from_url(url: &str) -> Result<Self, DatabaseError> {
        let scheme = url.split(':').next().unwrap_or_default();
        match scheme {
            "postgres" | "postgresql" => Ok(Self::Postgres),
            "sqlite" => Ok(Self::Sqlite),
            _ => Err(DatabaseError::UnsupportedScheme(scheme.to_owned())),
        }
    }

    fn migrator(self) -> &'static Migrator {
        match self {
            Self::Postgres => &POSTGRES_MIGRATOR,
            Self::Sqlite => &SQLITE_MIGRATOR,
        }
    }
}

pub async fn initialize(database_url: Option<&str>) -> Result<AnyPool, DatabaseError> {
    let database_url = database_url.ok_or(DatabaseError::MissingUrl)?;
    let kind = DatabaseKind::from_url(database_url)?;

    sqlx::any::install_default_drivers();
    let pool = match kind {
        DatabaseKind::Postgres => AnyPoolOptions::new().connect(database_url).await?,
        DatabaseKind::Sqlite if sqlite_is_memory(database_url) => {
            AnyPoolOptions::new()
                .max_connections(1)
                .connect(database_url)
                .await?
        }
        DatabaseKind::Sqlite => {
            let url = sqlite_url_with_create_if_missing(database_url);
            AnyPoolOptions::new().connect(&url).await?
        }
    };
    kind.migrator().run(&pool).await?;

    Ok(pool)
}

fn sqlite_is_memory(url: &str) -> bool {
    url.contains(":memory:")
        || url
            .split_once('?')
            .is_some_and(|(_, query)| query.split('&').any(|parameter| parameter == "mode=memory"))
}

fn sqlite_url_with_create_if_missing(url: &str) -> String {
    let Some((_, query)) = url.split_once('?') else {
        return format!("{url}?mode=rwc");
    };
    if query.is_empty() {
        return format!("{url}mode=rwc");
    }
    if query
        .split('&')
        .any(|parameter| parameter.starts_with("mode="))
    {
        return url.to_owned();
    }

    format!("{url}&mode=rwc")
}

#[cfg(test)]
mod tests {
    use sqlx::{AnyPool, ConnectOptions, postgres::PgPool, sqlite::SqlitePool};

    use super::{DatabaseError, DatabaseKind};

    #[tokio::test]
    async fn rejects_unsupported_database_url_scheme() {
        let actual = super::initialize(Some("mysql://localhost/sample"))
            .await
            .map(|_| ())
            .err()
            .map(|error| match error {
                DatabaseError::UnsupportedScheme(scheme) => scheme,
                _ => String::new(),
            });

        assert_eq!(actual, Some("mysql".to_owned()));
    }

    #[tokio::test]
    async fn requires_database_url_when_initializing() {
        let actual = super::initialize(None)
            .await
            .map(|_| ())
            .map_err(|error| match error {
                DatabaseError::MissingUrl => "missing",
                _ => "other",
            });

        assert_eq!(actual, Err("missing"));
    }

    #[sqlx::test]
    async fn applies_postgres_migration_and_supports_any_pool(
        pool: PgPool,
    ) -> Result<(), DatabaseError> {
        let url = pool.connect_options().to_url_lossy().to_string();
        let pool = any_pool_from_test_database(&url).await?;
        verify_metadata_round_trip(&pool, DatabaseKind::Postgres).await
    }

    #[sqlx::test]
    async fn applies_sqlite_migration_and_supports_any_pool(
        pool: SqlitePool,
    ) -> Result<(), DatabaseError> {
        let url = pool.connect_options().to_url_lossy().to_string();
        let pool = any_pool_from_test_database(&url).await?;
        verify_metadata_round_trip(&pool, DatabaseKind::Sqlite).await
    }

    #[tokio::test]
    async fn creates_a_new_sqlite_file_database()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let path =
            std::env::temp_dir().join(format!("blog-writer-db-test-{}.sqlite", std::process::id()));
        let url = format!("sqlite://{}", path.display());
        let pool = super::initialize(Some(&url)).await?;
        verify_metadata_round_trip(&pool, DatabaseKind::Sqlite).await?;
        drop(pool);
        std::fs::remove_file(path)?;
        Ok(())
    }

    #[tokio::test]
    async fn supports_sqlite_memory_database() -> Result<(), DatabaseError> {
        let pool = super::initialize(Some("sqlite::memory:")).await?;
        verify_metadata_round_trip(&pool, DatabaseKind::Sqlite).await
    }

    async fn any_pool_from_test_database(url: &str) -> Result<AnyPool, DatabaseError> {
        super::initialize(Some(url)).await
    }

    async fn verify_metadata_round_trip(
        pool: &AnyPool,
        kind: DatabaseKind,
    ) -> Result<(), DatabaseError> {
        let (insert, select) = match kind {
            DatabaseKind::Postgres => (
                "INSERT INTO app_metadata (metadata_key, metadata_value) VALUES ($1, $2)",
                "SELECT metadata_value FROM app_metadata WHERE metadata_key = $1",
            ),
            DatabaseKind::Sqlite => (
                "INSERT INTO app_metadata (metadata_key, metadata_value) VALUES (?1, ?2)",
                "SELECT metadata_value FROM app_metadata WHERE metadata_key = ?1",
            ),
        };

        sqlx::query(insert)
            .bind("sample-key")
            .bind("sample-value")
            .execute(pool)
            .await?;
        let value = sqlx::query_scalar::<_, String>(select)
            .bind("sample-key")
            .fetch_one(pool)
            .await?;

        assert_eq!(value, "sample-value");
        Ok(())
    }
}

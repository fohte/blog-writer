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
    let pool = AnyPoolOptions::new().connect(database_url).await?;
    kind.migrator().run(&pool).await?;

    Ok(pool)
}

#[cfg(test)]
mod tests {
    use sqlx::{AnyPool, ConnectOptions, postgres::PgPool, sqlite::SqlitePool};

    use super::{DatabaseError, DatabaseKind};

    #[test]
    fn selects_migrator_from_database_url_scheme() {
        assert_eq!(
            [
                DatabaseKind::from_url("postgres://localhost/sample").map_err(|_| ()),
                DatabaseKind::from_url("sqlite://sample.sqlite").map_err(|_| ()),
            ],
            [Ok(DatabaseKind::Postgres), Ok(DatabaseKind::Sqlite)]
        );
    }

    #[test]
    fn rejects_unsupported_database_url_scheme() {
        let actual = DatabaseKind::from_url("mysql://localhost/sample")
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
        let pool = any_pool_from_postgres_test_pool(&pool).await?;
        verify_metadata_round_trip(&pool, DatabaseKind::Postgres).await
    }

    #[sqlx::test]
    async fn applies_sqlite_migration_and_supports_any_pool(
        pool: SqlitePool,
    ) -> Result<(), DatabaseError> {
        let pool = any_pool_from_sqlite_test_pool(&pool).await?;
        verify_metadata_round_trip(&pool, DatabaseKind::Sqlite).await
    }

    async fn any_pool_from_postgres_test_pool(pool: &PgPool) -> Result<AnyPool, DatabaseError> {
        let url = pool.connect_options().to_url_lossy().to_string();
        super::initialize(Some(&url)).await
    }

    async fn any_pool_from_sqlite_test_pool(pool: &SqlitePool) -> Result<AnyPool, DatabaseError> {
        let url = pool.connect_options().to_url_lossy().to_string();
        super::initialize(Some(&url)).await
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

use sqlx::{AnyPool, Row};

pub(super) async fn insert(pool: &AnyPool, name: &str, data: &[u8]) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO images (name, data) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING")
        .bind(name)
        .bind(data)
        .execute(pool)
        .await?;

    Ok(())
}

pub(super) async fn get(pool: &AnyPool, name: &str) -> Result<Option<Vec<u8>>, sqlx::Error> {
    let row = sqlx::query("SELECT data FROM images WHERE name = $1")
        .bind(name)
        .fetch_optional(pool)
        .await?;

    row.map(|row| row.try_get("data")).transpose()
}

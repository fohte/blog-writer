use sqlx::{AnyPool, Row};

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct StoredSourceBody {
    pub source_id: String,
    pub article_id: String,
    pub body: String,
}

pub(crate) async fn upsert(
    pool: &AnyPool,
    source_id: &str,
    article_id: &str,
    body: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO source_bodies (source_id, article_id, body) VALUES ($1, $2, $3) \
         ON CONFLICT (article_id, source_id) DO UPDATE SET body = excluded.body",
    )
    .bind(source_id)
    .bind(article_id)
    .bind(body)
    .execute(pool)
    .await?;

    Ok(())
}

pub(crate) async fn get(
    pool: &AnyPool,
    source_id: &str,
    article_id: &str,
) -> Result<Option<StoredSourceBody>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT source_id, article_id, body FROM source_bodies WHERE source_id = $1 AND article_id = $2",
    )
    .bind(source_id)
    .bind(article_id)
    .fetch_optional(pool)
    .await?;

    row.map(|row| {
        Ok(StoredSourceBody {
            source_id: row.try_get("source_id")?,
            article_id: row.try_get("article_id")?,
            body: row.try_get("body")?,
        })
    })
    .transpose()
}

pub(crate) async fn delete(
    pool: &AnyPool,
    source_id: &str,
    article_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM source_bodies WHERE source_id = $1 AND article_id = $2")
        .bind(source_id)
        .bind(article_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected() > 0)
}

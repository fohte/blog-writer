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

pub(crate) async fn upsert_if_unchanged(
    pool: &AnyPool,
    source_id: &str,
    article_id: &str,
    expected_body: Option<&str>,
    body: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "INSERT INTO source_bodies (source_id, article_id, body) VALUES ($1, $2, $3) \
         ON CONFLICT (article_id, source_id) DO UPDATE SET body = excluded.body \
         WHERE source_bodies.body = $4",
    )
    .bind(source_id)
    .bind(article_id)
    .bind(body)
    .bind(expected_body)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
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

pub(crate) async fn restore_if_unchanged(
    pool: &AnyPool,
    source_id: &str,
    article_id: &str,
    expected_body: &str,
    restore_body: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let changed = if let Some(restore_body) = restore_body {
        sqlx::query(
            "UPDATE source_bodies SET body = $4 \
             WHERE source_id = $1 AND article_id = $2 AND body = $3",
        )
        .bind(source_id)
        .bind(article_id)
        .bind(expected_body)
        .bind(restore_body)
        .execute(pool)
        .await?
        .rows_affected()
            > 0
    } else {
        sqlx::query(
            "DELETE FROM source_bodies \
             WHERE source_id = $1 AND article_id = $2 AND body = $3",
        )
        .bind(source_id)
        .bind(article_id)
        .bind(expected_body)
        .execute(pool)
        .await?
        .rows_affected()
            > 0
    };
    if changed {
        return Ok(true);
    }

    let current = get(pool, source_id, article_id).await?;
    Ok(match (restore_body, current) {
        (Some(expected), Some(current)) => current.body == expected,
        (None, None) => true,
        _ => false,
    })
}

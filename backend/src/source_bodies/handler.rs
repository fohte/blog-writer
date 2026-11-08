use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    app::AppState,
    error::{ApiJson, AppError, ErrorResponse},
    html,
};

use super::{extractor, storage};

#[derive(Debug, Deserialize, ToSchema)]
pub struct FetchSourceBodyRequest {
    pub url: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveSourceBodyRequest {
    pub body: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveSourceBodyIfUnchangedRequest {
    pub body: String,
    pub expected_body: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RestoreSourceBodyRequest {
    pub expected_body: String,
    pub restore_body: Option<String>,
}

#[derive(Debug, Serialize, ToSchema, PartialEq, Eq)]
pub struct FetchSourceBodyResponse {
    pub source_id: String,
    pub title: String,
    pub final_url: String,
    /// Calendar date (`YYYY-MM-DD`) the page says it was published, if any.
    pub published_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema, PartialEq, Eq)]
pub struct SourceBodyResponse {
    pub source_id: String,
    pub article_id: String,
    pub body: String,
}

#[utoipa::path(
    post,
    path = "/articles/{article_id}/source-bodies/{source_id}/url",
    params(
        ("article_id" = String, Path, description = "Article ID"),
        ("source_id" = String, Path, description = "Source ID")
    ),
    request_body = FetchSourceBodyRequest,
    responses(
        (status = 200, description = "Extracted title and final URL; the Markdown body is stored", body = FetchSourceBodyResponse),
        (status = 400, description = "Invalid request body", body = ErrorResponse),
        (status = 415, description = "The fetched page is not HTML", body = ErrorResponse),
        (status = 422, description = "The page does not contain readable article content", body = ErrorResponse),
        (status = 424, description = "The source URL answered 401 or 403", body = ErrorResponse),
        (status = 502, description = "The source URL could not be fetched", body = ErrorResponse),
        (status = 503, description = "Source body storage is not configured", body = ErrorResponse)
    )
)]
pub async fn fetch_from_url(
    State(state): State<AppState>,
    Path((article_id, source_id)): Path<(String, String)>,
    ApiJson(request): ApiJson<FetchSourceBodyRequest>,
) -> Result<Json<FetchSourceBodyResponse>, AppError> {
    let pool = database(&state)?;
    let response = state
        .safe_fetch
        .fetch(&request.url)
        .await
        .map_err(|error| {
            tracing::warn!(reason = error.code(), "source URL fetch failed");
            if error.requires_login() {
                return AppError::Client {
                    status: StatusCode::FAILED_DEPENDENCY,
                    message: "Source URL requires a login".to_owned(),
                };
            }
            AppError::Client {
                status: StatusCode::BAD_GATEWAY,
                message: "Source URL could not be fetched".to_owned(),
            }
        })?;
    if !html::is_html_content_type(response.content_type.as_deref()) {
        return Err(AppError::Client {
            status: StatusCode::UNSUPPORTED_MEDIA_TYPE,
            message: "Source URL did not return HTML".to_owned(),
        });
    }

    let final_url = response.final_url.to_string();
    let html = html::decode_html(&response.body, response.content_type.as_deref());
    let document_url = final_url.clone();
    let extracted = tokio::task::spawn_blocking(move || extractor::extract(&html, &document_url))
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "source content extraction task failed");
            AppError::Internal("Source content extraction failed".to_owned())
        })?
        .map_err(|_| AppError::Client {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            message: "Readable article content could not be extracted".to_owned(),
        })?;

    store_body(pool, &source_id, &article_id, &extracted.body).await?;
    Ok(Json(FetchSourceBodyResponse {
        source_id,
        title: extracted.title,
        published_at: extracted.published_at,
        final_url,
    }))
}

#[utoipa::path(
    put,
    path = "/articles/{article_id}/source-bodies/{source_id}",
    params(
        ("article_id" = String, Path, description = "Article ID"),
        ("source_id" = String, Path, description = "Source ID")
    ),
    request_body = SaveSourceBodyRequest,
    responses(
        (status = 204, description = "Source body stored"),
        (status = 400, description = "Invalid request body", body = ErrorResponse),
        (status = 503, description = "Source body storage is not configured", body = ErrorResponse)
    )
)]
pub async fn save_body(
    State(state): State<AppState>,
    Path((article_id, source_id)): Path<(String, String)>,
    ApiJson(request): ApiJson<SaveSourceBodyRequest>,
) -> Result<StatusCode, AppError> {
    store_body(database(&state)?, &source_id, &article_id, &request.body).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/articles/{article_id}/source-bodies/{source_id}/save-if-unchanged",
    params(
        ("article_id" = String, Path, description = "Article ID"),
        ("source_id" = String, Path, description = "Source ID")
    ),
    request_body = SaveSourceBodyIfUnchangedRequest,
    responses(
        (status = 204, description = "Source body stored"),
        (status = 400, description = "Invalid request body", body = ErrorResponse),
        (status = 409, description = "Source body changed before it could be stored", body = ErrorResponse),
        (status = 503, description = "Source body storage is not configured", body = ErrorResponse)
    )
)]
pub async fn save_body_if_unchanged(
    State(state): State<AppState>,
    Path((article_id, source_id)): Path<(String, String)>,
    ApiJson(request): ApiJson<SaveSourceBodyIfUnchangedRequest>,
) -> Result<StatusCode, AppError> {
    let saved = storage::upsert_if_unchanged(
        database(&state)?,
        &source_id,
        &article_id,
        request.expected_body.as_deref(),
        &request.body,
    )
    .await
    .map_err(storage_error)?;
    if !saved {
        return Err(AppError::Client {
            status: StatusCode::CONFLICT,
            message: "Source body changed before it could be stored".to_owned(),
        });
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/articles/{article_id}/source-bodies/{source_id}/restore",
    params(
        ("article_id" = String, Path, description = "Article ID"),
        ("source_id" = String, Path, description = "Source ID")
    ),
    request_body = RestoreSourceBodyRequest,
    responses(
        (status = 204, description = "Source body restored"),
        (status = 400, description = "Invalid request body", body = ErrorResponse),
        (status = 409, description = "Source body changed before it could be restored", body = ErrorResponse),
        (status = 503, description = "Source body storage is not configured", body = ErrorResponse)
    )
)]
pub async fn restore_body(
    State(state): State<AppState>,
    Path((article_id, source_id)): Path<(String, String)>,
    ApiJson(request): ApiJson<RestoreSourceBodyRequest>,
) -> Result<StatusCode, AppError> {
    let restored = storage::restore_if_unchanged(
        database(&state)?,
        &source_id,
        &article_id,
        &request.expected_body,
        request.restore_body.as_deref(),
    )
    .await
    .map_err(storage_error)?;
    if !restored {
        return Err(AppError::Client {
            status: StatusCode::CONFLICT,
            message: "Source body changed before it could be restored".to_owned(),
        });
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/articles/{article_id}/source-bodies/{source_id}",
    params(
        ("article_id" = String, Path, description = "Article ID"),
        ("source_id" = String, Path, description = "Source ID")
    ),
    responses(
        (status = 200, description = "Stored Markdown source body", body = SourceBodyResponse),
        (status = 404, description = "Source body not found", body = ErrorResponse),
        (status = 503, description = "Source body storage is not configured", body = ErrorResponse)
    )
)]
pub async fn get_body(
    State(state): State<AppState>,
    Path((article_id, source_id)): Path<(String, String)>,
) -> Result<Json<SourceBodyResponse>, AppError> {
    storage::get(database(&state)?, &source_id, &article_id)
        .await
        .map_err(storage_error)?
        .map(|stored| {
            Json(SourceBodyResponse {
                source_id: stored.source_id,
                article_id: stored.article_id,
                body: stored.body,
            })
        })
        .ok_or(AppError::NotFound)
}

#[utoipa::path(
    delete,
    path = "/articles/{article_id}/source-bodies/{source_id}",
    params(
        ("article_id" = String, Path, description = "Article ID"),
        ("source_id" = String, Path, description = "Source ID")
    ),
    responses(
        (status = 204, description = "Source body deleted"),
        (status = 404, description = "Source body not found", body = ErrorResponse),
        (status = 503, description = "Source body storage is not configured", body = ErrorResponse)
    )
)]
pub async fn delete_body(
    State(state): State<AppState>,
    Path((article_id, source_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    if !storage::delete(database(&state)?, &source_id, &article_id)
        .await
        .map_err(storage_error)?
    {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub(super) fn database(state: &AppState) -> Result<&sqlx::AnyPool, AppError> {
    state
        .database
        .as_ref()
        .ok_or(AppError::SourceBodyStorageUnavailable)
}

pub(super) async fn store_body(
    pool: &sqlx::AnyPool,
    source_id: &str,
    article_id: &str,
    body: &str,
) -> Result<(), AppError> {
    storage::upsert(pool, source_id, article_id, body)
        .await
        .map_err(storage_error)
}

pub(super) fn storage_error(error: sqlx::Error) -> AppError {
    tracing::error!(error = %error, "source body storage failed");
    AppError::Internal("Source body storage failed".to_owned())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{Router, body::Body, http::Request};
    use indoc::indoc;
    use reqwest::Url;
    use serde_json::{Value, json};
    use sqlx::{AnyPool, ConnectOptions, postgres::PgPool, sqlite::SqlitePool};
    use tower::ServiceExt;

    use crate::{
        app::AppState,
        db::initialize,
        safe_fetch::{FetchResponse, SafeFetchError, SafeFetchFuture, SafeFetchService},
        source_bodies::router,
    };

    struct TestFetcher(Option<FetchResponse>);

    impl SafeFetchService for TestFetcher {
        fn fetch<'a>(&'a self, _url: &'a str) -> SafeFetchFuture<'a> {
            let response = self.0.clone().ok_or(SafeFetchError::DisallowedAddress);
            Box::pin(async move { response })
        }
    }

    struct LoginWallFetcher;

    impl SafeFetchService for LoginWallFetcher {
        fn fetch<'a>(&'a self, _url: &'a str) -> SafeFetchFuture<'a> {
            Box::pin(async {
                Err(SafeFetchError::HttpStatus(
                    axum::http::StatusCode::FORBIDDEN,
                ))
            })
        }
    }

    #[sqlx::test]
    async fn source_body_api_persists_and_reads_with_postgres(
        pool: PgPool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let url = pool.connect_options().to_url_lossy().to_string();
        verify_source_body_api(&url).await
    }

    #[sqlx::test]
    async fn source_body_api_persists_and_reads_with_sqlite(
        pool: SqlitePool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let url = pool.connect_options().to_url_lossy().to_string();
        verify_source_body_api(&url).await
    }

    async fn verify_source_body_api(database_url: &str) -> Result<(), Box<dyn std::error::Error>> {
        let pool = initialize(Some(database_url)).await?;
        let api = test_api(
            pool.clone(),
            Some(FetchResponse {
                final_url: Url::parse("https://example.test/articles/sample")?,
                body: br#"<html><head><title>Sample article</title></head><body><article><h1>Sample article</h1><p>This is the first paragraph with enough text for the reader extraction to identify the main article content.</p><p>Read the <a href="/guide">reference guide</a> for the complete explanation of this example.</p></article></body></html>"#.to_vec(),
                content_type: Some("text/html; charset=utf-8".to_owned()),
            }),
        );
        let fetch_error_api = test_api(pool.clone(), None);
        let login_wall_api = router().split_for_parts().0.with_state(AppState {
            database: Some(pool.clone()),
            safe_fetch: Arc::new(LoginWallFetcher),
            ..AppState::default()
        });
        let non_html_api = test_api(
            pool,
            Some(FetchResponse {
                final_url: Url::parse("https://example.test/files/document")?,
                body: b"PDF document".to_vec(),
                content_type: Some("application/pdf".to_owned()),
            }),
        );
        let extracted_body = indoc! {"
            This is the first paragraph with enough text for the reader extraction to identify the main article content.

            Read the [reference guide](https://example.test/guide) for the complete explanation of this example.
        "}
        .trim_end()
        .to_owned();

        let actual = vec![
            call_json(fetch_error_api, url_request()?).await?,
            call_json(login_wall_api, url_request()?).await?,
            call_json(non_html_api, url_request()?).await?,
            call_json(api.clone(), url_request()?).await?,
            call_json(
                api.clone(),
                Request::builder()
                    .uri("/articles/article-test/source-bodies/source-test")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .method("PUT")
                    .uri("/articles/article-other/source-bodies/source-test")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"body":"Other article body"}"#))?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .uri("/articles/article-test/source-bodies/source-test")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .uri("/articles/article-other/source-bodies/source-test")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .method("PUT")
                    .uri("/articles/article-test/source-bodies/source-test")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"body":"Pasted Markdown body"}"#))?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .uri("/articles/article-test/source-bodies/source-test")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .method("POST")
                    .uri("/articles/article-test/source-bodies/source-test/save-if-unchanged")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"expected_body":"Pasted Markdown body","body":"Research Markdown body"}"#,
                    ))?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .uri("/articles/article-test/source-bodies/source-test")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .method("POST")
                    .uri("/articles/article-test/source-bodies/source-test/save-if-unchanged")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"expected_body":"Pasted Markdown body","body":"Conflicting body"}"#,
                    ))?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .uri("/articles/article-test/source-bodies/source-test")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .method("POST")
                    .uri("/articles/article-test/source-bodies/source-test/restore")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"expected_body":"Research Markdown body","restore_body":"Prior Markdown body"}"#,
                    ))?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .uri("/articles/article-test/source-bodies/source-test")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .method("POST")
                    .uri("/articles/article-test/source-bodies/source-test/restore")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"expected_body":"Research write","restore_body":"Earlier body"}"#,
                    ))?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .uri("/articles/article-test/source-bodies/source-test")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .method("DELETE")
                    .uri("/articles/article-test/source-bodies/source-test")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .method("POST")
                    .uri("/articles/article-test/source-bodies/source-test/save-if-unchanged")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"expected_body":"Prior Markdown body","body":"Research after deletion"}"#,
                    ))?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .uri("/articles/article-test/source-bodies/source-test")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .method("POST")
                    .uri("/articles/article-test/source-bodies/source-test/restore")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"expected_body":"Research after deletion","restore_body":null}"#,
                    ))?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .uri("/articles/article-test/source-bodies/source-test")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .method("POST")
                    .uri("/articles/article-test/source-bodies/source-new/save-if-unchanged")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"expected_body":null,"body":"New source body"}"#,
                    ))?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .uri("/articles/article-test/source-bodies/source-new")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .method("PUT")
                    .uri("/articles/article-test/source-bodies/source-new")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"body":"Concurrent source body"}"#,
                    ))?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .method("POST")
                    .uri("/articles/article-test/source-bodies/source-new/save-if-unchanged")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"expected_body":null,"body":"Lost research update"}"#,
                    ))?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .uri("/articles/article-test/source-bodies/source-new")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .method("DELETE")
                    .uri("/articles/article-test/source-bodies/source-new")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api.clone(),
                Request::builder()
                    .uri("/articles/article-test/source-bodies/source-new")
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api,
                Request::builder()
                    .uri("/articles/article-other/source-bodies/source-test")
                    .body(Body::empty())?,
            )
            .await?,
        ];

        assert_eq!(
            actual,
            vec![
                (502, json!({"error": "Source URL could not be fetched"})),
                (424, json!({"error": "Source URL requires a login"})),
                (415, json!({"error": "Source URL did not return HTML"})),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "title": "Sample article",
                        "final_url": "https://example.test/articles/sample",
                        "published_at": null
                    })
                ),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "article_id": "article-test",
                        "body": extracted_body
                    })
                ),
                (204, Value::Null),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "article_id": "article-test",
                        "body": extracted_body
                    })
                ),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "article_id": "article-other",
                        "body": "Other article body"
                    })
                ),
                (204, Value::Null),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "article_id": "article-test",
                        "body": "Pasted Markdown body"
                    })
                ),
                (204, Value::Null),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "article_id": "article-test",
                        "body": "Research Markdown body"
                    })
                ),
                (
                    409,
                    json!({"error": "Source body changed before it could be stored"})
                ),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "article_id": "article-test",
                        "body": "Research Markdown body"
                    })
                ),
                (204, Value::Null),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "article_id": "article-test",
                        "body": "Prior Markdown body"
                    })
                ),
                (
                    409,
                    json!({"error": "Source body changed before it could be restored"})
                ),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "article_id": "article-test",
                        "body": "Prior Markdown body"
                    })
                ),
                (204, Value::Null),
                (
                    409,
                    json!({"error": "Source body changed before it could be stored"})
                ),
                (404, json!({"error": "Not Found"})),
                (204, Value::Null),
                (404, json!({"error": "Not Found"})),
                (204, Value::Null),
                (
                    200,
                    json!({
                        "source_id": "source-new",
                        "article_id": "article-test",
                        "body": "New source body"
                    })
                ),
                (204, Value::Null),
                (
                    409,
                    json!({"error": "Source body changed before it could be stored"})
                ),
                (
                    200,
                    json!({
                        "source_id": "source-new",
                        "article_id": "article-test",
                        "body": "Concurrent source body"
                    })
                ),
                (204, Value::Null),
                (404, json!({"error": "Not Found"})),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "article_id": "article-other",
                        "body": "Other article body"
                    })
                ),
            ]
        );

        Ok(())
    }

    fn test_api(pool: AnyPool, response: Option<FetchResponse>) -> Router {
        let state = AppState {
            database: Some(pool),
            safe_fetch: Arc::new(TestFetcher(response)),
            ..AppState::default()
        };
        router().split_for_parts().0.with_state(state)
    }

    fn url_request() -> Result<Request<Body>, axum::http::Error> {
        Request::builder()
            .method("POST")
            .uri("/articles/article-test/source-bodies/source-test/url")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"url":"https://example.test/articles/sample"}"#,
            ))
    }

    async fn call_json(
        api: Router,
        request: Request<Body>,
    ) -> Result<(u16, Value), Box<dyn std::error::Error>> {
        let response = api.oneshot(request).await?;
        let status = response.status().as_u16();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await?;
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)?
        };
        Ok((status, body))
    }
}

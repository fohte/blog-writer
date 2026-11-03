use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    app::AppState,
    config::{ExportDestination, ExportFormat},
    error::{ApiJson, AppError, ErrorResponse},
    export::github::{ExportError, RemoteFile},
};

#[derive(Debug, Serialize, ToSchema)]
pub struct DestinationListResponse {
    pub destinations: Vec<DestinationResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DestinationResponse {
    pub id: String,
    pub format: ExportFormat,
    pub frontmatter_template: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SlugQuery {
    pub slug: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ArticleFileResponse {
    pub content: Option<String>,
    pub sha: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PublishArticleRequest {
    pub slug: String,
    pub content: String,
    pub sha: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PublishArticleResponse {
    pub url: String,
}

#[utoipa::path(
    get,
    path = "/export/destinations",
    responses(
        (status = 200, description = "Available export destinations", body = DestinationListResponse),
        (status = 503, description = "Export publishing is not configured", body = ErrorResponse)
    )
)]
pub async fn list_destinations(
    State(state): State<AppState>,
) -> Result<Json<DestinationListResponse>, AppError> {
    let export = state.export.as_ref().ok_or(AppError::ExportUnavailable)?;
    let destinations = export
        .destinations()
        .iter()
        .map(to_destination_response)
        .collect();

    Ok(Json(DestinationListResponse { destinations }))
}

#[utoipa::path(
    get,
    path = "/export/{destination_id}/articles/{article_id}",
    params(
        ("destination_id" = String, Path, description = "Configured export destination ID"),
        ("article_id" = String, Path, description = "Article ID"),
        ("slug" = String, Query, description = "Destination file slug")
    ),
    responses(
        (status = 200, description = "Current file contents, or null when the file does not exist", body = ArticleFileResponse),
        (status = 404, description = "Destination not found", body = ErrorResponse),
        (status = 503, description = "Export publishing is not configured", body = ErrorResponse)
    )
)]
pub async fn get_article_file(
    State(state): State<AppState>,
    Path((destination_id, article_id)): Path<(String, String)>,
    Query(query): Query<SlugQuery>,
) -> Result<Json<ArticleFileResponse>, AppError> {
    let export = state.export.as_ref().ok_or(AppError::ExportUnavailable)?;
    let destination = find_destination(export.destinations(), &destination_id)?;
    let file = export
        .get_article_file(destination, &article_id, &query.slug)
        .await
        .map_err(map_export_error)?;

    Ok(Json(to_article_file_response(file)))
}

#[utoipa::path(
    post,
    path = "/export/{destination_id}/articles/{article_id}",
    params(
        ("destination_id" = String, Path, description = "Configured export destination ID"),
        ("article_id" = String, Path, description = "Article ID")
    ),
    request_body = PublishArticleRequest,
    responses(
        (status = 200, description = "Pull request URL", body = PublishArticleResponse),
        (status = 404, description = "Destination not found", body = ErrorResponse),
        (status = 409, description = "Remote file changed; fetch its current version before retrying", body = ErrorResponse),
        (status = 503, description = "Export publishing is not configured", body = ErrorResponse)
    )
)]
pub async fn publish_article(
    State(state): State<AppState>,
    Path((destination_id, article_id)): Path<(String, String)>,
    ApiJson(request): ApiJson<PublishArticleRequest>,
) -> Result<Json<PublishArticleResponse>, AppError> {
    let export = state.export.as_ref().ok_or(AppError::ExportUnavailable)?;
    let destination = find_destination(export.destinations(), &destination_id)?;
    let url = export
        .publish_article(destination, &article_id, &request)
        .await
        .map_err(map_export_error)?;

    Ok(Json(PublishArticleResponse { url }))
}

fn find_destination<'a>(
    destinations: &'a [ExportDestination],
    id: &str,
) -> Result<&'a ExportDestination, AppError> {
    destinations
        .iter()
        .find(|destination| destination.id == id)
        .ok_or(AppError::NotFound)
}

fn to_destination_response(destination: &ExportDestination) -> DestinationResponse {
    DestinationResponse {
        id: destination.id.clone(),
        format: destination.format,
        frontmatter_template: destination.frontmatter_template.clone(),
    }
}

fn to_article_file_response(file: Option<RemoteFile>) -> ArticleFileResponse {
    match file {
        Some(file) => ArticleFileResponse {
            content: Some(file.content),
            sha: Some(file.sha),
        },
        None => ArticleFileResponse {
            content: None,
            sha: None,
        },
    }
}

fn map_export_error(error: ExportError) -> AppError {
    match error {
        ExportError::InvalidInput => AppError::Client {
            status: axum::http::StatusCode::BAD_REQUEST,
            message: "Invalid article ID or slug".to_owned(),
        },
        ExportError::RemoteConflict => AppError::Client {
            status: axum::http::StatusCode::CONFLICT,
            message: "The remote file changed. Fetch its current version before publishing again."
                .to_owned(),
        },
        other => AppError::Internal(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use axum::{body::to_bytes, response::IntoResponse};
    use serde_json::{Value, json};

    use super::{RemoteFile, map_export_error, to_article_file_response};
    use crate::export::github::ExportError;

    #[test]
    fn returns_null_fields_when_remote_file_is_missing() {
        assert_eq!(
            serde_json::to_value(to_article_file_response(None)).unwrap(),
            serde_json::json!({ "content": null, "sha": null })
        );
    }

    #[test]
    fn returns_remote_file_fields() {
        assert_eq!(
            serde_json::to_value(to_article_file_response(Some(RemoteFile {
                content: "body".to_owned(),
                sha: "blob-sha".to_owned(),
            })))
            .unwrap(),
            serde_json::json!({ "content": "body", "sha": "blob-sha" })
        );
    }

    #[tokio::test]
    async fn reports_remote_sha_conflicts_as_retriable_conflicts() {
        let response = map_export_error(ExportError::RemoteConflict).into_response();
        let actual_status = response.status().as_u16();
        let actual_body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();

        assert_eq!(
            (actual_status, actual_body),
            (
                409,
                json!({
                    "error": "The remote file changed. Fetch its current version before publishing again."
                })
            )
        );
    }
}

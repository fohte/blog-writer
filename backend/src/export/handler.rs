use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::{
    app::AppState,
    config::{ExportDestination, ExportFormat},
    error::{ApiJson, AppError, ErrorResponse},
    export::github::{ArticleContent, ExportError, validate_article_target},
    images,
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

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SlugQuery {
    /// Slug that starts with an ASCII letter or digit and contains only ASCII letters, digits, dots, underscores, or hyphens.
    #[param(pattern = "^[A-Za-z0-9][A-Za-z0-9._-]*$")]
    pub slug: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ArticleFileResponse {
    #[schema(required = true)]
    pub content: Option<String>,
    #[schema(required = true)]
    pub sha: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PublishArticleRequest {
    /// Slug that starts with an ASCII letter or digit and contains only ASCII letters, digits, dots, underscores, or hyphens.
    #[schema(pattern = "^[A-Za-z0-9][A-Za-z0-9._-]*$")]
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
        SlugQuery
    ),
    responses(
        (status = 200, description = "Current file contents, or null when the file does not exist", body = ArticleFileResponse),
        (status = 400, description = "Invalid article ID or slug", body = ErrorResponse),
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

    Ok(Json(match file {
        Some(file) => ArticleFileResponse {
            content: Some(images::restore_draft_links(&state, file.content).await?),
            sha: Some(file.sha),
        },
        None => ArticleFileResponse {
            content: None,
            sha: None,
        },
    }))
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
        (status = 400, description = "Invalid article ID or slug, or more than 50 unregistered HTTP(S) CardLink hrefs", body = ErrorResponse),
        (status = 404, description = "Destination not found", body = ErrorResponse),
        (status = 409, description = "Remote file changed; fetch its current version before retrying", body = ErrorResponse),
        (status = 422, description = "The article links to an image that is not stored", body = ErrorResponse),
        (status = 500, description = "Export failed, including an image upload failure or a conflict while updating OGP metadata after the article commit", body = ErrorResponse),
        (status = 503, description = "Export publishing or, for an article with images, image publishing is not configured", body = ErrorResponse)
    )
)]
pub async fn publish_article(
    State(state): State<AppState>,
    Path((destination_id, article_id)): Path<(String, String)>,
    ApiJson(request): ApiJson<PublishArticleRequest>,
) -> Result<Json<PublishArticleResponse>, AppError> {
    let export = state.export.as_ref().ok_or(AppError::ExportUnavailable)?;
    let destination = find_destination(export.destinations(), &destination_id)?;
    // Rejected input must not make the draft's images public.
    validate_article_target(&article_id, &request.slug).map_err(map_export_error)?;
    let article = ArticleContent {
        slug: request.slug,
        content: images::publish_draft_images(&state, request.content).await?,
        sha: request.sha,
    };
    let url = export
        .publish_article(
            destination,
            &article_id,
            &article,
            Arc::clone(&state.safe_fetch),
        )
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

fn map_export_error(error: ExportError) -> AppError {
    match error {
        ExportError::InvalidInput => AppError::Client {
            status: axum::http::StatusCode::BAD_REQUEST,
            message: "Invalid article ID or slug".to_owned(),
        },
        ExportError::TooManyOgpHrefs => AppError::Client {
            status: axum::http::StatusCode::BAD_REQUEST,
            message: "Article contains more than 50 unregistered HTTP(S) CardLink hrefs".to_owned(),
        },
        ExportError::RemoteConflict => AppError::Client {
            status: axum::http::StatusCode::CONFLICT,
            message: "The remote file changed. Fetch its current version before publishing again."
                .to_owned(),
        },
        other => AppError::Internal(other.to_string()),
    }
}

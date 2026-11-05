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
};

use super::{
    service::{ArticleFileContent, LocalFileSyncService},
    state::{FileSyncError, FileSyncStatus},
};

#[derive(Debug, Serialize, ToSchema, PartialEq, Eq)]
pub struct FileSyncConfigurationResponse {
    pub enabled: bool,
    pub directory: Option<String>,
}

#[derive(Debug, Serialize, ToSchema, PartialEq, Eq)]
pub struct ArticleFileSyncResponse {
    pub path: Option<String>,
    pub status: ArticleFileSyncStatus,
    pub content: Option<String>,
    pub content_hash: Option<String>,
}

#[derive(Debug, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ArticleFileSyncStatus {
    Unset,
    Synced,
    ExternalChanged,
}

impl From<FileSyncStatus> for ArticleFileSyncStatus {
    fn from(status: FileSyncStatus) -> Self {
        match status {
            FileSyncStatus::Unset => Self::Unset,
            FileSyncStatus::Synced => Self::Synced,
            FileSyncStatus::ExternalChanged => Self::ExternalChanged,
        }
    }
}

impl From<ArticleFileContent> for ArticleFileSyncResponse {
    fn from(content: ArticleFileContent) -> Self {
        Self {
            path: content.state.path,
            status: content.state.status.into(),
            content: content.content,
            content_hash: content.content_hash,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetArticleFileRequest {
    pub path: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ResumeArticleFileSyncRequest {
    pub hash: String,
}

#[utoipa::path(
    get,
    path = "/file-sync/configuration",
    responses((status = 200, description = "File synchronization configuration", body = FileSyncConfigurationResponse))
)]
pub async fn get_configuration(
    State(state): State<AppState>,
) -> Json<FileSyncConfigurationResponse> {
    let Some(service) = state.file_sync else {
        return Json(FileSyncConfigurationResponse {
            enabled: false,
            directory: None,
        });
    };
    Json(FileSyncConfigurationResponse {
        enabled: true,
        directory: Some(service.directory().to_string_lossy().into_owned()),
    })
}

#[utoipa::path(
    get,
    path = "/articles/{article_id}/file-sync",
    params(("article_id" = String, Path, description = "Article ID")),
    responses(
        (status = 200, description = "Current synchronization file and state", body = ArticleFileSyncResponse),
        (status = 400, description = "Invalid synchronization file path", body = ErrorResponse),
        (status = 404, description = "Article was not found", body = ErrorResponse),
        (status = 422, description = "Synchronization file is not valid UTF-8", body = ErrorResponse),
        (status = 503, description = "File synchronization is not configured", body = ErrorResponse)
    )
)]
pub async fn get_article_file(
    State(state): State<AppState>,
    Path(article_id): Path<String>,
) -> Result<Json<ArticleFileSyncResponse>, AppError> {
    let service = service(&state)?;
    service
        .article_file_state(&article_id)
        .await
        .map(ArticleFileSyncResponse::from)
        .map(Json)
        .map_err(map_error)
}

#[utoipa::path(
    put,
    path = "/articles/{article_id}/file-sync",
    params(("article_id" = String, Path, description = "Article ID")),
    request_body = SetArticleFileRequest,
    responses(
        (status = 200, description = "Synchronization file selected", body = ArticleFileSyncResponse),
        (status = 400, description = "Invalid synchronization file path", body = ErrorResponse),
        (status = 404, description = "Article was not found", body = ErrorResponse),
        (status = 422, description = "Synchronization file is not valid UTF-8", body = ErrorResponse),
        (status = 503, description = "File synchronization is not configured", body = ErrorResponse)
    )
)]
pub async fn set_article_file(
    State(state): State<AppState>,
    Path(article_id): Path<String>,
    ApiJson(request): ApiJson<SetArticleFileRequest>,
) -> Result<Json<ArticleFileSyncResponse>, AppError> {
    service(&state)?
        .set_article_file(&article_id, &request.path)
        .await
        .map(ArticleFileSyncResponse::from)
        .map(Json)
        .map_err(map_error)
}

#[utoipa::path(
    post,
    path = "/articles/{article_id}/file-sync/resume",
    params(("article_id" = String, Path, description = "Article ID")),
    request_body = ResumeArticleFileSyncRequest,
    responses(
        (status = 200, description = "File synchronization resumed after import", body = ArticleFileSyncResponse),
        (status = 400, description = "No synchronization file is selected", body = ErrorResponse),
        (status = 404, description = "Article was not found", body = ErrorResponse),
        (status = 409, description = "The file changed after it was read", body = ErrorResponse),
        (status = 422, description = "Synchronization file is not valid UTF-8", body = ErrorResponse),
        (status = 503, description = "File synchronization is not configured", body = ErrorResponse)
    )
)]
pub async fn resume_article_file_sync(
    State(state): State<AppState>,
    Path(article_id): Path<String>,
    ApiJson(request): ApiJson<ResumeArticleFileSyncRequest>,
) -> Result<Json<ArticleFileSyncResponse>, AppError> {
    service(&state)?
        .resume_article_file_sync(&article_id, &request.hash)
        .await
        .map(ArticleFileSyncResponse::from)
        .map(Json)
        .map_err(map_error)
}

#[utoipa::path(
    post,
    path = "/articles/{article_id}/file-sync/overwrite",
    params(("article_id" = String, Path, description = "Article ID")),
    responses(
        (status = 200, description = "Article body written to the synchronization file", body = ArticleFileSyncResponse),
        (status = 400, description = "No synchronization file is selected", body = ErrorResponse),
        (status = 404, description = "Article was not found", body = ErrorResponse),
        (status = 503, description = "File synchronization is not configured", body = ErrorResponse)
    )
)]
pub async fn overwrite_article_file(
    State(state): State<AppState>,
    Path(article_id): Path<String>,
) -> Result<Json<ArticleFileSyncResponse>, AppError> {
    service(&state)?
        .overwrite_article_file(&article_id)
        .await
        .map(ArticleFileSyncResponse::from)
        .map(Json)
        .map_err(map_error)
}

fn service(state: &AppState) -> Result<&LocalFileSyncService, AppError> {
    state
        .file_sync
        .as_ref()
        .ok_or(AppError::FileSyncUnavailable)
}

fn map_error(error: FileSyncError) -> AppError {
    match error {
        FileSyncError::ArticleNotFound => AppError::NotFound,
        FileSyncError::InvalidPath => AppError::Client {
            status: StatusCode::BAD_REQUEST,
            message: "Invalid synchronization file request".to_owned(),
        },
        FileSyncError::FileChanged => AppError::Client {
            status: StatusCode::CONFLICT,
            message: "Synchronization file changed; reload it before continuing".to_owned(),
        },
        FileSyncError::NonUtf8 => AppError::Client {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            message: "Synchronization file is not valid UTF-8".to_owned(),
        },
        error => {
            tracing::error!(%error, "article file synchronization failed");
            AppError::Internal("Article file synchronization failed".to_owned())
        }
    }
}

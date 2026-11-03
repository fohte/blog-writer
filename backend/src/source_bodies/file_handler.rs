use axum::{
    Json,
    extract::{DefaultBodyLimit, Multipart, Path, State, multipart::MultipartRejection},
    http::StatusCode,
};
use serde::Serialize;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    error::{AppError, ErrorResponse},
};

use super::{file_import, handler};

const MAX_UPLOAD_SIZE: usize = 25 * 1024 * 1024;

#[derive(ToSchema)]
#[expect(
    dead_code,
    reason = "This type describes the multipart request in OpenAPI"
)]
pub(crate) struct FileUploadRequest {
    #[schema(value_type = String, format = Binary)]
    pub file: String,
}

#[derive(Debug, Serialize, ToSchema, PartialEq, Eq)]
pub(crate) struct ImportFileResponse {
    pub source_id: String,
    pub title: String,
    pub file_name: String,
}

pub(crate) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(import_file))
        .route_layer(DefaultBodyLimit::max(MAX_UPLOAD_SIZE))
}

#[utoipa::path(
    post,
    path = "/articles/{article_id}/source-bodies/{source_id}/file",
    params(
        ("article_id" = String, Path, description = "Article ID"),
        ("source_id" = String, Path, description = "Source ID")
    ),
    request_body(content = FileUploadRequest, content_type = "multipart/form-data"),
    responses(
        (status = 200, description = "File name and extracted Markdown body; the body is stored", body = ImportFileResponse),
        (status = 400, description = "The multipart request is invalid", body = ErrorResponse),
        (status = 413, description = "The uploaded file exceeds the size limit", body = ErrorResponse),
        (status = 415, description = "The file type is not supported", body = ErrorResponse),
        (status = 422, description = "The file text could not be extracted", body = ErrorResponse),
        (status = 503, description = "Source body storage is not configured", body = ErrorResponse)
    )
)]
async fn import_file(
    State(state): State<AppState>,
    Path((article_id, source_id)): Path<(String, String)>,
    multipart: Result<Multipart, MultipartRejection>,
) -> Result<Json<ImportFileResponse>, AppError> {
    let pool = handler::database(&state)?;
    let mut multipart = multipart.map_err(|error| multipart_error(error.status()))?;
    let mut uploaded_file = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| multipart_error(error.status()))?
    {
        if field.name() != Some("file") || uploaded_file.is_some() {
            return Err(invalid_multipart());
        }

        let file_name = field
            .file_name()
            .map(normalize_file_name)
            .filter(|name| !name.is_empty())
            .ok_or_else(invalid_multipart)?;
        let bytes = field
            .bytes()
            .await
            .map_err(|error| multipart_error(error.status()))?;
        uploaded_file = Some((file_name, bytes));
    }

    let (file_name, bytes) = uploaded_file.ok_or_else(invalid_multipart)?;
    let title = title_from_file_name(&file_name);
    let extraction_file_name = file_name.clone();
    let body = tokio::task::spawn_blocking(move || {
        file_import::import_file(&extraction_file_name, &bytes)
    })
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "source file extraction task failed");
        AppError::Internal("Source file extraction failed".to_owned())
    })?
    .map_err(|error| match error {
        file_import::FileImportError::UnsupportedFileType => AppError::Client {
            status: StatusCode::UNSUPPORTED_MEDIA_TYPE,
            message: "Source file type is not supported".to_owned(),
        },
        file_import::FileImportError::InvalidEncoding
        | file_import::FileImportError::InvalidPdf
        | file_import::FileImportError::EmptyBody => AppError::Client {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            message: "Readable source text could not be extracted".to_owned(),
        },
        file_import::FileImportError::Io(error) => {
            tracing::error!(error = %error, "source file processing failed");
            AppError::Internal("Source file processing failed".to_owned())
        }
    })?;

    handler::store_body(pool, &source_id, &article_id, &body).await?;

    Ok(Json(ImportFileResponse {
        source_id,
        title,
        file_name,
    }))
}

fn normalize_file_name(file_name: &str) -> String {
    file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .to_owned()
}

fn title_from_file_name(file_name: &str) -> String {
    let title = file_name
        .rsplit_once('.')
        .map(|(title, _)| title)
        .filter(|title| !title.is_empty())
        .unwrap_or(file_name);
    title.to_owned()
}

fn invalid_multipart() -> AppError {
    AppError::Client {
        status: StatusCode::BAD_REQUEST,
        message: "Invalid file upload".to_owned(),
    }
}

fn multipart_error(status: StatusCode) -> AppError {
    if status == StatusCode::PAYLOAD_TOO_LARGE {
        AppError::Client {
            status,
            message: "Uploaded file exceeds the size limit".to_owned(),
        }
    } else {
        invalid_multipart()
    }
}

#[cfg(test)]
mod tests {
    use axum::{Router, body::Body, http::Request};
    use indoc::indoc;
    use serde_json::{Value, json};
    use sqlx::{AnyPool, ConnectOptions, postgres::PgPool, sqlite::SqlitePool};
    use tower::ServiceExt;

    use super::MAX_UPLOAD_SIZE;
    use crate::{app::AppState, db::initialize, source_bodies::router};

    const FILE_BOUNDARY: &str = "upload-boundary";

    #[sqlx::test]
    async fn imports_files_with_postgres(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
        let url = pool.connect_options().to_url_lossy().to_string();
        verify_file_import(&url).await
    }

    #[sqlx::test]
    async fn imports_files_with_sqlite(pool: SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
        let url = pool.connect_options().to_url_lossy().to_string();
        verify_file_import(&url).await
    }

    async fn verify_file_import(database_url: &str) -> Result<(), Box<dyn std::error::Error>> {
        let pool = initialize(Some(database_url)).await?;
        let api = test_api(pool);
        let markdown_body = indoc! {"
            # 仮の資料
            本文
        "};
        let actual = vec![
            call_json(
                api.clone(),
                upload_request("brief.md", "text/markdown", markdown_body.as_bytes())?,
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
                upload_request("broken.pdf", "application/pdf", b"not a PDF")?,
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
                upload_request(
                    "research.pdf",
                    "application/pdf",
                    include_bytes!("../../tests/fixtures/japanese-identity-h.pdf"),
                )?,
            )
            .await?,
            call_json(
                api,
                Request::builder()
                    .uri("/articles/article-test/source-bodies/source-test")
                    .body(Body::empty())?,
            )
            .await?,
        ];

        assert_eq!(
            actual,
            vec![
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "title": "brief",
                        "file_name": "brief.md"
                    })
                ),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "article_id": "article-test",
                        "body": markdown_body
                    })
                ),
                (
                    422,
                    json!({"error": "Readable source text could not be extracted"})
                ),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "article_id": "article-test",
                        "body": markdown_body
                    })
                ),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "title": "research",
                        "file_name": "research.pdf"
                    })
                ),
                (
                    200,
                    json!({
                        "source_id": "source-test",
                        "article_id": "article-test",
                        "body": "日本語の本文を抽出します。"
                    })
                ),
            ]
        );

        Ok(())
    }

    #[tokio::test]
    async fn returns_json_errors_for_invalid_and_oversized_uploads()
    -> Result<(), Box<dyn std::error::Error>> {
        let pool = initialize(Some("sqlite::memory:")).await?;
        let api = test_api(pool);
        let oversized_body = vec![b'x'; MAX_UPLOAD_SIZE + 1];
        let actual = vec![
            call_json(
                api.clone(),
                Request::builder()
                    .method("POST")
                    .uri("/articles/article-test/source-bodies/source-test/file")
                    .header(
                        "content-type",
                        "multipart/form-data; boundary=upload-boundary",
                    )
                    .body(Body::empty())?,
            )
            .await?,
            call_json(
                api,
                upload_request("large.md", "text/markdown", &oversized_body)?,
            )
            .await?,
        ];

        assert_eq!(
            actual,
            vec![
                (400, json!({"error": "Invalid file upload"})),
                (
                    413,
                    json!({"error": "Uploaded file exceeds the size limit"})
                ),
            ]
        );

        Ok(())
    }

    #[tokio::test]
    async fn returns_service_unavailable_without_source_body_storage()
    -> Result<(), Box<dyn std::error::Error>> {
        let api = router().split_for_parts().0.with_state(AppState::default());
        let actual = call_json(
            api,
            upload_request("brief.md", "text/markdown", b"A short source body")?,
        )
        .await?;

        assert_eq!(
            actual,
            (
                503,
                json!({"error": "Source body storage is not configured"})
            )
        );

        Ok(())
    }

    fn test_api(pool: AnyPool) -> Router {
        let state = AppState {
            database: Some(pool),
            ..AppState::default()
        };
        router().split_for_parts().0.with_state(state)
    }

    fn upload_request(
        file_name: &str,
        content_type: &str,
        file_body: &[u8],
    ) -> Result<Request<Body>, axum::http::Error> {
        let mut body = format!("--{FILE_BOUNDARY}").into_bytes();
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"")
                .as_bytes(),
        );
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(format!("Content-Type: {content_type}").as_bytes());
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(file_body);
        body.extend_from_slice(b"\r\n--");
        body.extend_from_slice(FILE_BOUNDARY.as_bytes());
        body.extend_from_slice(b"--\r\n");
        Request::builder()
            .method("POST")
            .uri("/articles/article-test/source-bodies/source-test/file")
            .header(
                "content-type",
                format!("multipart/form-data; boundary={FILE_BOUNDARY}"),
            )
            .body(Body::from(body))
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

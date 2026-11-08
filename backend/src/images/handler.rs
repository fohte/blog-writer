use axum::{
    Json,
    extract::{DefaultBodyLimit, Multipart, Path, State, multipart::MultipartRejection},
    http::{
        StatusCode,
        header::{CACHE_CONTROL, CONTENT_TYPE, X_CONTENT_TYPE_OPTIONS},
    },
    response::IntoResponse,
};
use serde::Serialize;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    error::{AppError, ErrorResponse},
};

use super::{
    process::{self, ImageProcessError},
    storage,
};

const MAX_UPLOAD_SIZE: usize = 20 * 1024 * 1024;

#[derive(ToSchema)]
#[expect(
    dead_code,
    reason = "This type describes the multipart request in OpenAPI"
)]
pub(crate) struct ImageUploadRequest {
    #[schema(value_type = String, format = Binary)]
    pub file: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct ImageUploadResponse {
    /// Path to write as the Markdown image destination.
    pub src: String,
}

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(upload_image))
        .route_layer(DefaultBodyLimit::max(MAX_UPLOAD_SIZE))
        .routes(routes!(get_image))
}

#[utoipa::path(
    post,
    path = "/images",
    request_body(content = ImageUploadRequest, content_type = "multipart/form-data"),
    responses(
        (status = 200, description = "The image is stored privately", body = ImageUploadResponse),
        (status = 400, description = "The multipart request is invalid", body = ErrorResponse),
        (status = 413, description = "The image exceeds the size limit", body = ErrorResponse),
        (status = 415, description = "The image format is not supported", body = ErrorResponse),
        (status = 422, description = "The image could not be decoded", body = ErrorResponse),
        (status = 503, description = "Image storage is not configured", body = ErrorResponse)
    )
)]
async fn upload_image(
    State(state): State<AppState>,
    multipart: Result<Multipart, MultipartRejection>,
) -> Result<Json<ImageUploadResponse>, AppError> {
    let pool = database(&state)?;
    let bytes = read_file_field(multipart).await?;
    let image = tokio::task::spawn_blocking(move || process::process(&bytes))
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "image processing task failed");
            AppError::Internal("Image processing failed".to_owned())
        })?
        .map_err(process_error)?;

    storage::insert(pool, &image.name, &image.data)
        .await
        .map_err(database_error)?;

    Ok(Json(ImageUploadResponse {
        src: format!(
            "/api/images/{}?w={}&h={}",
            image.name, image.width, image.height
        ),
    }))
}

#[utoipa::path(
    get,
    path = "/images/{name}",
    params(("name" = String, Path, description = "Image file name")),
    responses(
        (status = 200, description = "Image bytes", content_type = "image/*"),
        (status = 404, description = "The image does not exist", body = ErrorResponse),
        (status = 503, description = "Image storage is not configured", body = ErrorResponse)
    )
)]
async fn get_image(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let pool = database(&state)?;
    let data = storage::get(pool, &name)
        .await
        .map_err(database_error)?
        .ok_or(AppError::NotFound)?;
    let content_type = if name.ends_with(".gif") {
        "image/gif"
    } else {
        "image/webp"
    };

    Ok((
        [
            (CONTENT_TYPE, content_type),
            // The name is a content hash, so the bytes never change. `private` keeps unpublished
            // images out of the CDN in front of the app.
            (CACHE_CONTROL, "private, max-age=31536000, immutable"),
            (X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        data,
    ))
}

async fn read_file_field(
    multipart: Result<Multipart, MultipartRejection>,
) -> Result<axum::body::Bytes, AppError> {
    let mut multipart = multipart.map_err(|error| multipart_error(error.status()))?;
    let mut file = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| multipart_error(error.status()))?
    {
        if field.name() != Some("file") || file.is_some() {
            return Err(invalid_multipart());
        }
        file = Some(
            field
                .bytes()
                .await
                .map_err(|error| multipart_error(error.status()))?,
        );
    }

    file.ok_or_else(invalid_multipart)
}

fn database(state: &AppState) -> Result<&sqlx::AnyPool, AppError> {
    state.database.as_ref().ok_or(AppError::Client {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "Image storage is not configured".to_owned(),
    })
}

fn database_error(error: sqlx::Error) -> AppError {
    tracing::error!(error = %error, "image storage query failed");
    AppError::Internal("Image storage failed".to_owned())
}

fn process_error(error: ImageProcessError) -> AppError {
    let (status, message) = match error {
        ImageProcessError::UnsupportedFormat => (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Image format is not supported",
        ),
        ImageProcessError::TooLarge => (
            StatusCode::PAYLOAD_TOO_LARGE,
            "Image exceeds the size limit",
        ),
        ImageProcessError::Undecodable => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "Image could not be decoded",
        ),
        ImageProcessError::Encoding => {
            return AppError::Internal("Image encoding failed".to_owned());
        }
    };
    AppError::Client {
        status,
        message: message.to_owned(),
    }
}

fn invalid_multipart() -> AppError {
    AppError::Client {
        status: StatusCode::BAD_REQUEST,
        message: "Invalid image upload".to_owned(),
    }
}

fn multipart_error(status: StatusCode) -> AppError {
    if status == StatusCode::PAYLOAD_TOO_LARGE {
        AppError::Client {
            status,
            message: "Image exceeds the size limit".to_owned(),
        }
    } else {
        invalid_multipart()
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{HeaderMap, Request},
    };
    use image::{ImageFormat, RgbaImage};
    use serde_json::{Value, json};
    use sqlx::{AnyPool, ConnectOptions, postgres::PgPool, sqlite::SqlitePool};
    use tower::ServiceExt;

    use super::{MAX_UPLOAD_SIZE, router};
    use crate::{app::AppState, db::initialize};

    const BOUNDARY: &str = "upload-boundary";
    const CRLF: &[u8] = b"\r\n";

    #[sqlx::test]
    async fn stores_and_serves_images_with_postgres(
        pool: PgPool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let url = pool.connect_options().to_url_lossy().to_string();
        verify_store_and_serve(&url).await
    }

    #[sqlx::test]
    async fn stores_and_serves_images_with_sqlite(
        pool: SqlitePool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let url = pool.connect_options().to_url_lossy().to_string();
        verify_store_and_serve(&url).await
    }

    async fn verify_store_and_serve(database_url: &str) -> Result<(), Box<dyn std::error::Error>> {
        let api = api(initialize(Some(database_url)).await?);
        let gif = encoded(ImageFormat::Gif);

        let (status, body) = call_json(api.clone(), upload_request(&gif)?).await?;
        let src = body["src"].as_str().ok_or("src should be a string")?;
        let name = src
            .strip_prefix("/api/images/")
            .and_then(|path| path.strip_suffix("?w=4&h=2"))
            .ok_or("src should be an image path with dimensions")?;

        // Uploading the same image again must not conflict with the stored row.
        let repeated = call_json(api.clone(), upload_request(&gif)?).await?;
        let response = api
            .clone()
            .oneshot(get_request(&format!("/images/{name}"))?)
            .await?;
        let (parts, served) = response.into_parts();
        let actual_status = parts.status.as_u16();
        let headers = header_values(&parts.headers);
        let served = to_bytes(served, usize::MAX).await?;

        assert_eq!(
            (
                status,
                repeated,
                actual_status,
                headers,
                served.to_vec(),
                call_json(api, get_request("/images/missing.webp")?).await?,
            ),
            (
                200,
                (200, json!({ "src": src })),
                200,
                vec![
                    ("cache-control", "private, max-age=31536000, immutable"),
                    ("content-type", "image/gif"),
                    ("x-content-type-options", "nosniff"),
                ],
                gif,
                (404, json!({ "error": "Not Found" })),
            ),
        );

        Ok(())
    }

    #[tokio::test]
    async fn returns_json_errors_for_rejected_uploads() -> Result<(), Box<dyn std::error::Error>> {
        let api = api(initialize(Some("sqlite::memory:")).await?);
        let oversized = vec![b'x'; MAX_UPLOAD_SIZE + 1];
        let actual = vec![
            call_json(api.clone(), upload_request(b"plain text")?).await?,
            call_json(api.clone(), upload_request(&oversized)?).await?,
            call_json(
                api,
                Request::builder()
                    .method("POST")
                    .uri("/images")
                    .header(
                        "content-type",
                        format!("multipart/form-data; boundary={BOUNDARY}"),
                    )
                    .body(Body::empty())?,
            )
            .await?,
        ];

        assert_eq!(
            actual,
            vec![
                (415, json!({ "error": "Image format is not supported" })),
                (413, json!({ "error": "Image exceeds the size limit" })),
                (400, json!({ "error": "Invalid image upload" })),
            ],
        );

        Ok(())
    }

    #[tokio::test]
    async fn returns_service_unavailable_without_a_database()
    -> Result<(), Box<dyn std::error::Error>> {
        let api = router().split_for_parts().0.with_state(AppState::default());

        assert_eq!(
            call_json(api, upload_request(b"plain text")?).await?,
            (503, json!({ "error": "Image storage is not configured" })),
        );

        Ok(())
    }

    fn api(pool: AnyPool) -> Router {
        router().split_for_parts().0.with_state(AppState {
            database: Some(pool),
            ..AppState::default()
        })
    }

    fn encoded(format: ImageFormat) -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        RgbaImage::new(4, 2)
            .write_to(&mut bytes, format)
            .expect("test image should encode");
        bytes.into_inner()
    }

    fn header_values(headers: &HeaderMap) -> Vec<(&str, &str)> {
        let mut values: Vec<_> = headers
            .iter()
            .filter(|(name, _)| name.as_str() != "content-length")
            .map(|(name, value)| (name.as_str(), value.to_str().unwrap_or_default()))
            .collect();
        values.sort_unstable();
        values
    }

    fn get_request(uri: &str) -> Result<Request<Body>, axum::http::Error> {
        Request::builder().uri(uri).body(Body::empty())
    }

    fn upload_request(file: &[u8]) -> Result<Request<Body>, axum::http::Error> {
        let body = [
            format!("--{BOUNDARY}").as_bytes(),
            CRLF,
            br#"Content-Disposition: form-data; name="file"; filename="a""#,
            CRLF,
            CRLF,
            file,
            CRLF,
            format!("--{BOUNDARY}--").as_bytes(),
            CRLF,
        ]
        .concat();
        Request::builder()
            .method("POST")
            .uri("/images")
            .header(
                "content-type",
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .body(Body::from(body))
    }

    async fn call_json(
        api: Router,
        request: Request<Body>,
    ) -> Result<(u16, Value), Box<dyn std::error::Error>> {
        let response = api.oneshot(request).await?;
        let status = response.status().as_u16();
        let bytes = to_bytes(response.into_body(), usize::MAX).await?;
        Ok((status, serde_json::from_slice(&bytes)?))
    }
}

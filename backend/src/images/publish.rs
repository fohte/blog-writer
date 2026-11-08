use std::time::Duration;

use axum::http::StatusCode;
use reqwest::{Client, header::CONTENT_TYPE};
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};

use crate::{app::AppState, config::ExportImageConfig, error::AppError, export::ExportError};

use super::{content_type, handler::database_error, storage};

const DRAFT_LINK_PREFIX: &str = "](/api/images/";
const OBJECT_PREFIX: &str = "images/";
/// The only region Cloudflare R2 accepts.
const REGION: &str = "auto";
const SIGNATURE_LIFETIME: Duration = Duration::from_secs(5 * 60);
const HASH_LENGTH: usize = 64;

#[derive(Clone)]
pub struct ImagePublisher {
    bucket: Bucket,
    credentials: Credentials,
    public_url: String,
    client: Client,
}

impl ImagePublisher {
    pub fn new(config: &ExportImageConfig) -> Result<Self, ExportError> {
        let bucket = Bucket::new(
            config.endpoint.clone(),
            UrlStyle::Path,
            config.bucket.clone(),
            REGION,
        )
        .map_err(|_| ExportError::InvalidConfiguration)?;
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| ExportError::HttpClient)?;

        Ok(Self {
            bucket,
            credentials: Credentials::new(
                config.access_key_id.clone(),
                config.secret_access_key.clone(),
            ),
            public_url: config.public_url.clone(),
            client,
        })
    }

    fn public_link_prefix(&self) -> String {
        format!("]({}/{OBJECT_PREFIX}", self.public_url)
    }

    async fn upload(&self, name: &str, data: Vec<u8>) -> Result<(), AppError> {
        let url = self
            .bucket
            .put_object(Some(&self.credentials), &format!("{OBJECT_PREFIX}{name}"))
            .sign(SIGNATURE_LIFETIME);
        let response = self
            .client
            .put(url)
            .header(CONTENT_TYPE, content_type(name))
            .body(data)
            .send()
            .await
            .map_err(|error| {
                // The URL carries the request signature.
                tracing::error!(error = %error.without_url(), "image upload request failed");
                upload_failed()
            })?;

        if response.status().is_success() {
            Ok(())
        } else {
            tracing::error!(status = %response.status(), "image upload was rejected");
            Err(upload_failed())
        }
    }
}

/// Uploads the images a draft links to and returns the draft with public links.
pub(crate) async fn publish_draft_images(
    state: &AppState,
    content: String,
) -> Result<String, AppError> {
    let names = linked_images(&content, DRAFT_LINK_PREFIX);
    if names.is_empty() {
        return Ok(content);
    }
    let (Some(publisher), Some(pool)) = (state.image_publisher.as_ref(), state.database.as_ref())
    else {
        return Err(AppError::Client {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: "Image publishing is not configured".to_owned(),
        });
    };

    // A broken link must not leave the other images of the draft public.
    for name in &names {
        if !storage::exists(pool, name).await.map_err(database_error)? {
            return Err(missing_image());
        }
    }

    let public_prefix = publisher.public_link_prefix();
    let mut published = content;
    for name in &names {
        let data = storage::get(pool, name)
            .await
            .map_err(database_error)?
            .ok_or_else(missing_image)?;
        publisher.upload(name, data).await?;
        published = published.replace(
            &format!("{DRAFT_LINK_PREFIX}{name}"),
            &format!("{public_prefix}{name}"),
        );
    }
    Ok(published)
}

/// Turns public links back into draft links so that a published article compares equal to its
/// draft. Images uploaded by other means have no draft link and keep their public URL.
pub(crate) async fn restore_draft_links(
    state: &AppState,
    content: String,
) -> Result<String, AppError> {
    let (Some(publisher), Some(pool)) = (state.image_publisher.as_ref(), state.database.as_ref())
    else {
        return Ok(content);
    };

    let public_prefix = publisher.public_link_prefix();
    let mut restored = content.clone();
    for name in linked_images(&content, &public_prefix) {
        if storage::exists(pool, &name).await.map_err(database_error)? {
            restored = restored.replace(
                &format!("{public_prefix}{name}"),
                &format!("{DRAFT_LINK_PREFIX}{name}"),
            );
        }
    }
    Ok(restored)
}

fn linked_images(content: &str, prefix: &str) -> Vec<String> {
    let mut names: Vec<String> = content
        .match_indices(prefix)
        .filter_map(|(index, _)| image_name_at(&content[index + prefix.len()..]))
        .map(str::to_owned)
        .collect();
    names.sort_unstable();
    names.dedup();
    names
}

fn image_name_at(text: &str) -> Option<&str> {
    let hash_length = text
        .bytes()
        .take_while(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
        .count();
    if hash_length != HASH_LENGTH {
        return None;
    }
    [".webp", ".gif"]
        .into_iter()
        .find(|extension| text[HASH_LENGTH..].starts_with(extension))
        .map(|extension| &text[..HASH_LENGTH + extension.len()])
}

fn missing_image() -> AppError {
    AppError::Client {
        status: StatusCode::UNPROCESSABLE_ENTITY,
        message: "Article links to an image that is not stored".to_owned(),
    }
}

fn upload_failed() -> AppError {
    AppError::Internal("Image upload failed".to_owned())
}

#[cfg(test)]
mod tests {
    use axum::{body::to_bytes, http::StatusCode, response::IntoResponse};
    use reqwest::Url;
    use serde_json::{Value, json};
    use wiremock::{Mock, MockServer, ResponseTemplate, matchers::method};

    use super::{ImagePublisher, publish_draft_images, restore_draft_links};
    use crate::{
        app::AppState, config::ExportImageConfig, db::initialize, error::AppError, images::storage,
    };

    const PUBLIC_URL: &str = "https://assets.example";

    fn webp_name() -> String {
        format!("{}.webp", "a".repeat(64))
    }

    fn gif_name() -> String {
        format!("{}.gif", "b".repeat(64))
    }

    async fn state_with_storage(server: &MockServer) -> AppState {
        let publisher = ImagePublisher::new(&ExportImageConfig {
            endpoint: Url::parse(&server.uri()).unwrap(),
            bucket: "site-assets".to_owned(),
            access_key_id: "example-key".to_owned(),
            secret_access_key: "example-secret".to_owned(),
            public_url: PUBLIC_URL.to_owned(),
        })
        .unwrap();
        AppState {
            database: Some(initialize(Some("sqlite::memory:")).await.unwrap()),
            image_publisher: Some(publisher),
            ..AppState::default()
        }
    }

    async fn store(state: &AppState, name: &str, data: &[u8]) {
        storage::insert(state.database.as_ref().unwrap(), name, data)
            .await
            .unwrap();
    }

    async fn accepting_server() -> MockServer {
        let server = MockServer::start().await;
        Mock::given(method("PUT"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;
        server
    }

    async fn uploads(server: &MockServer) -> Vec<(String, String, Vec<u8>)> {
        let mut uploads: Vec<_> = server
            .received_requests()
            .await
            .unwrap()
            .into_iter()
            .map(|request| {
                (
                    request.url.path().to_owned(),
                    request.headers["content-type"].to_str().unwrap().to_owned(),
                    request.body,
                )
            })
            .collect();
        uploads.sort();
        uploads
    }

    async fn error_parts(error: AppError) -> (StatusCode, Value) {
        let response = error.into_response();
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }

    #[tokio::test]
    async fn uploads_linked_images_and_rewrites_only_the_path() {
        let server = accepting_server().await;
        let state = state_with_storage(&server).await;
        let (webp, gif) = (webp_name(), gif_name());
        store(&state, &webp, b"webp bytes").await;
        store(&state, &gif, b"gif bytes").await;
        let draft = format!(
            r"![a](/api/images/{webp}?w=4\&h=2) ![b](/api/images/{gif}?w=1\&h=1) ![again](/api/images/{webp}?w=4\&h=2) [doc](/api/health)"
        );

        let actual = publish_draft_images(&state, draft).await.unwrap();

        assert_eq!(
            (actual, uploads(&server).await),
            (
                format!(
                    r"![a]({PUBLIC_URL}/images/{webp}?w=4\&h=2) ![b]({PUBLIC_URL}/images/{gif}?w=1\&h=1) ![again]({PUBLIC_URL}/images/{webp}?w=4\&h=2) [doc](/api/health)"
                ),
                vec![
                    (
                        format!("/site-assets/images/{webp}"),
                        "image/webp".to_owned(),
                        b"webp bytes".to_vec(),
                    ),
                    (
                        format!("/site-assets/images/{gif}"),
                        "image/gif".to_owned(),
                        b"gif bytes".to_vec(),
                    ),
                ],
            ),
        );
    }

    #[tokio::test]
    async fn leaves_articles_without_images_unchanged_when_storage_is_unconfigured() {
        let content = "![remote](https://elsewhere.example/a.webp)".to_owned();

        assert_eq!(
            publish_draft_images(&AppState::default(), content.clone())
                .await
                .unwrap(),
            content,
        );
    }

    #[tokio::test]
    async fn does_not_publish_anything_when_one_linked_image_is_missing() {
        let server = accepting_server().await;
        let state = state_with_storage(&server).await;
        let (webp, gif) = (webp_name(), gif_name());
        store(&state, &webp, b"webp bytes").await;
        let draft = format!("![a](/api/images/{webp}) ![b](/api/images/{gif})");

        let error = publish_draft_images(&state, draft).await.unwrap_err();

        assert_eq!(
            (error_parts(error).await, uploads(&server).await),
            (
                (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    json!({ "error": "Article links to an image that is not stored" }),
                ),
                vec![],
            ),
        );
    }

    #[tokio::test]
    async fn reports_a_rejected_upload() {
        let server = MockServer::start().await;
        Mock::given(method("PUT"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        let state = state_with_storage(&server).await;
        let webp = webp_name();
        store(&state, &webp, b"webp bytes").await;

        let error = publish_draft_images(&state, format!("![a](/api/images/{webp})"))
            .await
            .unwrap_err();

        assert_eq!(
            error_parts(error).await,
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": "Internal server error" }),
            ),
        );
    }

    #[tokio::test]
    async fn restores_draft_links_only_for_images_it_stores() {
        let server = MockServer::start().await;
        let state = state_with_storage(&server).await;
        let (webp, gif) = (webp_name(), gif_name());
        store(&state, &webp, b"webp bytes").await;
        let published =
            format!("![a]({PUBLIC_URL}/images/{webp}?w=4) ![b]({PUBLIC_URL}/images/{gif}?w=1)");

        assert_eq!(
            restore_draft_links(&state, published).await.unwrap(),
            format!("![a](/api/images/{webp}?w=4) ![b]({PUBLIC_URL}/images/{gif}?w=1)"),
        );
    }

    #[tokio::test]
    async fn keeps_public_links_when_storage_is_unconfigured() {
        let published = format!("![a]({PUBLIC_URL}/images/{})", webp_name());

        assert_eq!(
            restore_draft_links(&AppState::default(), published.clone())
                .await
                .unwrap(),
            published,
        );
    }
}

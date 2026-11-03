use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{app::AppState, error::ApiJson, ogp::metadata, safe_fetch::SafeFetchError};

#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct FetchOgpRequest {
    pub url: String,
}

#[derive(Debug, Serialize, ToSchema, PartialEq, Eq)]
pub struct OgpResponse {
    pub available: bool,
    #[schema(required = true)]
    pub final_url: Option<String>,
    #[schema(required = true)]
    pub title: Option<String>,
    #[schema(required = true)]
    pub description: Option<String>,
    #[schema(required = true)]
    pub image: Option<String>,
}

impl OgpResponse {
    fn unavailable() -> Self {
        Self {
            available: false,
            final_url: None,
            title: None,
            description: None,
            image: None,
        }
    }
}

#[utoipa::path(
    post,
    path = "/ogp",
    request_body = FetchOgpRequest,
    responses(
        (status = 200, description = "Open Graph metadata or an unavailable result", body = OgpResponse),
        (status = 400, description = "Invalid request body", body = crate::error::ErrorResponse)
    )
)]
pub async fn fetch_ogp(
    State(state): State<AppState>,
    ApiJson(request): ApiJson<FetchOgpRequest>,
) -> Json<OgpResponse> {
    Json(response_for_fetch(
        state.safe_fetch.fetch(&request.url).await,
    ))
}

fn response_for_fetch(
    result: Result<crate::safe_fetch::FetchResponse, SafeFetchError>,
) -> OgpResponse {
    match result {
        Ok(response) if metadata::is_html_content_type(response.content_type.as_deref()) => {
            let html = metadata::decode_html(&response.body, response.content_type.as_deref());
            metadata::extract(&response.final_url, &html)
        }
        Ok(_) => OgpResponse::unavailable(),
        Err(error) => {
            tracing::warn!(reason = error.code(), "OGP page is unavailable");
            OgpResponse::unavailable()
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{Router, body::Body, http::Request};
    use encoding_rs::Encoding;
    use rstest::rstest;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use crate::{
        app::AppState,
        ogp::{FetchOgpRequest, router},
        safe_fetch::{FetchResponse, SafeFetchError, SafeFetchFuture, SafeFetchService},
    };

    struct TestFetcher(Option<FetchResponse>);

    impl SafeFetchService for TestFetcher {
        fn fetch<'a>(&'a self, _url: &'a str) -> SafeFetchFuture<'a> {
            let response = self.0.clone().ok_or(SafeFetchError::DisallowedAddress);
            Box::pin(async move { response })
        }
    }

    fn test_state(response: Option<FetchResponse>) -> AppState {
        AppState {
            export: None,
            safe_fetch: Arc::new(TestFetcher(response)),
        }
    }

    async fn post_ogp(
        state: AppState,
        url: &str,
    ) -> Result<(u16, Value), Box<dyn std::error::Error>> {
        let api: Router = router().split_for_parts().0.with_state(state);
        let response = api
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/ogp")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&FetchOgpRequest {
                        url: url.to_owned(),
                    })?))?,
            )
            .await?;
        let status = response.status().as_u16();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await?;
        Ok((status, serde_json::from_slice(&bytes)?))
    }

    #[tokio::test]
    async fn returns_an_unavailable_result_for_a_disallowed_address()
    -> Result<(), Box<dyn std::error::Error>> {
        let state = test_state(None);

        let actual = post_ogp(state, "http://127.0.0.1/article").await?;

        assert_eq!(
            actual,
            (
                200,
                json!({
                    "available": false,
                    "final_url": null,
                    "title": null,
                    "description": null,
                    "image": null
                })
            )
        );
        Ok(())
    }

    #[tokio::test]
    async fn returns_extracted_metadata_from_the_api() -> Result<(), Box<dyn std::error::Error>> {
        let state = test_state(Some(FetchResponse {
            final_url: reqwest::Url::parse("http://site.test/article")?,
            body: br#"<meta property="og:title" content="Card title"><meta property="og:image" content="/card.png">"#.to_vec(),
            content_type: Some("text/html".to_owned()),
        }));

        let actual = post_ogp(state, "http://site.test/article").await?;

        assert_eq!(
            actual,
            (
                200,
                json!({
                    "available": true,
                    "final_url": "http://site.test/article",
                    "title": "Card title",
                    "description": null,
                    "image": "http://site.test/card.png"
                })
            )
        );
        Ok(())
    }

    #[rstest]
    #[case::content_type_charset(
        "Shift_JIS",
        Some("text/html; charset=Shift_JIS"),
        "<meta charset=\"EUC-JP\">"
    )]
    #[case::meta_charset("EUC-JP", Some("text/html"), "<meta charset=\"EUC-JP\">")]
    #[test_attr(tokio::test)]
    async fn decodes_legacy_html_charsets(
        #[case] label: &str,
        #[case] content_type: Option<&str>,
        #[case] charset_meta: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let html = format!("{charset_meta}<meta property=\"og:title\" content=\"日本語の記事\">");
        let encoding = Encoding::for_label(label.as_bytes()).ok_or("unknown charset")?;
        let body = encoding.encode(&html).0.into_owned();
        let state = test_state(Some(FetchResponse {
            final_url: reqwest::Url::parse("http://site.test/article")?,
            body,
            content_type: content_type.map(str::to_owned),
        }));

        let actual = post_ogp(state, "http://site.test/article").await?;

        assert_eq!(
            actual,
            (
                200,
                json!({
                    "available": true,
                    "final_url": "http://site.test/article",
                    "title": "日本語の記事",
                    "description": null,
                    "image": null
                })
            )
        );
        Ok(())
    }

    #[rstest]
    #[case::image("image/png")]
    #[case::pdf("application/pdf")]
    #[test_attr(tokio::test)]
    async fn returns_unavailable_for_non_html_content(
        #[case] content_type: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let state = test_state(Some(FetchResponse {
            final_url: reqwest::Url::parse("http://site.test/article")?,
            body: b"not HTML".to_vec(),
            content_type: Some(content_type.to_owned()),
        }));

        let actual = post_ogp(state, "http://site.test/article").await?;

        assert_eq!(
            actual,
            (
                200,
                json!({
                    "available": false,
                    "final_url": null,
                    "title": null,
                    "description": null,
                    "image": null
                })
            )
        );
        Ok(())
    }
}

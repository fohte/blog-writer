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
        Ok(response) => {
            let html = String::from_utf8_lossy(&response.body);
            metadata::extract(&response.final_url, &html)
        }
        Err(error) => {
            tracing::warn!(
                reason = safe_fetch_error_kind(&error),
                "OGP page is unavailable"
            );
            OgpResponse::unavailable()
        }
    }
}

fn safe_fetch_error_kind(error: &SafeFetchError) -> &'static str {
    match error {
        SafeFetchError::InvalidUrl => "invalid_url",
        SafeFetchError::UnsupportedScheme => "unsupported_scheme",
        SafeFetchError::CredentialsNotAllowed => "credentials_not_allowed",
        SafeFetchError::DnsLookup(_) => "dns_lookup",
        SafeFetchError::NoAddresses => "no_addresses",
        SafeFetchError::DisallowedAddress => "disallowed_address",
        SafeFetchError::Request(_) => "request_failed",
        SafeFetchError::TooManyRedirects => "too_many_redirects",
        SafeFetchError::InvalidRedirect => "invalid_redirect",
        SafeFetchError::HttpStatus(_) => "http_status",
        SafeFetchError::TooLarge => "too_large",
        SafeFetchError::Timeout => "timeout",
    }
}

#[cfg(test)]
mod tests {
    use axum::{Router, body::Body, http::Request};
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use crate::{
        app::AppState,
        ogp::{FetchOgpRequest, router},
    };

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
        let state = AppState::default();

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
}

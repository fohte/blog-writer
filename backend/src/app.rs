use axum::{
    Router,
    routing::{MethodRouter, any, get},
};
use utoipa::{OpenApi, openapi::OpenApi as ApiDocument};
use utoipa_axum::router::OpenApiRouter;

use crate::{
    error::{AppError, ErrorResponse},
    frontend, health,
};

#[derive(OpenApi)]
#[openapi(
    info(title = "blog-writer backend API", version = "0.1.0"),
    components(schemas(ErrorResponse))
)]
struct ApiDefinition;

#[derive(Clone, Default)]
pub struct AppState {}

pub fn api() -> OpenApiRouter<AppState> {
    OpenApiRouter::with_openapi(ApiDefinition::openapi()).nest("/api", api_routes())
}

pub fn openapi() -> ApiDocument {
    let (_, openapi) = api().split_for_parts();
    openapi
}

pub fn router(state: AppState) -> Router {
    router_with_frontend_fallback(state, get(frontend::serve))
}

fn router_with_frontend_fallback(state: AppState, frontend_fallback: MethodRouter) -> Router {
    let (api_router, _) = api_routes().split_for_parts();
    let api_router = api_router
        .fallback(api_not_found)
        .method_not_allowed_fallback(api_method_not_allowed);

    Router::new()
        .route("/api", any(api_not_found))
        .route("/api/", any(api_not_found))
        .nest("/api", api_router)
        .fallback_service(frontend_fallback)
        .with_state(state)
}

fn api_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().merge(health::router())
}

async fn api_not_found() -> AppError {
    AppError::NotFound
}

async fn api_method_not_allowed() -> AppError {
    AppError::MethodNotAllowed
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{Body, to_bytes},
        http::{HeaderValue, Request, StatusCode, header::ALLOW, header::CONTENT_TYPE},
        routing::get,
    };
    use rstest::rstest;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::{AppState, router, router_with_frontend_fallback};

    #[rstest]
    #[test_attr(tokio::test)]
    #[case::health("/api/health", "GET", 200, json!({"status": "ok"}))]
    #[case::api_root("/api", "GET", 404, json!({"error": "Not Found"}))]
    #[case::api_root_slash("/api/", "GET", 404, json!({"error": "Not Found"}))]
    #[case::unknown_api("/api/unknown", "GET", 404, json!({"error": "Not Found"}))]
    #[case::method_not_allowed(
        "/api/health",
        "POST",
        405,
        json!({"error": "Method Not Allowed"})
    )]
    async fn responds_to_api_requests(
        #[case] path: &'static str,
        #[case] method: &'static str,
        #[case] status: u16,
        #[case] expected: Value,
    ) {
        let response = router(AppState::default())
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let actual_status = response.status().as_u16();
        let actual_body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();

        assert_eq!((actual_status, actual_body), (status, expected));
    }

    #[rstest]
    #[case::get(
        "GET",
        StatusCode::OK,
        None,
        Some(HeaderValue::from_static("text/plain; charset=utf-8")),
        "frontend shell"
    )]
    #[case::head(
        "HEAD",
        StatusCode::OK,
        None,
        Some(HeaderValue::from_static("text/plain; charset=utf-8")),
        ""
    )]
    #[case::unsupported_method(
        "POST",
        StatusCode::METHOD_NOT_ALLOWED,
        Some(HeaderValue::from_static("GET,HEAD")),
        None,
        ""
    )]
    #[test_attr(tokio::test)]
    async fn routes_frontend_fallback_methods(
        #[case] method: &'static str,
        #[case] expected_status: StatusCode,
        #[case] expected_allow: Option<HeaderValue>,
        #[case] expected_content_type: Option<HeaderValue>,
        #[case] expected_body: &str,
    ) {
        let response =
            router_with_frontend_fallback(AppState::default(), get(|| async { "frontend shell" }))
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri("/")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
        let actual = (
            response.status(),
            response.headers().get(ALLOW).cloned(),
            response.headers().get(CONTENT_TYPE).cloned(),
            to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        );

        assert_eq!(
            actual,
            (
                expected_status,
                expected_allow,
                expected_content_type,
                expected_body.as_bytes().to_vec(),
            )
        );
    }
}

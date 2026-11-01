use axum::{Router, routing::any};
use utoipa::{OpenApi, openapi::OpenApi as ApiDocument};
use utoipa_axum::router::OpenApiRouter;

use crate::{
    error::{AppError, ErrorResponse},
    health,
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
    OpenApiRouter::with_openapi(ApiDefinition::openapi()).nest("/api", health::router())
}

pub fn openapi() -> ApiDocument {
    let (_, openapi) = api().split_for_parts();
    openapi
}

pub fn router(state: AppState) -> Router {
    let (api_router, _) = health::router().split_for_parts();
    let api_router = api_router
        .fallback(api_not_found)
        .method_not_allowed_fallback(api_method_not_allowed);

    Router::new()
        .route("/api", any(api_not_found))
        .route("/api/", any(api_not_found))
        .nest("/api", api_router)
        .with_state(state)
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
        http::Request,
    };
    use rstest::rstest;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::{AppState, router};

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
}

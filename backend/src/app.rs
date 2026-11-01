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
    let (router, _) = api().split_for_parts();

    router
        .route("/api", any(api_not_found))
        .route("/api/{*path}", any(api_not_found))
        .with_state(state)
}

async fn api_not_found() -> AppError {
    AppError::NotFound
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
    #[case::health("/api/health", 200, json!({"status": "ok"}))]
    #[case::unknown_api("/api/unknown", 404, json!({"error": "Not Found"}))]
    async fn responds_to_api_requests(
        #[case] path: &'static str,
        #[case] status: u16,
        #[case] expected: Value,
    ) {
        let response = router(AppState::default())
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let actual_status = response.status().as_u16();
        let actual_body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();

        assert_eq!((actual_status, actual_body), (status, expected));
    }
}

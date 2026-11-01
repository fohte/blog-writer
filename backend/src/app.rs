use axum::{Router, middleware, routing::any};
use utoipa::{OpenApi, openapi::OpenApi as ApiDocument};
use utoipa_axum::router::OpenApiRouter;

use crate::{
    error::{AppError, ErrorResponse},
    health,
    host_origin::{HostOriginPolicy, enforce_host_origin},
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

pub fn router(state: AppState, host_origin_policy: HostOriginPolicy) -> Router {
    let (api_router, _) = api_routes().split_for_parts();
    let api_router = api_router
        .fallback(api_not_found)
        .method_not_allowed_fallback(api_method_not_allowed);

    Router::new()
        .route("/api", any(api_not_found))
        .route("/api/", any(api_not_found))
        .nest("/api", api_router)
        .with_state(state)
        .layer(middleware::from_fn_with_state(
            host_origin_policy,
            enforce_host_origin,
        ))
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
        http::Request,
    };
    use rstest::rstest;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::{AppState, router};
    use crate::host_origin::HostOriginPolicy;

    fn test_router() -> axum::Router {
        router(
            AppState::default(),
            HostOriginPolicy::new(
                vec!["localhost:3000".to_owned()],
                vec!["http://localhost:3000".to_owned()],
            ),
        )
    }

    #[rstest]
    #[test_attr(tokio::test)]
    #[case::health("/api/health", "GET", "localhost:3000", 200, json!({"status": "ok"}))]
    #[case::api_root("/api", "GET", "localhost:3000", 404, json!({"error": "Not Found"}))]
    #[case::api_root_slash("/api/", "GET", "localhost:3000", 404, json!({"error": "Not Found"}))]
    #[case::unknown_api("/api/unknown", "GET", "localhost:3000", 404, json!({"error": "Not Found"}))]
    #[case::untrusted_host_on_router_fallback(
        "/unmatched",
        "GET",
        "untrusted.example",
        403,
        json!({"error": "Forbidden"})
    )]
    #[case::method_not_allowed(
        "/api/health",
        "POST",
        "localhost:3000",
        405,
        json!({"error": "Method Not Allowed"})
    )]
    async fn responds_to_api_requests_with_host_policy(
        #[case] path: &'static str,
        #[case] method: &'static str,
        #[case] host: &'static str,
        #[case] status: u16,
        #[case] expected: Value,
    ) {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("host", host)
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

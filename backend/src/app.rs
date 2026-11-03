use std::sync::Arc;

use axum::{
    Router,
    extract::FromRef,
    http::{HeaderValue, Method, header::CONTENT_TYPE},
    middleware,
    routing::{MethodRouter, any, get},
};
use sqlx::AnyPool;
use tokio::sync::watch;
use tower_http::cors::CorsLayer;
use utoipa::{OpenApi, openapi::OpenApi as ApiDocument};
use utoipa_axum::router::OpenApiRouter;

use crate::{
    config::ExportConfig,
    error::{AppError, ErrorResponse},
    export::{self, ExportError, ExportService},
    frontend, health,
    host_origin::{HostOriginPolicy, enforce_host_origin},
    llm::{self, LlmEvent, LlmState},
    ogp,
    safe_fetch::{SafeFetchService, SafeFetcher},
    source_bodies,
};

#[derive(OpenApi)]
#[openapi(
    info(title = "blog-writer backend API", version = "0.1.0"),
    components(schemas(ErrorResponse, LlmEvent))
)]
struct ApiDefinition;

#[derive(Clone)]
pub struct AppState {
    pub export: Option<ExportService>,
    pub(crate) llm: LlmState,
    pub database: Option<AnyPool>,
    pub(crate) safe_fetch: Arc<dyn SafeFetchService>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            export: None,
            llm: LlmState::default(),
            database: None,
            safe_fetch: Arc::new(SafeFetcher::new()),
        }
    }
}

impl AppState {
    pub fn new(
        export: Option<ExportConfig>,
        llm_config: crate::config::LlmConfig,
        database: Option<AnyPool>,
    ) -> Result<Self, ExportError> {
        let (_, shutdown) = watch::channel(false);
        Self::new_with_shutdown(export, llm_config, database, shutdown)
    }

    pub(crate) fn new_with_shutdown(
        export: Option<ExportConfig>,
        llm_config: crate::config::LlmConfig,
        database: Option<AnyPool>,
        shutdown: watch::Receiver<bool>,
    ) -> Result<Self, ExportError> {
        Ok(Self {
            export: export.map(ExportService::new).transpose()?,
            llm: LlmState::new_with_shutdown(llm_config, shutdown),
            database,
            safe_fetch: Arc::new(SafeFetcher::new()),
        })
    }
}

impl FromRef<AppState> for LlmState {
    fn from_ref(state: &AppState) -> Self {
        state.llm.clone()
    }
}

pub fn api() -> OpenApiRouter<AppState> {
    OpenApiRouter::with_openapi(ApiDefinition::openapi()).nest("/api", api_routes())
}

pub fn openapi() -> ApiDocument {
    let (_, openapi) = api().split_for_parts();
    openapi
}

pub fn router(state: AppState, host_origin_policy: HostOriginPolicy) -> Router {
    router_with_frontend_fallback(state, get(frontend::serve), host_origin_policy)
}

pub fn llm_api_router(
    state: AppState,
    host_origin_policy: HostOriginPolicy,
    allowed_origins: Vec<String>,
) -> Router {
    let (llm_router, _) = llm::router().split_for_parts();
    let cors = CorsLayer::new()
        .allow_origin(
            allowed_origins
                .into_iter()
                .filter_map(|origin| HeaderValue::from_str(&origin.to_ascii_lowercase()).ok())
                .collect::<Vec<_>>(),
        )
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([CONTENT_TYPE])
        .allow_private_network(true);

    Router::new()
        .route("/api", any(api_not_found))
        .route("/api/", any(api_not_found))
        .nest(
            "/api",
            llm_router
                .fallback(api_not_found)
                .method_not_allowed_fallback(api_method_not_allowed),
        )
        .fallback(api_not_found)
        .layer(cors)
        .with_state(state)
        .layer(middleware::from_fn_with_state(
            host_origin_policy,
            enforce_host_origin,
        ))
}

fn router_with_frontend_fallback(
    state: AppState,
    frontend_fallback: MethodRouter,
    host_origin_policy: HostOriginPolicy,
) -> Router {
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
        .layer(middleware::from_fn_with_state(
            host_origin_policy,
            enforce_host_origin,
        ))
}

fn api_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .merge(health::router())
        .merge(export::router())
        .merge(llm::router())
        .merge(ogp::router())
        .merge(source_bodies::router())
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
        http::{
            HeaderValue, Request, StatusCode,
            header::{
                ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
                ACCESS_CONTROL_ALLOW_ORIGIN, ALLOW, CONTENT_TYPE,
            },
        },
        routing::get,
    };
    use rstest::{fixture, rstest};
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::{AppState, llm_api_router, router, router_with_frontend_fallback};
    use crate::host_origin::HostOriginPolicy;
    use crate::{
        config::{ExportConfig, ExportDestination, ExportFormat, LlmConfig, ProviderName},
        llm::LlmState,
    };

    #[fixture]
    fn policy() -> HostOriginPolicy {
        HostOriginPolicy::new(
            vec!["localhost:3000".to_owned()],
            vec![
                "http://localhost:3000".to_owned(),
                "https://writer.example".to_owned(),
            ],
        )
    }

    fn test_router(policy: HostOriginPolicy) -> axum::Router {
        router(AppState::default(), policy)
    }

    fn test_llm_api_router(policy: HostOriginPolicy) -> axum::Router {
        llm_api_router(
            AppState::default(),
            policy,
            vec!["HTTPS://WRITER.EXAMPLE".to_owned()],
        )
    }

    #[tokio::test]
    async fn serves_llm_status_without_database() {
        let response = test_llm_api_router(policy())
            .oneshot(
                Request::builder()
                    .uri("/api/llm/status")
                    .header("host", "localhost:3000")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let actual = (
            response.status(),
            serde_json::from_slice::<Value>(
                &to_bytes(response.into_body(), usize::MAX).await.unwrap(),
            )
            .unwrap(),
        );

        assert_eq!(
            actual,
            (
                StatusCode::OK,
                json!({"provider": "claude_code", "locked": false})
            )
        );
    }

    #[rstest]
    #[case::health("/api/health")]
    #[case::export("/api/export/destinations")]
    #[case::frontend_root("/")]
    #[case::frontend_file("/index.html")]
    #[test_attr(tokio::test)]
    async fn does_not_serve_non_llm_routes(#[case] uri: &'static str) {
        let response = test_llm_api_router(policy())
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .header("host", "localhost:3000")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let actual = (
            response.status(),
            serde_json::from_slice::<Value>(
                &to_bytes(response.into_body(), usize::MAX).await.unwrap(),
            )
            .unwrap(),
        );

        assert_eq!(
            actual,
            (StatusCode::NOT_FOUND, json!({"error": "Not Found"}))
        );
    }

    #[tokio::test]
    async fn allows_cors_preflight_from_an_allowed_origin() {
        let response = test_llm_api_router(policy())
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/api/llm/future")
                    .header("host", "localhost:3000")
                    .header("origin", "https://writer.example")
                    .header("access-control-request-method", "POST")
                    .header("access-control-request-headers", "content-type")
                    .header("access-control-request-private-network", "true")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let actual = (
            response.status(),
            response.headers().get(ACCESS_CONTROL_ALLOW_ORIGIN).cloned(),
            response
                .headers()
                .get(ACCESS_CONTROL_ALLOW_METHODS)
                .cloned(),
            response
                .headers()
                .get(ACCESS_CONTROL_ALLOW_HEADERS)
                .cloned(),
            response
                .headers()
                .get("access-control-allow-private-network")
                .cloned(),
        );

        assert_eq!(
            actual,
            (
                StatusCode::OK,
                Some(HeaderValue::from_static("https://writer.example")),
                Some(HeaderValue::from_static("GET,POST")),
                Some(HeaderValue::from_static("content-type")),
                Some(HeaderValue::from_static("true")),
            )
        );
    }

    #[rstest]
    #[case::untrusted_origin("localhost:3000", "https://untrusted.example")]
    #[case::untrusted_host("untrusted.example", "https://writer.example")]
    #[test_attr(tokio::test)]
    async fn rejects_cors_preflight_with_untrusted_host_or_origin(
        #[case] host: &'static str,
        #[case] origin: &'static str,
    ) {
        let response = test_llm_api_router(policy())
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/api/llm/future")
                    .header("host", host)
                    .header("origin", origin)
                    .header("access-control-request-method", "POST")
                    .header("access-control-request-headers", "content-type")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let actual = (
            response.status(),
            response.headers().get(ACCESS_CONTROL_ALLOW_ORIGIN).cloned(),
        );

        assert_eq!(actual, (StatusCode::FORBIDDEN, None));
    }

    #[rstest]
    #[test_attr(tokio::test)]
    #[case::health("/api/health", "GET", "localhost:3000", 200, json!({"status": "ok"}))]
    #[case::api_root("/api", "GET", "localhost:3000", 404, json!({"error": "Not Found"}))]
    #[case::api_root_slash("/api/", "GET", "localhost:3000", 404, json!({"error": "Not Found"}))]
    #[case::unknown_api("/api/unknown", "GET", "localhost:3000", 404, json!({"error": "Not Found"}))]
    #[case::export_disabled(
        "/api/export/destinations",
        "GET",
        "localhost:3000",
        503,
        json!({"error": "Export publishing is not configured"})
    )]
    #[case::llm_status(
        "/api/llm/status",
        "GET",
        "localhost:3000",
        200,
        json!({"provider": "claude_code", "locked": false})
    )]
    #[case::untrusted_host_on_api(
        "/api/health",
        "GET",
        "untrusted.example",
        403,
        json!({"error": "Forbidden"})
    )]
    #[case::untrusted_host_on_frontend(
        "/index.html",
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
    async fn applies_host_policy_to_router_requests(
        policy: HostOriginPolicy,
        #[case] path: &'static str,
        #[case] method: &'static str,
        #[case] host: &'static str,
        #[case] status: u16,
        #[case] expected: Value,
    ) {
        let response = test_router(policy)
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

    #[tokio::test]
    async fn reports_when_the_provider_is_locked() {
        let state = AppState {
            export: None,
            llm: LlmState::new(LlmConfig {
                provider: ProviderName::ClaudeCode,
                locked: true,
                anthropic_api_key_set: false,
            }),
            database: None,
            ..AppState::default()
        };
        let response = router(state, policy())
            .oneshot(
                Request::builder()
                    .uri("/api/llm/status")
                    .header("host", "localhost:3000")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let actual: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();

        assert_eq!(actual, json!({"provider": "claude_code", "locked": true}));
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
        policy: HostOriginPolicy,
        #[case] method: &'static str,
        #[case] expected_status: StatusCode,
        #[case] expected_allow: Option<HeaderValue>,
        #[case] expected_content_type: Option<HeaderValue>,
        #[case] expected_body: &str,
    ) {
        let response = router_with_frontend_fallback(
            AppState::default(),
            get(|| async { "frontend shell" }),
            policy,
        )
        .oneshot(
            Request::builder()
                .method(method)
                .uri("/")
                .header("host", "localhost:3000")
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

    #[tokio::test]
    async fn lists_configured_export_destinations() {
        let response = router(
            AppState::new(
                Some(ExportConfig {
                    destinations: vec![ExportDestination {
                        id: "site-one".to_owned(),
                        repository: "writer/notes".to_owned(),
                        base_branch: "main".to_owned(),
                        path_template: "posts/{slug}.mdx".to_owned(),
                        format: ExportFormat::Mdx,
                        frontmatter_template: "title: {{ title }}".to_owned(),
                        ogp_json_path: None,
                    }],
                    octo_sts_url: "https://sts.example".to_owned(),
                    octo_sts_identity: "writer-export".to_owned(),
                    octo_sts_sa_token_path: "/var/run/token".into(),
                }),
                LlmConfig::default(),
                None,
            )
            .unwrap(),
            policy(),
        )
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/export/destinations")
                .header("host", "localhost:3000")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
        let actual_status = response.status().as_u16();
        let actual_body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();

        assert_eq!(
            (actual_status, actual_body),
            (
                200,
                json!({
                    "destinations": [{
                        "id": "site-one",
                        "format": "mdx",
                        "frontmatter_template": "title: {{ title }}"
                    }]
                })
            )
        );
    }
}

use axum::{
    extract::{Request, State},
    http::{HeaderMap, Method, StatusCode, header::HOST},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::error::AppError;

enum SingleHeaderValue<'a> {
    Missing,
    Present(&'a str),
    Invalid,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostOriginPolicy {
    allowed_hosts: Vec<String>,
    allowed_origins: Vec<String>,
}

impl HostOriginPolicy {
    pub fn new(allowed_hosts: Vec<String>, allowed_origins: Vec<String>) -> Self {
        Self {
            allowed_hosts: normalize(allowed_hosts),
            allowed_origins: normalize(allowed_origins),
        }
    }

    fn allows(&self, request: &Request) -> bool {
        let Some(host) = request_host(request.headers(), request.uri()) else {
            return false;
        };
        if !self.allowed_hosts.iter().any(|allowed| allowed == &host) {
            return false;
        }

        origin_allowed(request, &self.allowed_origins)
    }

    pub(crate) fn allowed_origins(&self) -> &[String] {
        &self.allowed_origins
    }
}

fn request_host(headers: &HeaderMap, uri: &axum::http::Uri) -> Option<String> {
    let host_header = match single_header_value(headers, HOST.as_str()) {
        SingleHeaderValue::Missing => None,
        SingleHeaderValue::Present(host) => Some(host),
        SingleHeaderValue::Invalid => return None,
    };
    let uri_authority = uri.authority().map(|authority| authority.as_str());
    let host = match (host_header, uri_authority) {
        (Some(header), Some(authority)) if !header.eq_ignore_ascii_case(authority) => {
            return None;
        }
        (Some(header), _) => header,
        (None, Some(authority)) => authority,
        (None, None) => return None,
    };

    Some(host.to_ascii_lowercase())
}

fn origin_allowed(request: &Request, allowed_origins: &[String]) -> bool {
    let headers = request.headers();
    let origin = match single_header_value(headers, axum::http::header::ORIGIN.as_str()) {
        SingleHeaderValue::Present(origin) => origin,
        SingleHeaderValue::Missing => {
            return is_page_navigation(request) || fetch_site_allows_originless_request(headers);
        }
        SingleHeaderValue::Invalid => return false,
    };

    allowed_origins
        .iter()
        .any(|allowed| allowed == &origin.to_ascii_lowercase())
}

// Login redirects and links from other sites open the app with a cross-site Sec-Fetch-Site.
fn is_page_navigation(request: &Request) -> bool {
    let path = request.uri().path();
    let headers = request.headers();

    matches!(*request.method(), Method::GET | Method::HEAD)
        && path != "/api"
        && !path.starts_with("/api/")
        && matches!(
            single_header_value(headers, "sec-fetch-mode"),
            SingleHeaderValue::Present("navigate")
        )
        && matches!(
            single_header_value(headers, "sec-fetch-dest"),
            SingleHeaderValue::Present("document")
        )
}

fn fetch_site_allows_originless_request(headers: &HeaderMap) -> bool {
    match single_header_value(headers, "sec-fetch-site") {
        SingleHeaderValue::Missing => true,
        SingleHeaderValue::Present(fetch_site) => matches!(fetch_site, "same-origin" | "none"),
        SingleHeaderValue::Invalid => false,
    }
}

fn single_header_value<'a>(headers: &'a HeaderMap, name: &str) -> SingleHeaderValue<'a> {
    let mut values = headers.get_all(name).iter();
    let Some(value) = values.next() else {
        return SingleHeaderValue::Missing;
    };
    if values.next().is_some() {
        return SingleHeaderValue::Invalid;
    }

    match value.to_str() {
        Ok(value) => SingleHeaderValue::Present(value),
        Err(_) => SingleHeaderValue::Invalid,
    }
}

fn normalize(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .map(|value| value.to_ascii_lowercase())
        .collect()
}

pub async fn enforce_host_origin(
    State(policy): State<HostOriginPolicy>,
    request: Request,
    next: Next,
) -> Response {
    if policy.allows(&request) {
        next.run(request).await
    } else {
        tracing::warn!(
            host = ?request.headers().get(HOST),
            origin = ?request.headers().get(axum::http::header::ORIGIN),
            "rejected request with untrusted host or origin"
        );
        AppError::Client {
            status: StatusCode::FORBIDDEN,
            message: "Forbidden".to_owned(),
        }
        .into_response()
    }
}

#[cfg(test)]
mod tests {
    use axum::{Router, body::Body, http::Request, middleware, routing::get};
    use rstest::{fixture, rstest};
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::{HostOriginPolicy, enforce_host_origin};

    async fn health() -> axum::Json<Value> {
        axum::Json(json!({"status": "ok"}))
    }

    #[fixture]
    fn test_router() -> Router {
        let policy = HostOriginPolicy::new(
            vec!["localhost:3000".to_owned()],
            vec!["http://localhost:3000".to_owned()],
        );
        Router::new()
            .route("/api/health", get(health))
            .route("/api/sync/{doc_id}", get(health))
            .fallback(get(health))
            .layer(middleware::from_fn_with_state(policy, enforce_host_origin))
    }

    async fn response(router: Router, request: Request<Body>) -> (u16, Value) {
        let response = router.oneshot(request).await.unwrap();
        let status = response.status().as_u16();
        let body: Value = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();

        (status, body)
    }

    #[rstest]
    #[test_attr(tokio::test)]
    #[case::same_origin_request(&[("sec-fetch-site", "same-origin")], 200, json!({"status": "ok"}))]
    #[case::user_initiated_request(&[("sec-fetch-site", "none")], 200, json!({"status": "ok"}))]
    #[case::same_site_request(&[("sec-fetch-site", "same-site")], 403, json!({"error": "Forbidden"}))]
    #[case::cross_site_request(&[("sec-fetch-site", "cross-site")], 403, json!({"error": "Forbidden"}))]
    #[case::unknown_fetch_site(&[("sec-fetch-site", "unknown")], 403, json!({"error": "Forbidden"}))]
    #[case::configured_origin_allows_cross_site_metadata(&[("origin", "http://localhost:3000"), ("sec-fetch-site", "cross-site")], 200, json!({"status": "ok"}))]
    #[case::duplicate_fetch_site_is_rejected(&[("sec-fetch-site", "same-origin"), ("sec-fetch-site", "cross-site")], 403, json!({"error": "Forbidden"}))]
    async fn checks_fetch_site_and_origin_headers(
        test_router: Router,
        #[case] headers: &'static [(&'static str, &'static str)],
        #[case] status: u16,
        #[case] expected: Value,
    ) {
        let mut request = Request::builder()
            .uri("/api/health")
            .header("host", "localhost:3000");
        for (name, value) in headers {
            request = request.header(*name, *value);
        }

        assert_eq!(
            response(test_router, request.body(Body::empty()).unwrap()).await,
            (status, expected)
        );
    }

    const OK: &str = r#"{"status":"ok"}"#;
    const FORBIDDEN: &str = r#"{"error":"Forbidden"}"#;
    const CROSS_SITE_NAVIGATION: &[(&str, &str)] = &[
        ("host", "localhost:3000"),
        ("sec-fetch-site", "cross-site"),
        ("sec-fetch-mode", "navigate"),
        ("sec-fetch-dest", "document"),
    ];
    const WEBSOCKET_WITH_NAVIGATION_METADATA: &[(&str, &str)] = &[
        ("host", "localhost:3000"),
        ("sec-fetch-site", "cross-site"),
        ("sec-fetch-mode", "navigate"),
        ("sec-fetch-dest", "document"),
        ("connection", "upgrade"),
        ("upgrade", "websocket"),
        ("sec-websocket-version", "13"),
    ];
    const WEBSOCKET_HANDSHAKE: &[(&str, &str)] = &[
        ("host", "localhost:3000"),
        ("sec-fetch-site", "cross-site"),
        ("sec-fetch-mode", "websocket"),
        ("sec-fetch-dest", "empty"),
        ("connection", "upgrade"),
        ("upgrade", "websocket"),
        ("sec-websocket-version", "13"),
    ];

    #[rstest]
    #[test_attr(tokio::test)]
    #[case::cross_site_page("GET", "/", CROSS_SITE_NAVIGATION, 200, OK)]
    #[case::cross_site_deep_link("GET", "/articles/one", CROSS_SITE_NAVIGATION, 200, OK)]
    #[case::path_sharing_the_api_prefix("GET", "/apiary", CROSS_SITE_NAVIGATION, 200, OK)]
    #[case::head("HEAD", "/", CROSS_SITE_NAVIGATION, 200, "")]
    #[case::same_site_page("GET", "/", &[("host", "localhost:3000"), ("sec-fetch-site", "same-site"), ("sec-fetch-mode", "navigate"), ("sec-fetch-dest", "document")], 200, OK)]
    #[case::api_root("GET", "/api", CROSS_SITE_NAVIGATION, 403, FORBIDDEN)]
    #[case::api_route("GET", "/api/health", CROSS_SITE_NAVIGATION, 403, FORBIDDEN)]
    #[case::websocket_route_with_navigation_metadata(
        "GET",
        "/api/sync/document",
        WEBSOCKET_WITH_NAVIGATION_METADATA,
        403,
        FORBIDDEN
    )]
    #[case::browser_websocket_handshake("GET", "/", WEBSOCKET_HANDSHAKE, 403, FORBIDDEN)]
    #[case::post("POST", "/", CROSS_SITE_NAVIGATION, 403, FORBIDDEN)]
    #[case::iframe("GET", "/", &[("host", "localhost:3000"), ("sec-fetch-site", "cross-site"), ("sec-fetch-mode", "navigate"), ("sec-fetch-dest", "iframe")], 403, FORBIDDEN)]
    #[case::subresource("GET", "/", &[("host", "localhost:3000"), ("sec-fetch-site", "cross-site"), ("sec-fetch-mode", "no-cors"), ("sec-fetch-dest", "document")], 403, FORBIDDEN)]
    #[case::untrusted_origin("GET", "/", &[("host", "localhost:3000"), ("origin", "https://attacker.example"), ("sec-fetch-site", "cross-site"), ("sec-fetch-mode", "navigate"), ("sec-fetch-dest", "document")], 403, FORBIDDEN)]
    #[case::untrusted_host("GET", "/", &[("host", "attacker.example"), ("sec-fetch-site", "cross-site"), ("sec-fetch-mode", "navigate"), ("sec-fetch-dest", "document")], 403, FORBIDDEN)]
    async fn allows_only_page_navigations_from_other_sites(
        test_router: Router,
        #[case] method: &'static str,
        #[case] path: &'static str,
        #[case] headers: &'static [(&'static str, &'static str)],
        #[case] status: u16,
        #[case] body: &'static str,
    ) {
        let mut request = Request::builder().method(method).uri(path);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }

        let response = test_router
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let actual_status = response.status().as_u16();
        let actual_body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();

        assert_eq!(
            (actual_status, std::str::from_utf8(&actual_body).unwrap()),
            (status, body)
        );
    }

    #[rstest]
    #[test_attr(tokio::test)]
    #[case::allowed_host_and_origin(
        "/api/health",
        &["localhost:3000"],
        &["http://localhost:3000"],
        false,
        200,
        json!({"status": "ok"})
    )]
    #[case::case_insensitive_host_and_origin(
        "/api/health",
        &["LOCALHOST:3000"],
        &["HTTP://LOCALHOST:3000"],
        false,
        200,
        json!({"status": "ok"})
    )]
    #[case::authority_without_host_header(
        "http://localhost:3000/api/health",
        &[],
        &["http://localhost:3000"],
        false,
        200,
        json!({"status": "ok"})
    )]
    #[case::missing_origin(
        "/api/health",
        &["localhost:3000"],
        &[],
        false,
        200,
        json!({"status": "ok"})
    )]
    #[case::host_not_allowed(
        "/api/health",
        &["attacker.example"],
        &["http://localhost:3000"],
        false,
        403,
        json!({"error": "Forbidden"})
    )]
    #[case::origin_not_allowed(
        "/api/health",
        &["localhost:3000"],
        &["https://attacker.example"],
        false,
        403,
        json!({"error": "Forbidden"})
    )]
    #[case::duplicate_host_headers(
        "/api/health",
        &["localhost:3000", "attacker.example"],
        &["http://localhost:3000"],
        false,
        403,
        json!({"error": "Forbidden"})
    )]
    #[case::uri_authority_mismatch(
        "http://attacker.example/api/health",
        &["localhost:3000"],
        &["http://localhost:3000"],
        false,
        403,
        json!({"error": "Forbidden"})
    )]
    #[case::duplicate_origin_headers(
        "/api/health",
        &["localhost:3000"],
        &["http://localhost:3000", "https://attacker.example"],
        false,
        403,
        json!({"error": "Forbidden"})
    )]
    #[case::websocket_origin_not_allowed(
        "/api/sync/document",
        &["localhost:3000"],
        &["https://attacker.example"],
        true,
        403,
        json!({"error": "Forbidden"})
    )]
    #[case::missing_host(
        "/api/health",
        &[],
        &["http://localhost:3000"],
        false,
        403,
        json!({"error": "Forbidden"})
    )]
    async fn checks_host_and_origin(
        test_router: Router,
        #[case] uri: &'static str,
        #[case] hosts: &'static [&'static str],
        #[case] origins: &'static [&'static str],
        #[case] websocket: bool,
        #[case] status: u16,
        #[case] expected: Value,
    ) {
        let mut request = Request::builder().uri(uri);
        for host in hosts {
            request = request.header("host", *host);
        }
        for origin in origins {
            request = request.header("origin", *origin);
        }
        if websocket {
            request = request
                .header("connection", "upgrade")
                .header("upgrade", "websocket")
                .header("sec-websocket-version", "13");
        }

        assert_eq!(
            response(test_router, request.body(Body::empty()).unwrap()).await,
            (status, expected)
        );
    }
}

use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode, header::HOST},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::error::AppError;

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

    fn allows(&self, headers: &HeaderMap, uri: &axum::http::Uri) -> bool {
        let mut host_values = headers.get_all(HOST).iter();
        let host_header = host_values.next();
        if host_values.next().is_some() {
            return false;
        }
        let host_header = match host_header.map(|value| value.to_str()) {
            Some(Ok(host)) => Some(host),
            Some(Err(_)) => return false,
            None => None,
        };
        let uri_authority = uri.authority().map(|authority| authority.as_str());
        let host = match (host_header, uri_authority) {
            (Some(header), Some(authority)) if !header.eq_ignore_ascii_case(authority) => {
                return false;
            }
            (Some(header), _) => header,
            (None, Some(authority)) => authority,
            (None, None) => return false,
        };
        if !self
            .allowed_hosts
            .iter()
            .any(|allowed| allowed == &host.to_ascii_lowercase())
        {
            return false;
        }

        let mut origin_values = headers.get_all(axum::http::header::ORIGIN).iter();
        let Some(origin_header) = origin_values.next() else {
            return true;
        };
        if origin_values.next().is_some() {
            return false;
        }
        let Ok(origin) = origin_header.to_str() else {
            return false;
        };

        self.allowed_origins
            .iter()
            .any(|allowed| allowed == &origin.to_ascii_lowercase())
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
    if policy.allows(request.headers(), request.uri()) {
        next.run(request).await
    } else {
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
    use rstest::rstest;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::{HostOriginPolicy, enforce_host_origin};

    async fn health() -> axum::Json<Value> {
        axum::Json(json!({"status": "ok"}))
    }

    fn test_router() -> Router {
        let policy = HostOriginPolicy::new(
            vec!["localhost:3000".to_owned()],
            vec!["http://localhost:3000".to_owned()],
        );
        Router::new()
            .route("/api/health", get(health))
            .layer(middleware::from_fn_with_state(policy, enforce_host_origin))
    }

    #[rstest]
    #[test_attr(tokio::test)]
    #[case::allowed_host_and_origin(
        Some("localhost:3000"),
        Some("http://localhost:3000"),
        false,
        200,
        json!({"status": "ok"})
    )]
    #[case::case_insensitive_host_and_origin(
        Some("LOCALHOST:3000"),
        Some("HTTP://LOCALHOST:3000"),
        false,
        200,
        json!({"status": "ok"})
    )]
    #[case::missing_origin(
        Some("localhost:3000"),
        None,
        false,
        200,
        json!({"status": "ok"})
    )]
    #[case::host_not_allowed(
        Some("attacker.example"),
        Some("http://localhost:3000"),
        false,
        403,
        json!({"error": "Forbidden"})
    )]
    #[case::origin_not_allowed(
        Some("localhost:3000"),
        Some("https://attacker.example"),
        false,
        403,
        json!({"error": "Forbidden"})
    )]
    #[case::websocket_origin_not_allowed(
        Some("localhost:3000"),
        Some("https://attacker.example"),
        true,
        403,
        json!({"error": "Forbidden"})
    )]
    #[case::missing_host(
        None,
        Some("http://localhost:3000"),
        false,
        403,
        json!({"error": "Forbidden"})
    )]
    async fn checks_host_and_origin(
        #[case] host: Option<&'static str>,
        #[case] origin: Option<&'static str>,
        #[case] websocket: bool,
        #[case] status: u16,
        #[case] expected: Value,
    ) {
        let mut request = Request::builder().uri("/api/health");
        if let Some(host) = host {
            request = request.header("host", host);
        }
        if let Some(origin) = origin {
            request = request.header("origin", origin);
        }
        if websocket {
            request = request
                .header("connection", "upgrade")
                .header("upgrade", "websocket")
                .header("sec-websocket-version", "13");
        }

        let response = test_router()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let actual_status = response.status().as_u16();
        let actual_body: Value = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();

        assert_eq!((actual_status, actual_body), (status, expected));
    }
}

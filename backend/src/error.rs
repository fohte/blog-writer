use axum::{
    Json,
    extract::{FromRequest, Request, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Serialize, de::DeserializeOwned};
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Not Found")]
    NotFound,
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Internal(String),
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorResponse {
    pub error: String,
}

pub struct ApiJson<T>(pub T);

impl<T, S> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
    Json<T>: FromRequest<S, Rejection = JsonRejection>,
{
    type Rejection = AppError;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        Json::from_request(request, state)
            .await
            .map(|Json(value)| Self(value))
            .map_err(AppError::from)
    }
}

impl From<JsonRejection> for AppError {
    fn from(rejection: JsonRejection) -> Self {
        if rejection.status().is_server_error() {
            Self::Internal(rejection.body_text())
        } else {
            Self::BadRequest("Invalid request body".to_owned())
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::NotFound => (StatusCode::NOT_FOUND, "Not Found".to_owned()),
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            Self::Internal(message) => {
                tracing::error!(error = %message, "request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".to_owned(),
                )
            }
        };

        (status, Json(ErrorResponse { error: message })).into_response()
    }
}

#[cfg(test)]
mod tests {
    use axum::{Json, Router, routing::post};
    use rstest::rstest;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::{ApiJson, AppError};

    async fn echo(ApiJson(value): ApiJson<Value>) -> Json<Value> {
        Json(value)
    }

    async fn fail() -> AppError {
        AppError::Internal("private failure detail".to_owned())
    }

    fn test_router() -> Router {
        Router::new()
            .route("/echo", post(echo))
            .route("/fail", post(fail))
    }

    #[rstest]
    #[test_attr(tokio::test)]
    #[case::malformed_json(br#"{"#, "/echo", 400, json!({"error": "Invalid request body"}))]
    #[case::server_error(
        br#"{}"#,
        "/fail",
        500,
        json!({"error": "Internal server error"})
    )]
    async fn returns_json_error_shape(
        #[case] body: &'static [u8],
        #[case] path: &'static str,
        #[case] status: u16,
        #[case] expected: Value,
    ) {
        let response = test_router()
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from(body))
                    .unwrap(),
            )
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

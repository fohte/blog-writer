use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    status: String,
}

#[utoipa::path(
    get,
    path = "/health",
    responses((status = 200, description = "Backend is ready", body = HealthResponse))
)]
pub(super) async fn get_health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_owned(),
    })
}

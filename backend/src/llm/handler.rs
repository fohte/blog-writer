use axum::{Json, extract::State};
use serde::Serialize;
use utoipa::ToSchema;

use super::LlmState;
use crate::config::ProviderName;

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct LlmStatusResponse {
    pub provider: ProviderName,
    pub locked: bool,
}

#[utoipa::path(
    get,
    path = "/llm/status",
    responses((status = 200, description = "Configured LLM provider", body = LlmStatusResponse))
)]
pub async fn status(State(state): State<LlmState>) -> Json<LlmStatusResponse> {
    Json(LlmStatusResponse {
        provider: state.provider_name(),
        locked: state.is_locked(),
    })
}

use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    llm::handler::{__path_status, status},
    research_key_points,
};

pub fn router() -> OpenApiRouter<AppState> {
    // Register LLM use-case routes here so API-only startup exposes them with the status route.
    OpenApiRouter::new()
        .routes(routes!(status))
        .merge(research_key_points::router())
        .merge(crate::write_from_key_points::router())
}

use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    llm::handler::{__path_status, status},
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(status))
        .merge(crate::write_from_key_points::router())
}

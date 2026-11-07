use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{app::AppState, source_bodies::handler};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .merge(super::file_handler::router())
        .routes(routes!(handler::fetch_from_url))
        .routes(routes!(handler::save_body))
        .routes(routes!(handler::save_body_if_unchanged))
        .routes(routes!(handler::restore_body))
        .routes(routes!(handler::get_body))
        .routes(routes!(handler::delete_body))
}

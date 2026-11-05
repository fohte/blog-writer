use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{app::AppState, local_file_sync::handler};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(handler::get_configuration))
        .routes(routes!(handler::get_article_file))
        .routes(routes!(handler::set_article_file))
        .routes(routes!(handler::resume_article_file_sync))
        .routes(routes!(handler::overwrite_article_file))
}

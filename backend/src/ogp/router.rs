use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    ogp::handler::{__path_fetch_ogp, fetch_ogp},
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(fetch_ogp))
}

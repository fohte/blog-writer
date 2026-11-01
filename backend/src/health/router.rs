use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    health::handler::{__path_get_health, get_health},
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(get_health))
}

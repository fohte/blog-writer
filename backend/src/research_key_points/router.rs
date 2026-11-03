use utoipa_axum::{router::OpenApiRouter, routes};

use crate::app::AppState;

use super::handler::{__path_extract_key_points, extract_key_points};

pub(crate) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(extract_key_points))
}

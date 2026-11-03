use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    write_from_key_points::handler::{__path_write_from_key_points, write_from_key_points},
};

pub(crate) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(write_from_key_points))
}

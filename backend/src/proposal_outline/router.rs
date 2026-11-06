use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    proposal_outline::handler::{__path_propose_outline, propose_outline},
};

pub(crate) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(propose_outline))
}

use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    proposal_transition::handler::{__path_propose_transition, propose_transition},
};

pub(crate) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(propose_transition))
}

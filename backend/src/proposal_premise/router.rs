use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    proposal_premise::handler::{__path_propose_premise, propose_premise},
};

pub(crate) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(propose_premise))
}

use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    proposal_body_request::handler::{__path_propose_body_request, propose_body_request},
};

pub(crate) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(propose_body_request))
}

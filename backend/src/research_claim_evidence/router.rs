use utoipa_axum::{router::OpenApiRouter, routes};

use crate::app::AppState;

use super::handler::{__path_judge_claim_evidence, judge_claim_evidence};

pub(crate) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(judge_claim_evidence))
}

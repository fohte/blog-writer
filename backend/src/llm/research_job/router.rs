use utoipa_axum::{router::OpenApiRouter, routes};

use crate::app::AppState;

use super::handler::{__path_run_research_job, run_research_job};

pub(crate) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(run_research_job))
}

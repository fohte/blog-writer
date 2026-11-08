use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    llm::LlmErrorPayload, research_claim_evidence::model::JudgeClaimEvidenceResult,
    research_key_points::model::ResearchKeyPointsResult,
};

#[derive(Debug, Deserialize, ToSchema)]
#[serde(tag = "task", rename_all = "snake_case")]
pub(crate) enum ResearchJobRequest {
    KeyPoints {
        question: String,
    },
    ClaimEvidence {
        claim: String,
        before: Option<String>,
        after: Option<String>,
    },
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "task", content = "data", rename_all = "snake_case")]
pub(crate) enum ResearchJobAnalysis {
    KeyPoints(ResearchKeyPointsResult),
    ClaimEvidence(JudgeClaimEvidenceResult),
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct ResearchJobResult {
    pub analysis: ResearchJobAnalysis,
    pub sources: Vec<ResearchJobSource>,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct ResearchJobSource {
    pub id: String,
    pub url: String,
    pub final_url: Option<String>,
    pub title: Option<String>,
    /// Calendar date (`YYYY-MM-DD`) the page says it was published, if any.
    pub published_at: Option<String>,
    pub body: Option<String>,
    pub status: ResearchJobSourceStatus,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ResearchJobSourceStatus {
    Available,
    Unavailable,
    LoginRequired,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum ResearchJobProgress {
    Search { query: String },
    Fetching { url: String },
    Fetched { url: String },
    Unavailable { url: String },
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub(crate) enum ResearchJobEvent {
    Progress(ResearchJobProgress),
    Result(ResearchJobResult),
    Error(LlmErrorPayload),
}

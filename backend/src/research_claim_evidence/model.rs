use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, JsonSchema, ToSchema)]
pub(crate) struct JudgeClaimEvidenceRequest {
    pub claim: String,
    pub before: Option<String>,
    pub after: Option<String>,
    pub sources: Vec<ClaimEvidenceSourceInput>,
}

#[derive(Debug, Deserialize, JsonSchema, ToSchema)]
pub(crate) struct ClaimEvidenceSourceInput {
    pub id: String,
    pub body: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct ModelResponse {
    pub verdict: ClaimVerdict,
    pub quote: Option<ModelQuote>,
    pub suggestion: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct ModelQuote {
    pub source_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ClaimVerdict {
    Supported,
    Insufficient,
    Outdated,
    Contradicted,
}

#[derive(Debug, Serialize, ToSchema, PartialEq, Eq)]
pub(crate) struct JudgeClaimEvidenceResult {
    pub verdict: ClaimVerdict,
    pub quote: Option<ClaimEvidenceQuote>,
    pub suggestion: Option<String>,
}

#[derive(Debug, Serialize, ToSchema, PartialEq, Eq)]
pub(crate) struct ClaimEvidenceQuote {
    pub source_id: String,
    pub text: String,
}

#[derive(Debug, ToSchema)]
#[expect(dead_code, reason = "used as the OpenAPI response schema")]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub(crate) enum JudgeClaimEvidenceEvent {
    Result(JudgeClaimEvidenceResult),
    Error(crate::llm::LlmErrorPayload),
}

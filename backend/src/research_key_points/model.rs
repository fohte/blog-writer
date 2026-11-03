use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, JsonSchema, ToSchema)]
pub(crate) struct ResearchKeyPointsRequest {
    pub question: Option<String>,
    pub sources: Vec<ResearchSourceInput>,
}

#[derive(Debug, Deserialize, JsonSchema, ToSchema)]
pub(crate) struct ResearchSourceInput {
    pub id: String,
    pub body: String,
}

#[derive(Debug, Deserialize, JsonSchema, PartialEq, Eq, Serialize)]
pub(crate) struct ModelResponse {
    pub sources: Vec<ModelSource>,
}

#[derive(Debug, Deserialize, JsonSchema, PartialEq, Eq, Serialize)]
pub(crate) struct ModelSource {
    pub source_id: String,
    pub summary: String,
    pub key_points: Vec<ModelKeyPoint>,
}

#[derive(Debug, Deserialize, JsonSchema, PartialEq, Eq, Serialize)]
pub(crate) struct ModelKeyPoint {
    pub text: String,
    pub quote: String,
}

#[derive(Debug, PartialEq, Eq, Serialize, ToSchema)]
pub(crate) struct ResearchKeyPointsResult {
    pub sources: Vec<ResearchSourceResult>,
}

#[derive(Debug, PartialEq, Eq, Serialize, ToSchema)]
pub(crate) struct ResearchSourceResult {
    pub id: String,
    pub summary: String,
    pub key_points: Vec<ResearchKeyPoint>,
}

#[derive(Debug, PartialEq, Eq, Serialize, ToSchema)]
pub(crate) struct ResearchKeyPoint {
    pub text: String,
    pub quote: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[expect(dead_code, reason = "used as the OpenAPI response schema")]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub(crate) enum ResearchKeyPointsEvent {
    Result(ResearchKeyPointsResult),
    Error(crate::llm::LlmErrorPayload),
}

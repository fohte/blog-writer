use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum LlmError {
    #[error("failed to start or communicate with the LLM provider")]
    Provider,
    #[error("LLM call was cancelled due to shutdown")]
    Cancelled,
    #[error("LLM provider returned invalid output")]
    InvalidOutput,
    #[error("LLM provider did not return structured output")]
    MissingStructuredOutput,
    #[error("LLM provider usage limit reached")]
    UsageLimit,
    #[error("LLM call exceeded the 10 minute time limit")]
    Timeout,
    #[error("LLM output does not match the expected type")]
    InvalidResponse,
    #[error("LLM result does not match the request")]
    InvalidResult,
    #[error("LLM result could not be serialized")]
    SerializeResult,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LlmErrorCode {
    UsageLimit,
    InvalidResponse,
    Timeout,
    Connection,
}

impl LlmError {
    fn code(&self) -> LlmErrorCode {
        match self {
            Self::UsageLimit => LlmErrorCode::UsageLimit,
            Self::Timeout => LlmErrorCode::Timeout,
            Self::InvalidOutput
            | Self::MissingStructuredOutput
            | Self::InvalidResponse
            | Self::InvalidResult
            | Self::SerializeResult => LlmErrorCode::InvalidResponse,
            Self::Provider | Self::Cancelled => LlmErrorCode::Connection,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub(crate) struct LlmErrorPayload {
    pub code: LlmErrorCode,
    pub message: String,
}

impl From<&LlmError> for LlmErrorPayload {
    fn from(error: &LlmError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

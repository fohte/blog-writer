mod claude_code;
mod handler;
mod router;

use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

use axum::{response::sse::Event, response::sse::Sse};
use futures_util::stream::{self, Stream};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use thiserror::Error;
use utoipa::ToSchema;

use crate::config::{LlmConfig, ProviderName};

pub use claude_code::ClaudeCodeProvider;
pub use handler::LlmStatusResponse;
pub use router::router;

#[cfg(test)]
mod tests;

const CALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub trait LlmProvider: Send + Sync {
    fn generate<'a>(
        &'a self,
        prompt: String,
        schema: Value,
    ) -> Pin<Box<dyn Future<Output = Result<Value, LlmError>> + Send + 'a>>;
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LlmError {
    #[error("failed to start or communicate with Claude Code")]
    Provider,
    #[error("Claude Code returned invalid output")]
    InvalidOutput,
    #[error("Claude Code did not return structured output")]
    MissingStructuredOutput,
    #[error("LLM call exceeded the 10 minute time limit")]
    Timeout,
    #[error("LLM output does not match the expected type")]
    InvalidResponse,
    #[error("LLM result could not be serialized")]
    SerializeResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub enum LlmEvent {
    Result(Value),
    Error(LlmErrorPayload),
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct LlmErrorPayload {
    pub message: String,
}

#[derive(Clone)]
pub struct LlmState {
    pub(crate) provider: Arc<dyn LlmProvider>,
    provider_name: ProviderName,
    locked: bool,
    timeout: Duration,
}

impl LlmState {
    pub fn new(config: LlmConfig) -> Self {
        Self {
            provider: Arc::new(ClaudeCodeProvider::default()),
            provider_name: config.provider,
            locked: config.locked,
            timeout: CALL_TIMEOUT,
        }
    }

    pub fn provider_name(&self) -> ProviderName {
        self.provider_name
    }

    pub fn is_locked(&self) -> bool {
        self.locked
    }

    #[cfg(test)]
    fn with_provider(provider: impl LlmProvider + 'static, timeout: Duration) -> Self {
        Self {
            provider: Arc::new(provider),
            provider_name: ProviderName::ClaudeCode,
            locked: false,
            timeout,
        }
    }
}

impl Default for LlmState {
    fn default() -> Self {
        Self::new(LlmConfig::default())
    }
}

pub async fn call<T>(provider: &dyn LlmProvider, prompt: &str) -> Result<T, LlmError>
where
    T: DeserializeOwned + JsonSchema,
{
    call_with_timeout(provider, prompt, CALL_TIMEOUT).await
}

async fn call_with_timeout<T>(
    provider: &dyn LlmProvider,
    prompt: &str,
    timeout: Duration,
) -> Result<T, LlmError>
where
    T: DeserializeOwned + JsonSchema,
{
    let schema = schemars::generate::SchemaSettings::draft07()
        .into_generator()
        .into_root_schema_for::<T>();
    let schema = serde_json::to_value(schema).map_err(|_| LlmError::InvalidOutput)?;
    let output = tokio::time::timeout(timeout, provider.generate(prompt.to_owned(), schema))
        .await
        .map_err(|_| LlmError::Timeout)??;

    serde_json::from_value(output).map_err(|_| LlmError::InvalidResponse)
}

pub fn call_to_sse<T>(
    state: LlmState,
    prompt: String,
) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>
where
    T: DeserializeOwned + JsonSchema + Serialize + Send + 'static,
{
    Sse::new(stream::once(async move {
        let event =
            match call_with_timeout::<T>(state.provider.as_ref(), &prompt, state.timeout).await {
                Ok(result) => serde_json::to_value(result)
                    .map(LlmEvent::Result)
                    .unwrap_or_else(|_| {
                        LlmEvent::Error(LlmErrorPayload {
                            message: LlmError::SerializeResult.to_string(),
                        })
                    }),
                Err(error) => LlmEvent::Error(LlmErrorPayload {
                    message: error.to_string(),
                }),
            };
        let name = match event {
            LlmEvent::Result(_) => "result",
            LlmEvent::Error(_) => "error",
        };
        let data = serde_json::to_string(&event).unwrap_or_else(|_| {
            r#"{"event":"error","data":{"message":"LLM result could not be serialized"}}"#
                .to_owned()
        });

        Ok(Event::default().event(name).data(data))
    }))
}

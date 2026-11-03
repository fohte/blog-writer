mod claude_code;
mod handler;
mod router;

use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream::{self, Stream};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use thiserror::Error;
use utoipa::ToSchema;

use crate::config::{LlmConfig, ProviderName};

pub(crate) use router::router;

#[cfg(test)]
mod tests;

const CALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(15);

trait LlmProvider: Send + Sync {
    fn generate<'a>(
        &'a self,
        system_prompt: String,
        prompt: String,
        schema: Value,
    ) -> Pin<Box<dyn Future<Output = Result<Value, LlmError>> + Send + 'a>>;
}

#[derive(Debug, Error, PartialEq, Eq)]
enum LlmError {
    #[error("failed to start or communicate with the LLM provider")]
    Provider,
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
    #[error("LLM result could not be serialized")]
    SerializeResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub(crate) enum LlmEvent {
    Result(Value),
    Error(LlmErrorPayload),
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub(crate) struct LlmErrorPayload {
    pub message: String,
}

impl LlmEvent {
    fn into_sse_event(self) -> Event {
        let data = match serde_json::to_value(self) {
            Ok(data) => data,
            Err(_) => return Self::serialization_error_event(),
        };
        let Some(name) = data.get("event").and_then(Value::as_str).map(str::to_owned) else {
            return Self::serialization_error_event();
        };

        Event::default().event(name).data(data.to_string())
    }

    fn serialization_error_event() -> Event {
        let data = serde_json::json!({
            "event": "error",
            "data": {"message": LlmError::SerializeResult.to_string()}
        });

        Event::default().event("error").data(data.to_string())
    }
}

#[derive(Clone)]
pub(crate) struct LlmState {
    provider: Arc<dyn LlmProvider>,
    provider_name: ProviderName,
    locked: bool,
    timeout: Duration,
    keep_alive_interval: Duration,
}

impl LlmState {
    pub(crate) fn new(config: LlmConfig) -> Self {
        Self {
            provider: Arc::new(claude_code::ClaudeCodeProvider::default()),
            provider_name: config.provider,
            locked: config.locked,
            timeout: CALL_TIMEOUT,
            keep_alive_interval: KEEP_ALIVE_INTERVAL,
        }
    }

    pub(crate) fn provider_name(&self) -> ProviderName {
        self.provider_name
    }

    pub(crate) fn is_locked(&self) -> bool {
        self.locked
    }

    #[cfg(test)]
    fn with_provider(provider: impl LlmProvider + 'static, timeout: Duration) -> Self {
        Self {
            provider: Arc::new(provider),
            provider_name: ProviderName::ClaudeCode,
            locked: false,
            timeout,
            keep_alive_interval: KEEP_ALIVE_INTERVAL,
        }
    }

    #[cfg(test)]
    fn with_keep_alive_interval(mut self, interval: Duration) -> Self {
        self.keep_alive_interval = interval;
        self
    }
}

impl Default for LlmState {
    fn default() -> Self {
        Self::new(LlmConfig::default())
    }
}

async fn call_with_timeout<T>(
    provider: &dyn LlmProvider,
    system_prompt: &str,
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
    let output = tokio::time::timeout(
        timeout,
        provider.generate(system_prompt.to_owned(), prompt.to_owned(), schema),
    )
    .await
    .map_err(|_| LlmError::Timeout)??;

    serde_json::from_value(output).map_err(|_| LlmError::InvalidResponse)
}

pub(crate) fn call_to_sse<T>(
    state: LlmState,
    system_prompt: String,
    prompt: String,
) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>
where
    T: DeserializeOwned + JsonSchema + Serialize + Send + 'static,
{
    call_to_sse_map::<T, T>(state, system_prompt, prompt, std::convert::identity)
}

pub(crate) fn call_to_sse_map<T, U>(
    state: LlmState,
    system_prompt: String,
    prompt: String,
    map_result: impl FnOnce(T) -> U + Send + 'static,
) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>
where
    T: DeserializeOwned + JsonSchema + Send + 'static,
    U: Serialize + Send + 'static,
{
    let keep_alive_interval = state.keep_alive_interval;
    let stream = stream::once(async move {
        let event = match call_with_timeout::<T>(
            state.provider.as_ref(),
            &system_prompt,
            &prompt,
            state.timeout,
        )
        .await
        {
            Ok(result) => match serde_json::to_value(map_result(result)) {
                Ok(result) => LlmEvent::Result(result),
                Err(error) => {
                    tracing::warn!(
                        error_kind = ?LlmError::SerializeResult,
                        %error,
                        "failed to serialize LLM result"
                    );
                    LlmEvent::Error(LlmErrorPayload {
                        message: LlmError::SerializeResult.to_string(),
                    })
                }
            },
            Err(error) => {
                tracing::warn!(error_kind = ?error, "LLM call failed");
                LlmEvent::Error(LlmErrorPayload {
                    message: error.to_string(),
                })
            }
        };
        Ok(event.into_sse_event())
    });

    // Keep long model calls alive through proxies that time out before the first result.
    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(keep_alive_interval)
            .text("keep-alive"),
    )
}

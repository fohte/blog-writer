mod claude_code;
mod handler;
mod openai_compatible;
mod router;

use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::{
    StreamExt,
    stream::{self, Stream},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use thiserror::Error;
use tokio::sync::{mpsc, watch};
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

    fn web_search<'a>(
        &'a self,
        system_prompt: String,
        prompt: String,
        progress: mpsc::UnboundedSender<String>,
    ) -> Pin<Box<dyn Future<Output = Result<WebSearchResult, LlmError>> + Send + 'a>>;
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Serialize, ToSchema)]
pub(crate) struct WebSearchResult {
    pub text: String,
    pub citations: Vec<String>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub(crate) enum LlmEvent {
    Progress(LlmProgress),
    Result(Value),
    Error(LlmErrorPayload),
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub(crate) struct LlmProgress {
    pub query: String,
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
    shutdown: watch::Receiver<bool>,
}

impl LlmState {
    #[cfg(test)]
    pub(crate) fn new(config: LlmConfig) -> Self {
        let (_, shutdown) = watch::channel(false);
        Self::new_with_shutdown(config, shutdown)
    }

    pub(crate) fn new_with_shutdown(config: LlmConfig, shutdown: watch::Receiver<bool>) -> Self {
        let provider: Arc<dyn LlmProvider> = match config.provider {
            ProviderName::ClaudeCode => Arc::new(claude_code::ClaudeCodeProvider::default()),
            ProviderName::OpenAiCompatible => Arc::new(
                openai_compatible::OpenAiCompatibleProvider::new(config.openai_compatible),
            ),
        };
        Self {
            provider,
            provider_name: config.provider,
            locked: config.locked,
            timeout: CALL_TIMEOUT,
            keep_alive_interval: KEEP_ALIVE_INTERVAL,
            shutdown,
        }
    }

    pub(crate) fn provider_name(&self) -> ProviderName {
        self.provider_name
    }

    pub(crate) fn is_locked(&self) -> bool {
        self.locked
    }

    pub(crate) fn supports_web_search(&self) -> bool {
        true
    }

    #[cfg(test)]
    fn with_provider(
        provider: impl LlmProvider + 'static,
        provider_name: ProviderName,
        timeout: Duration,
    ) -> Self {
        Self {
            provider: Arc::new(provider),
            provider_name,
            locked: false,
            timeout,
            keep_alive_interval: KEEP_ALIVE_INTERVAL,
            shutdown: watch::channel(false).1,
        }
    }

    #[cfg(test)]
    fn with_shutdown(mut self, shutdown: watch::Receiver<bool>) -> Self {
        self.shutdown = shutdown;
        self
    }

    #[cfg(test)]
    fn with_keep_alive_interval(mut self, interval: Duration) -> Self {
        self.keep_alive_interval = interval;
        self
    }
}

impl Default for LlmState {
    fn default() -> Self {
        let (_, shutdown) = watch::channel(false);
        Self::new_with_shutdown(LlmConfig::default(), shutdown)
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
    call_to_sse_with::<T, T, _>(state, system_prompt, prompt, Ok)
}

enum WebSearchEvent {
    Progress(String),
    Result(WebSearchResult),
    Error(LlmError),
    Cancelled,
}

impl WebSearchEvent {
    fn into_sse_event(self) -> Option<Event> {
        match self {
            Self::Progress(query) => {
                Some(LlmEvent::Progress(LlmProgress { query }).into_sse_event())
            }
            Self::Result(result) => match serde_json::to_value(result) {
                Ok(result) => Some(LlmEvent::Result(result).into_sse_event()),
                Err(error) => {
                    tracing::warn!(error_kind = ?LlmError::SerializeResult, %error, "failed to serialize web search result");
                    Some(
                        LlmEvent::Error(LlmErrorPayload {
                            message: LlmError::SerializeResult.to_string(),
                        })
                        .into_sse_event(),
                    )
                }
            },
            Self::Error(error) => {
                tracing::warn!(error_kind = ?error, "LLM web search failed");
                Some(
                    LlmEvent::Error(LlmErrorPayload {
                        message: error.to_string(),
                    })
                    .into_sse_event(),
                )
            }
            Self::Cancelled => None,
        }
    }
}

type WebSearchFuture = Pin<Box<dyn Future<Output = Result<WebSearchResult, LlmError>> + Send>>;

struct WebSearchStreamState {
    search: Option<WebSearchFuture>,
    progress_receiver: mpsc::UnboundedReceiver<String>,
    pending_result: Option<WebSearchEvent>,
    finished: bool,
}

impl WebSearchStreamState {
    async fn next_event(&mut self) -> Option<WebSearchEvent> {
        if self.finished {
            return None;
        }
        if let Ok(query) = self.progress_receiver.try_recv() {
            return Some(WebSearchEvent::Progress(query));
        }
        if let Some(event) = self.pending_result.take() {
            self.finished = true;
            return Some(event);
        }

        let search_future = self.search.as_mut()?;
        tokio::select! {
            Some(query) = self.progress_receiver.recv() => Some(WebSearchEvent::Progress(query)),
            result = search_future => {
                self.search = None;
                let event = match result {
                    Ok(result) => WebSearchEvent::Result(result),
                    Err(error) => WebSearchEvent::Error(error),
                };
                if let Ok(query) = self.progress_receiver.try_recv() {
                    self.pending_result = Some(event);
                    Some(WebSearchEvent::Progress(query))
                } else {
                    self.finished = true;
                    Some(event)
                }
            }
        }
    }

    fn cancel(&mut self) {
        self.search = None;
        self.pending_result = None;
        self.finished = true;
    }
}

struct WebSearchEventStream {
    state: WebSearchStreamState,
    shutdown: watch::Receiver<bool>,
}

impl WebSearchEventStream {
    async fn next_event(&mut self) -> Option<WebSearchEvent> {
        if self.state.finished {
            return None;
        }

        let state = &mut self.state;
        let shutdown = &mut self.shutdown;
        tokio::select! {
            biased;
            _ = wait_for_shutdown(shutdown) => {
                state.cancel();
                Some(WebSearchEvent::Cancelled)
            }
            event = state.next_event() => event,
        }
    }
}

fn web_search_events(
    state: LlmState,
    system_prompt: String,
    prompt: String,
) -> impl Stream<Item = WebSearchEvent> {
    let (progress_sender, progress_receiver) = mpsc::unbounded_channel();
    let provider = state.provider.clone();
    let search = Box::pin(async move {
        provider
            .web_search(system_prompt, prompt, progress_sender)
            .await
    });
    let timeout = state.timeout;
    let search: Pin<Box<dyn Future<Output = Result<WebSearchResult, LlmError>> + Send>> =
        Box::pin(async move {
            tokio::time::timeout(timeout, search)
                .await
                .unwrap_or(Err(LlmError::Timeout))
        });
    stream::unfold(
        WebSearchEventStream {
            state: WebSearchStreamState {
                search: Some(search),
                progress_receiver,
                pending_result: None,
                finished: false,
            },
            shutdown: state.shutdown,
        },
        |mut stream| async move { stream.next_event().await.map(|event| (event, stream)) },
    )
}

pub(crate) async fn call_web_search_with(
    state: LlmState,
    system_prompt: String,
    prompt: String,
    mut on_progress: impl FnMut(String),
) -> Result<WebSearchResult, LlmError> {
    let events = web_search_events(state, system_prompt, prompt);
    futures_util::pin_mut!(events);
    let mut result = None;
    while let Some(event) = events.next().await {
        match event {
            WebSearchEvent::Progress(query) => on_progress(query),
            WebSearchEvent::Result(web_search_result) => result = Some(web_search_result),
            WebSearchEvent::Error(error) => return Err(error),
            WebSearchEvent::Cancelled => return Err(LlmError::Cancelled),
        }
    }
    result.ok_or(LlmError::InvalidOutput)
}

pub(crate) fn call_web_search_to_sse(
    state: LlmState,
    system_prompt: String,
    prompt: String,
) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
    let keep_alive_interval = state.keep_alive_interval;
    let stream = web_search_events(state, system_prompt, prompt)
        .filter_map(|event| async move { event.into_sse_event().map(Ok) });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(keep_alive_interval)
            .text("keep-alive"),
    )
}

pub(crate) fn call_to_sse_with<Input, Output, Transform>(
    state: LlmState,
    system_prompt: String,
    prompt: String,
    transform: Transform,
) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>
where
    Input: DeserializeOwned + JsonSchema + Send + 'static,
    Output: Serialize + Send + 'static,
    Transform: FnOnce(Input) -> Result<Output, LlmError> + Send + 'static,
{
    let keep_alive_interval = state.keep_alive_interval;
    let stream = stream::once(async move {
        let mut shutdown = state.shutdown.clone();
        let result = tokio::select! {
            result = call_with_timeout::<Input>(
                state.provider.as_ref(),
                &system_prompt,
                &prompt,
                state.timeout,
            ) => result,
            _ = wait_for_shutdown(&mut shutdown) => return None,
        };
        let event = match result {
            Ok(result) => match transform(result) {
                Ok(result) => match serde_json::to_value(result) {
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
                    tracing::warn!(error_kind = ?error, "failed to transform LLM result");
                    LlmEvent::Error(LlmErrorPayload {
                        message: error.to_string(),
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
        Some(Ok(event.into_sse_event()))
    })
    .filter_map(futures_util::future::ready);

    // Keep long model calls alive through proxies that time out before the first result.
    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(keep_alive_interval)
            .text("keep-alive"),
    )
}

async fn wait_for_shutdown(shutdown: &mut watch::Receiver<bool>) {
    while !*shutdown.borrow() {
        if shutdown.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

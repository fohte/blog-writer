use futures_util::StreamExt;
use reqwest::{Client, StatusCode, Url};
use serde_json::{Value, json};

use crate::config::OpenAiCompatibleConfig;

use super::{LlmError, LlmProvider};

const TOOL_NAME: &str = "structured_output";

pub(super) struct OpenAiCompatibleProvider {
    config: OpenAiCompatibleConfig,
}

impl OpenAiCompatibleProvider {
    pub(super) fn new(config: OpenAiCompatibleConfig) -> Self {
        Self { config }
    }

    async fn generate_inner(
        &self,
        system_prompt: String,
        prompt: String,
        schema: Value,
    ) -> Result<Value, LlmError> {
        let Some(base_url) = self.config.base_url.as_deref() else {
            tracing::warn!("LLM_BASE_URL is required for the OpenAI-compatible provider");
            return Err(LlmError::Provider);
        };
        let Some(model) = self.config.model.as_deref() else {
            tracing::warn!("LLM_MODEL is required for the OpenAI-compatible provider");
            return Err(LlmError::Provider);
        };
        let endpoint = Url::parse(base_url)
            .and_then(|url| url.join("/v1/chat/completions"))
            .map_err(|error| {
                tracing::warn!(%error, "OpenAI-compatible endpoint URL is invalid");
                LlmError::Provider
            })?;

        let client = Client::builder().build().map_err(|error| {
            tracing::warn!(%error, "failed to create OpenAI-compatible HTTP client");
            LlmError::Provider
        })?;
        let mut request = client.post(endpoint).json(&json!({
            "model": model,
            "stream": true,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "tools": [{
                "type": "function",
                "function": {
                    "name": TOOL_NAME,
                    "parameters": schema,
                },
            }],
            "tool_choice": {"type": "function", "function": {"name": TOOL_NAME}},
        }));
        if let Some(api_key) = self.config.api_key.as_deref() {
            request = request.bearer_auth(api_key);
        }

        let response = request.send().await.map_err(|error| {
            tracing::warn!(%error, "OpenAI-compatible request failed");
            LlmError::Provider
        })?;
        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            tracing::warn!(
                "OpenAI-compatible provider rejected the request because its usage limit was reached"
            );
            return Err(LlmError::UsageLimit);
        }
        if !response.status().is_success() {
            tracing::warn!(status = %response.status(), "OpenAI-compatible provider returned an unsuccessful status");
            return Err(LlmError::Provider);
        }

        let mut response_stream = response.bytes_stream();
        let mut line_buffer = Vec::new();
        let mut event_data = Vec::new();
        let mut tool_call = None;
        while let Some(chunk) = response_stream.next().await {
            let chunk = chunk.map_err(|error| {
                tracing::warn!(%error, "failed to read OpenAI-compatible response stream");
                LlmError::Provider
            })?;
            line_buffer.extend_from_slice(&chunk);
            while let Some(newline) = line_buffer.iter().position(|byte| *byte == b'\n') {
                let mut line: Vec<u8> = line_buffer.drain(..=newline).collect();
                line.pop();
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                process_sse_line(&line, &mut event_data, &mut tool_call)?;
            }
        }
        if !line_buffer.is_empty() {
            process_sse_line(&line_buffer, &mut event_data, &mut tool_call)?;
        }
        process_sse_event(&mut event_data, &mut tool_call)?;

        let Some(tool_call) = tool_call else {
            tracing::warn!("OpenAI-compatible provider did not return a function tool call");
            return Err(LlmError::MissingStructuredOutput);
        };
        if tool_call.name.as_deref() != Some(TOOL_NAME) {
            tracing::warn!("OpenAI-compatible provider returned an unexpected function tool");
            return Err(LlmError::InvalidOutput);
        }
        serde_json::from_str(&tool_call.arguments).map_err(|error| {
            tracing::warn!(%error, "OpenAI-compatible provider returned invalid function arguments");
            LlmError::InvalidOutput
        })
    }
}

impl LlmProvider for OpenAiCompatibleProvider {
    fn generate<'a>(
        &'a self,
        system_prompt: String,
        prompt: String,
        schema: Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, LlmError>> + Send + 'a>>
    {
        Box::pin(self.generate_inner(system_prompt, prompt, schema))
    }
}

#[derive(Default)]
struct ToolCall {
    index: Option<u64>,
    name: Option<String>,
    arguments: String,
}

fn process_sse_line(
    line: &[u8],
    event_data: &mut Vec<String>,
    tool_call: &mut Option<ToolCall>,
) -> Result<(), LlmError> {
    if line.is_empty() {
        return process_sse_event(event_data, tool_call);
    }
    let Some(data) = line.strip_prefix(b"data:") else {
        return Ok(());
    };
    let data = data.strip_prefix(b" ").unwrap_or(data);
    let data = std::str::from_utf8(data).map_err(|error| {
        tracing::warn!(%error, "OpenAI-compatible provider emitted non-UTF-8 SSE data");
        LlmError::InvalidOutput
    })?;
    event_data.push(data.to_owned());
    Ok(())
}

fn process_sse_event(
    event_data: &mut Vec<String>,
    tool_call: &mut Option<ToolCall>,
) -> Result<(), LlmError> {
    if event_data.is_empty() {
        return Ok(());
    }
    let data = event_data.join("\n");
    event_data.clear();
    if data == "[DONE]" {
        return Ok(());
    }

    let event: Value = serde_json::from_str(&data).map_err(|error| {
        tracing::warn!(%error, "OpenAI-compatible provider emitted invalid SSE JSON");
        LlmError::InvalidOutput
    })?;
    if event.get("error").is_some() {
        tracing::warn!("OpenAI-compatible provider emitted an error event");
        return Err(LlmError::Provider);
    }
    let choices = event
        .get("choices")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            tracing::warn!("OpenAI-compatible provider emitted an invalid completion event");
            LlmError::InvalidOutput
        })?;
    for choice in choices {
        let Some(calls) = choice
            .pointer("/delta/tool_calls")
            .and_then(Value::as_array)
        else {
            continue;
        };
        for call in calls {
            let index = call.get("index").and_then(Value::as_u64).ok_or_else(|| {
                tracing::warn!(
                    "OpenAI-compatible provider emitted a function call without an index"
                );
                LlmError::InvalidOutput
            })?;
            let current = tool_call.get_or_insert_with(ToolCall::default);
            if current.index.is_some_and(|existing| existing != index) {
                tracing::warn!("OpenAI-compatible provider returned multiple function calls");
                return Err(LlmError::InvalidOutput);
            }
            current.index = Some(index);
            if let Some(function) = call.get("function") {
                if let Some(name) = function.get("name").and_then(Value::as_str) {
                    current.name.get_or_insert_with(String::new).push_str(name);
                }
                if let Some(arguments) = function.get("arguments").and_then(Value::as_str) {
                    current.arguments.push_str(arguments);
                }
            }
        }
    }
    Ok(())
}

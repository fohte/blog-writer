use std::{ffi::OsString, fmt::Display, io::ErrorKind, process::Stdio};

use serde_json::Value;
use tempfile::TempDir;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

use super::{LlmError, LlmProvider};

enum EventOutcome {
    Ignore,
    Error(LlmError),
    StructuredOutput(Value),
}

fn log_provider_error(error: impl Display, operation: &'static str) -> LlmError {
    tracing::warn!(%error, operation, "Claude Code operation failed");
    LlmError::Provider
}

fn log_missing_pipe(pipe: &'static str) -> LlmError {
    tracing::warn!(pipe, "Claude Code process pipe was unavailable");
    LlmError::Provider
}

fn record_event_error(result_error: &mut Option<LlmError>, error: LlmError) {
    if error == LlmError::UsageLimit || result_error.is_none() {
        *result_error = Some(error);
    }
}

fn classify_event(event: &Value) -> EventOutcome {
    if event.get("type").and_then(Value::as_str) == Some("rate_limit_event")
        && event
            .pointer("/rate_limit_info/status")
            .and_then(Value::as_str)
            == Some("rejected")
    {
        tracing::warn!("Claude Code rejected the request because its usage limit was reached");
        return EventOutcome::Error(LlmError::UsageLimit);
    }

    if event.get("type").and_then(Value::as_str) != Some("result") {
        return EventOutcome::Ignore;
    }

    if event.get("is_error").and_then(Value::as_bool) == Some(true) {
        let api_error_status = event.get("api_error_status").and_then(Value::as_u64);
        let subtype = event.get("subtype").and_then(Value::as_str);
        if api_error_status == Some(429) {
            tracing::warn!(
                api_error_status,
                subtype = ?subtype,
                "Claude Code returned a rate-limit error result"
            );
            EventOutcome::Error(LlmError::UsageLimit)
        } else {
            tracing::warn!(
                api_error_status = ?api_error_status,
                subtype = ?subtype,
                "Claude Code returned an error result"
            );
            EventOutcome::Error(LlmError::Provider)
        }
    } else {
        event
            .get("structured_output")
            .filter(|output| !output.is_null())
            .cloned()
            .map_or(EventOutcome::Ignore, EventOutcome::StructuredOutput)
    }
}

#[derive(Debug, Clone)]
pub(super) struct ClaudeCodeProvider {
    executable: OsString,
}

impl Default for ClaudeCodeProvider {
    fn default() -> Self {
        Self::new("claude")
    }
}

impl ClaudeCodeProvider {
    pub(super) fn new(executable: impl Into<OsString>) -> Self {
        Self {
            executable: executable.into(),
        }
    }

    async fn generate_inner(
        &self,
        system_prompt: String,
        prompt: String,
        schema: Value,
    ) -> Result<Value, LlmError> {
        // A fresh working directory keeps checkout-specific CLAUDE.md and MCP configuration out of the call.
        let working_directory = TempDir::new()
            .map_err(|error| log_provider_error(error, "create working directory"))?;
        let schema = schema.to_string();
        let mut child = Command::new(&self.executable)
            .args([
                OsString::from("-p"),
                // Replaces Claude Code's default coding-agent instructions for this call.
                OsString::from("--system-prompt"),
                OsString::from(system_prompt),
                OsString::from("--output-format"),
                OsString::from("stream-json"),
                // stream-json requires verbose mode to include the event stream.
                OsString::from("--verbose"),
                // Safe mode prevents configured hooks from influencing generation.
                OsString::from("--safe-mode"),
                OsString::from("--no-session-persistence"),
                OsString::from("--json-schema"),
                OsString::from(schema),
                OsString::from("--tools"),
                // Structured output needs no tool calls.
                OsString::new(),
            ])
            .current_dir(working_directory.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            // Dropping the SSE future on client disconnect must stop the CLI process.
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| log_provider_error(error, "start Claude Code"))?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| log_missing_pipe("stdin"))?;
        if let Err(error) = stdin.write_all(prompt.as_bytes()).await
            && error.kind() != ErrorKind::BrokenPipe
        {
            return Err(log_provider_error(error, "write prompt to stdin"));
        }
        if let Err(error) = stdin.shutdown().await
            && error.kind() != ErrorKind::BrokenPipe
        {
            return Err(log_provider_error(error, "close stdin"));
        }
        drop(stdin);

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| log_missing_pipe("stdout"))?;
        let mut lines = BufReader::new(stdout).lines();
        let mut structured_output = None;
        let mut result_error = None;
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|error| log_provider_error(error, "read output"))?
        {
            let event: Value = serde_json::from_str(&line).map_err(|error| {
                tracing::warn!(%error, "Claude Code emitted invalid stream-json output");
                LlmError::InvalidOutput
            })?;
            match classify_event(&event) {
                EventOutcome::Ignore => {}
                EventOutcome::Error(error) => record_event_error(&mut result_error, error),
                EventOutcome::StructuredOutput(output) => structured_output = Some(output),
            }
        }

        let status = child
            .wait()
            .await
            .map_err(|error| log_provider_error(error, "wait for Claude Code"))?;
        if !status.success() {
            tracing::warn!(
                exit_code = ?status.code(),
                "Claude Code exited unsuccessfully"
            );
            record_event_error(&mut result_error, LlmError::Provider);
        }
        if let Some(error) = result_error {
            return Err(error);
        }
        if structured_output.is_none() {
            tracing::warn!("Claude Code did not return structured output");
        }

        structured_output.ok_or(LlmError::MissingStructuredOutput)
    }
}

impl LlmProvider for ClaudeCodeProvider {
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

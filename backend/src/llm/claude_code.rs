use std::{ffi::OsString, process::Stdio};

use serde_json::Value;
use tempfile::TempDir;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

use super::{LlmError, LlmProvider};

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
        let working_directory = TempDir::new().map_err(|_| LlmError::Provider)?;
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
            .map_err(|_| LlmError::Provider)?;

        let mut stdin = child.stdin.take().ok_or(LlmError::Provider)?;
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|_| LlmError::Provider)?;
        stdin.shutdown().await.map_err(|_| LlmError::Provider)?;
        drop(stdin);

        let stdout = child.stdout.take().ok_or(LlmError::Provider)?;
        let mut lines = BufReader::new(stdout).lines();
        let mut structured_output = None;
        while let Some(line) = lines.next_line().await.map_err(|_| LlmError::Provider)? {
            let event: Value = serde_json::from_str(&line).map_err(|_| LlmError::InvalidOutput)?;
            if event.get("type").and_then(Value::as_str) == Some("rate_limit_event")
                && event
                    .pointer("/rate_limit_info/errorCode")
                    .and_then(Value::as_str)
                    == Some("credits_required")
            {
                return Err(LlmError::UsageLimit);
            }

            if event.get("type").and_then(Value::as_str) == Some("result") {
                if event.get("subtype").and_then(Value::as_str) == Some("error_max_budget_usd") {
                    return Err(LlmError::UsageLimit);
                }
                if event.get("is_error").and_then(Value::as_bool) == Some(true) {
                    return Err(LlmError::Provider);
                }
                structured_output = event
                    .get("structured_output")
                    .filter(|output| !output.is_null())
                    .cloned();
            }
        }

        let status = child.wait().await.map_err(|_| LlmError::Provider)?;
        if !status.success() {
            tracing::warn!(exit_code = ?status.code(), "Claude Code exited unsuccessfully");
            return Err(LlmError::Provider);
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

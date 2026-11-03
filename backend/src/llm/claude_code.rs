use std::{ffi::OsString, process::Stdio};

use serde_json::Value;
use tempfile::TempDir;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

use super::{LlmError, LlmProvider};

#[derive(Debug, Clone)]
pub struct ClaudeCodeProvider {
    executable: OsString,
}

impl Default for ClaudeCodeProvider {
    fn default() -> Self {
        Self::new("claude")
    }
}

impl ClaudeCodeProvider {
    pub fn new(executable: impl Into<OsString>) -> Self {
        Self {
            executable: executable.into(),
        }
    }

    async fn generate_inner(&self, prompt: String, schema: Value) -> Result<Value, LlmError> {
        let working_directory = TempDir::new().map_err(|_| LlmError::Provider)?;
        let schema = schema.to_string();
        let mut child = Command::new(&self.executable)
            .args([
                OsString::from("-p"),
                OsString::from("--output-format"),
                OsString::from("stream-json"),
                OsString::from("--verbose"),
                OsString::from("--safe-mode"),
                OsString::from("--no-session-persistence"),
                OsString::from("--json-schema"),
                OsString::from(schema),
                OsString::from("--tools"),
                OsString::new(),
            ])
            .current_dir(working_directory.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
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
            if event.get("type").and_then(Value::as_str) == Some("result") {
                structured_output = Some(event.get("structured_output").cloned());
            }
        }

        let status = child.wait().await.map_err(|_| LlmError::Provider)?;
        if !status.success() {
            tracing::warn!(exit_code = ?status.code(), "Claude Code exited unsuccessfully");
            return Err(LlmError::Provider);
        }

        structured_output
            .flatten()
            .ok_or(LlmError::MissingStructuredOutput)
    }
}

impl LlmProvider for ClaudeCodeProvider {
    fn generate<'a>(
        &'a self,
        prompt: String,
        schema: Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, LlmError>> + Send + 'a>>
    {
        Box::pin(self.generate_inner(prompt, schema))
    }
}

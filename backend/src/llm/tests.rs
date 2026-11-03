use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command as StdCommand,
    time::Duration,
};

use axum::{body::to_bytes, response::IntoResponse};
use futures_util::StreamExt;
use indoc::indoc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tempfile::TempDir;

use super::{CALL_TIMEOUT, ClaudeCodeProvider, LlmEvent, LlmState, call_to_sse};

#[derive(Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
struct SampleOutput {
    text: String,
}

fn fake_claude(directory: &TempDir, body: &str) -> PathBuf {
    let path = directory.path().join("fake-claude");
    let header = indoc! {"
        #!/bin/sh
        set -eu
    "};
    fs::write(&path, format!("{header}{body}\n")).expect("script is writable");
    let mut permissions = fs::metadata(&path).expect("script exists").permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&path, permissions).expect("script is executable");
    path
}

async fn sse_body(provider: ClaudeCodeProvider, prompt: &str, timeout: Duration) -> String {
    let state = LlmState::with_provider(provider, timeout);
    let response = call_to_sse::<SampleOutput>(state, prompt.to_owned()).into_response();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("SSE body is readable");
    String::from_utf8(body.to_vec()).expect("SSE body is UTF-8")
}

async fn process_is_running(pid: u32) -> bool {
    StdCommand::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

async fn wait_for_pid_file(path: &Path) -> Option<u32> {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(contents) = fs::read_to_string(path)
                && let Ok(pid) = contents.trim().parse()
            {
                return Some(pid);
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .ok()
    .flatten()
}

#[tokio::test]
async fn returns_a_schema_validated_result_event_from_claude_code() {
    let directory = TempDir::new().expect("temporary directory is available");
    let executable = fake_claude(
        &directory,
        indoc! {r#"
            printf '%s\n' "$@" > "$0.args"
            cat > "$0.input"
            printf '%s\n' '{"type":"result","structured_output":{"text":"ready"}}'
        "#},
    );
    let prompt = "Return the sample output.";
    let actual = sse_body(
        ClaudeCodeProvider::new(executable.clone().into_os_string()),
        prompt,
        Duration::from_secs(5),
    )
    .await;
    let input = fs::read_to_string(format!("{}.input", executable.display()))
        .expect("prompt was sent to stdin");
    let args = fs::read_to_string(format!("{}.args", executable.display()))
        .expect("provider arguments were passed to the command")
        .lines()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let schema = serde_json::json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "properties": {"text": {"type": "string"}},
        "required": ["text"],
        "title": "SampleOutput",
        "type": "object"
    })
    .to_string();

    assert_eq!(
        (actual, input, args),
        (
            indoc! {r#"
                event: result
                data: {"data":{"text":"ready"},"event":"result"}

            "#}
            .to_owned(),
            prompt.to_owned(),
            vec![
                "-p".to_owned(),
                "--output-format".to_owned(),
                "stream-json".to_owned(),
                "--verbose".to_owned(),
                "--safe-mode".to_owned(),
                "--no-session-persistence".to_owned(),
                "--json-schema".to_owned(),
                schema,
                "--tools".to_owned(),
                String::new(),
            ],
        )
    );
}

#[tokio::test]
async fn returns_an_error_event_when_claude_code_fails() {
    let directory = TempDir::new().expect("temporary directory is available");
    let executable = fake_claude(&directory, "exit 1");
    let actual = sse_body(
        ClaudeCodeProvider::new(executable.into_os_string()),
        "Return the sample output.",
        Duration::from_secs(5),
    )
    .await;

    assert_eq!(
        actual,
        indoc! {r#"
            event: error
            data: {"data":{"message":"failed to start or communicate with Claude Code"},"event":"error"}

        "#}
    );
}

#[tokio::test]
async fn returns_an_error_event_when_output_does_not_match_the_rust_type() {
    let directory = TempDir::new().expect("temporary directory is available");
    let executable = fake_claude(
        &directory,
        indoc! {r#"
            printf '%s\n' '{"type":"result","structured_output":{"text":42}}'
        "#},
    );
    let actual = sse_body(
        ClaudeCodeProvider::new(executable.into_os_string()),
        "Return the sample output.",
        Duration::from_secs(5),
    )
    .await;

    assert_eq!(
        actual,
        indoc! {r#"
            event: error
            data: {"data":{"message":"LLM output does not match the expected type"},"event":"error"}

        "#}
    );
}

#[tokio::test]
async fn stops_claude_code_when_the_sse_stream_is_dropped() {
    let directory = TempDir::new().expect("temporary directory is available");
    let executable = fake_claude(
        &directory,
        indoc! {r#"
            printf '%s' "$$" > "$0.pid"
            exec sleep 30
        "#},
    );
    let pid_path = PathBuf::from(format!("{}.pid", executable.display()));
    let state = LlmState::with_provider(
        ClaudeCodeProvider::new(executable.into_os_string()),
        Duration::from_secs(30),
    );
    let mut stream = call_to_sse::<SampleOutput>(state, "Return the sample output.".to_owned())
        .into_response()
        .into_body()
        .into_data_stream();
    let task = tokio::spawn(async move { stream.next().await });
    let pid = wait_for_pid_file(&pid_path)
        .await
        .expect("fake process started");
    task.abort();
    let _ = task.await;

    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(!process_is_running(pid).await);
}

#[tokio::test]
async fn enforces_the_call_timeout_and_stops_the_fake_process() {
    let directory = TempDir::new().expect("temporary directory is available");
    let executable = fake_claude(
        &directory,
        indoc! {r#"
            printf '%s' "$$" > "$0.pid"
            exec sleep 30
        "#},
    );
    let pid_path = PathBuf::from(format!("{}.pid", executable.display()));
    let provider = ClaudeCodeProvider::new(executable.into_os_string());
    let actual = sse_body(
        provider,
        "Return the sample output.",
        Duration::from_millis(750),
    )
    .await;
    let pid = wait_for_pid_file(&pid_path)
        .await
        .expect("fake process started");
    tokio::time::sleep(Duration::from_millis(100)).await;

    assert_eq!(
        (CALL_TIMEOUT, actual, process_is_running(pid).await),
        (
            Duration::from_secs(600),
            indoc! {r#"
                event: error
                data: {"data":{"message":"LLM call exceeded the 10 minute time limit"},"event":"error"}

            "#}
            .to_owned(),
            false,
        )
    );
}

#[test]
fn event_payloads_keep_their_openapi_wire_shape() {
    let actual = serde_json::to_value(LlmEvent::Error(super::LlmErrorPayload {
        message: "failed".to_owned(),
    }))
    .expect("event is serializable");

    assert_eq!(
        actual,
        serde_json::json!({"event": "error", "data": {"message": "failed"}})
    );
}

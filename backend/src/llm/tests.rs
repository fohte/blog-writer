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
use rstest::rstest;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tempfile::TempDir;

use super::claude_code::ClaudeCodeProvider;
use super::{CALL_TIMEOUT, LlmEvent, LlmState, call_to_sse};

mod write_from_key_points;

#[derive(Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
struct SampleOutput {
    text: String,
}

#[derive(Debug, PartialEq)]
struct SseFrame {
    lines: Vec<SseLine>,
}

#[derive(Debug, PartialEq)]
enum SseLine {
    Data { prefix: String, value: Value },
    Raw(String),
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

async fn sse_body(
    provider: ClaudeCodeProvider,
    system_prompt: &str,
    prompt: &str,
    timeout: Duration,
) -> String {
    let state = LlmState::with_provider(provider, timeout);
    let response = call_to_sse::<SampleOutput>(state, system_prompt.to_owned(), prompt.to_owned())
        .into_response();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("SSE body is readable");
    String::from_utf8(body.to_vec()).expect("SSE body is UTF-8")
}

fn parse_sse_body(body: &str) -> Vec<SseFrame> {
    let mut frames = Vec::new();
    let mut lines = Vec::new();
    for line in body.split_terminator('\n') {
        if line.is_empty() {
            lines.push(SseLine::Raw(String::new()));
            push_sse_frame(&mut frames, &mut lines);
        } else if let Some(("data", raw_value)) = line.split_once(':') {
            let value = raw_value.strip_prefix(' ').unwrap_or(raw_value);
            let prefix = line[..line.len() - value.len()].to_owned();
            lines.push(SseLine::Data {
                prefix,
                value: serde_json::from_str(value).expect("SSE data is valid JSON"),
            });
        } else {
            lines.push(SseLine::Raw(line.to_owned()));
        }
    }
    push_sse_frame(&mut frames, &mut lines);

    frames
}

fn push_sse_frame(frames: &mut Vec<SseFrame>, lines: &mut Vec<SseLine>) {
    if !lines.is_empty() {
        frames.push(SseFrame {
            lines: std::mem::take(lines),
        });
    }
}

fn process_is_running(pid: u32) -> bool {
    StdCommand::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

async fn wait_for_process_exit(pid: u32) -> bool {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if !process_is_running(pid) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .is_ok_and(|exited| exited)
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
    let system_prompt = "Return a concise structured response.";
    let prompt = "Return the sample output.";
    let actual = sse_body(
        ClaudeCodeProvider::new(executable.clone().into_os_string()),
        system_prompt,
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
    let schema_argument_index = args
        .iter()
        .position(|arg| arg == "--json-schema")
        .expect("provider passes a JSON schema argument");
    let schema = serde_json::from_str::<Value>(&args[schema_argument_index + 1])
        .expect("provider passes a valid JSON schema");
    let mut args_without_schema = args;
    args_without_schema.remove(schema_argument_index + 1);
    let expected_schema = serde_json::json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "properties": {"text": {"type": "string"}},
        "required": ["text"],
        "title": "SampleOutput",
        "type": "object"
    });

    assert_eq!(
        (parse_sse_body(&actual), input, args_without_schema, schema,),
        (
            vec![SseFrame {
                lines: vec![
                    SseLine::Raw("event: result".to_owned()),
                    SseLine::Data {
                        prefix: "data: ".to_owned(),
                        value: serde_json::json!({
                            "event": "result",
                            "data": {"text": "ready"}
                        }),
                    },
                    SseLine::Raw(String::new()),
                ],
            }],
            prompt.to_owned(),
            vec![
                "-p".to_owned(),
                "--system-prompt".to_owned(),
                system_prompt.to_owned(),
                "--output-format".to_owned(),
                "stream-json".to_owned(),
                "--verbose".to_owned(),
                "--safe-mode".to_owned(),
                "--no-session-persistence".to_owned(),
                "--json-schema".to_owned(),
                "--tools".to_owned(),
                String::new(),
            ],
            expected_schema,
        )
    );
}

#[rstest]
#[case::process_failure(
    "exit 1",
    indoc! {r#"
        event: error
        data: {"data":{"message":"failed to start or communicate with the LLM provider"},"event":"error"}

    "#},
    32
)]
#[case::type_mismatch(
    indoc! {r#"
        printf '%s\n' '{"type":"result","structured_output":{"text":42}}'
    "#},
    indoc! {r#"
        event: error
        data: {"data":{"message":"LLM output does not match the expected type"},"event":"error"}

    "#},
    32
)]
#[case::missing_structured_output(
    indoc! {r#"
        printf '%s\n' '{"type":"result","structured_output":null}'
    "#},
    indoc! {r#"
        event: error
        data: {"data":{"message":"LLM provider did not return structured output"},"event":"error"}

    "#},
    32
)]
#[case::invalid_json_line(
    indoc! {r#"
        printf '%s\n' 'not-json'
    "#},
    indoc! {r#"
        event: error
        data: {"data":{"message":"LLM provider returned invalid output"},"event":"error"}

    "#},
    32
)]
#[case::error_result_event(
    indoc! {r#"
        printf '%s\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["generation failed"],"structured_output":null}'
    "#},
    indoc! {r#"
        event: error
        data: {"data":{"message":"failed to start or communicate with the LLM provider"},"event":"error"}

    "#},
    32
)]
#[case::rejected_rate_limit_event(
    indoc! {r#"
        printf '%s\n' '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected"}}'
        exit 1
    "#},
    indoc! {r#"
        event: error
        data: {"data":{"message":"LLM provider usage limit reached"},"event":"error"}

    "#},
    32
)]
#[case::rate_limited_result_event(
    indoc! {r#"
        printf '%s\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["rate limit reached"],"api_error_status":429,"structured_output":null}'
    "#},
    indoc! {r#"
        event: error
        data: {"data":{"message":"LLM provider usage limit reached"},"event":"error"}

    "#},
    32
)]
#[case::rate_limited_result_event_with_large_prompt(
    indoc! {r#"
        printf '%s\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["rate limit reached"],"api_error_status":429,"structured_output":null}'
    "#},
    indoc! {r#"
        event: error
        data: {"data":{"message":"LLM provider usage limit reached"},"event":"error"}

    "#},
    1_000_000
)]
#[tokio::test]
async fn returns_an_error_event_for_claude_code_failures(
    #[case] script: &str,
    #[case] expected: &str,
    #[case] prompt_length: usize,
) {
    let directory = TempDir::new().expect("temporary directory is available");
    let executable = fake_claude(&directory, script);
    let prompt = "x".repeat(prompt_length);
    let actual = sse_body(
        ClaudeCodeProvider::new(executable.into_os_string()),
        "Return a concise structured response.",
        &prompt,
        Duration::from_secs(5),
    )
    .await;

    assert_eq!(parse_sse_body(&actual), parse_sse_body(expected));
}

#[tokio::test]
async fn sends_keep_alive_comments_while_waiting_for_claude_code() {
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
    )
    .with_keep_alive_interval(Duration::from_millis(10));
    let mut stream = call_to_sse::<SampleOutput>(
        state,
        "Return a concise structured response.".to_owned(),
        "Return the sample output.".to_owned(),
    )
    .into_response()
    .into_body()
    .into_data_stream();
    let first_chunk = tokio::time::timeout(Duration::from_secs(1), stream.next())
        .await
        .expect("SSE keep-alive arrives while the provider is running")
        .expect("SSE stream is not empty")
        .expect("SSE chunk is readable");
    let pid = wait_for_pid_file(&pid_path)
        .await
        .expect("fake process started");
    drop(stream);
    let process_exited = wait_for_process_exit(pid).await;

    assert_eq!(
        (
            String::from_utf8(first_chunk.to_vec()).expect("keep-alive is UTF-8"),
            process_exited
        ),
        (
            indoc! {r#"
                : keep-alive

            "#}
            .to_owned(),
            true,
        )
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
    let mut stream = call_to_sse::<SampleOutput>(
        state,
        "Return a concise structured response.".to_owned(),
        "Return the sample output.".to_owned(),
    )
    .into_response()
    .into_body()
    .into_data_stream();
    let task = tokio::spawn(async move { stream.next().await });
    let pid = wait_for_pid_file(&pid_path)
        .await
        .expect("fake process started");
    task.abort();
    let _ = task.await;
    let process_exited = wait_for_process_exit(pid).await;

    assert_eq!((pid > 0, process_exited), (true, true));
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
        "Return a concise structured response.",
        "Return the sample output.",
        Duration::from_millis(750),
    )
    .await;
    let pid = wait_for_pid_file(&pid_path)
        .await
        .expect("fake process started");
    let process_exited = wait_for_process_exit(pid).await;

    assert_eq!(
        (CALL_TIMEOUT, parse_sse_body(&actual), process_exited),
        (
            Duration::from_secs(600),
            vec![SseFrame {
                lines: vec![
                    SseLine::Raw("event: error".to_owned()),
                    SseLine::Data {
                        prefix: "data: ".to_owned(),
                        value: serde_json::json!({
                            "event": "error",
                            "data": {"message": "LLM call exceeded the 10 minute time limit"}
                        }),
                    },
                    SseLine::Raw(String::new()),
                ],
            }],
            true,
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

#[tokio::test]
#[ignore = "requires an authenticated Claude Code CLI; run with cargo test --lib llm::tests::manual_claude_call_uses_the_system_prompt -- --ignored"]
async fn manual_claude_call_uses_the_system_prompt() {
    let response = call_to_sse::<SampleOutput>(
        LlmState::default(),
        "Set the text field to exactly system_prompt_applied.".to_owned(),
        "Return a JSON object that matches the supplied schema.".to_owned(),
    )
    .into_response();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("SSE body is readable");
    let body = String::from_utf8(body.to_vec()).expect("SSE body is UTF-8");
    let results = body
        .lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .filter_map(|data| serde_json::from_str::<Value>(data).ok())
        .collect::<Vec<_>>();

    assert_eq!(
        results,
        vec![serde_json::json!({
            "data": {"text": "system_prompt_applied"},
            "event": "result"
        })]
    );
}

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
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

use super::claude_code::ClaudeCodeProvider;
use super::{
    CALL_TIMEOUT, LlmEvent, LlmProvider, LlmState, call_to_sse, call_web_search_to_sse,
    call_web_search_with,
};
use crate::config::{OpenAiCompatibleConfig, ProviderName};

mod research_key_points;
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
    provider: impl LlmProvider + 'static,
    system_prompt: &str,
    prompt: &str,
    timeout: Duration,
) -> String {
    let state = LlmState::with_provider(provider, ProviderName::ClaudeCode, timeout);
    sse_state_body(state, system_prompt, prompt).await
}

async fn sse_state_body(state: LlmState, system_prompt: &str, prompt: &str) -> String {
    let response = call_to_sse::<SampleOutput>(state, system_prompt.to_owned(), prompt.to_owned())
        .into_response();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("SSE body is readable");
    String::from_utf8(body.to_vec()).expect("SSE body is UTF-8")
}

async fn web_search_sse_body(state: LlmState, system_prompt: &str, prompt: &str) -> String {
    let response =
        call_web_search_to_sse(state, system_prompt.to_owned(), prompt.to_owned()).into_response();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("SSE body is readable");
    String::from_utf8(body.to_vec()).expect("SSE body is UTF-8")
}

async fn run_openai_compatible_call(
    status: u16,
    body: &str,
    api_key: Option<&str>,
) -> (MockServer, String) {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/openai/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(status)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(body),
        )
        .expect(1)
        .mount(&server)
        .await;
    let actual = sse_state_body(
        LlmState::new(crate::config::LlmConfig {
            provider: ProviderName::OpenAiCompatible,
            openai_compatible: OpenAiCompatibleConfig {
                base_url: Some(format!("{}/openai", server.uri())),
                api_key: api_key.map(str::to_owned),
                model: Some("example-model".to_owned()),
            },
            ..crate::config::LlmConfig::default()
        }),
        "system instruction",
        "user request",
    )
    .await;
    (server, actual)
}

async fn run_openai_compatible_web_search(
    body: &str,
) -> (MockServer, super::WebSearchResult, Vec<String>) {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/openai/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(body),
        )
        .expect(1)
        .mount(&server)
        .await;
    let state = LlmState::new(crate::config::LlmConfig {
        provider: ProviderName::OpenAiCompatible,
        openai_compatible: OpenAiCompatibleConfig {
            base_url: Some(format!("{}/openai", server.uri())),
            api_key: None,
            model: Some("example-model".to_owned()),
        },
        ..crate::config::LlmConfig::default()
    });
    let mut progress = Vec::new();
    let result = call_web_search_with(
        state,
        "system instruction".to_owned(),
        "user request".to_owned(),
        |query| progress.push(query),
    )
    .await
    .expect("provider returns a web search result");
    (server, result, progress)
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

#[tokio::test]
async fn openai_compatible_provider_sends_a_streaming_function_tool_request() {
    let body = indoc! {r#"
        data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"structured_output","arguments":"{\"text\":"}}]}}]}

        data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"generated\"}"}}]}}]}

        data: [DONE]
    "#}
    .replace('\n', "\r\n");
    let (server, actual) = run_openai_compatible_call(200, &body, Some("example-token")).await;
    let requests = server
        .received_requests()
        .await
        .expect("provider request was received");
    let request_body: Value =
        serde_json::from_slice(&requests[0].body).expect("provider request is JSON");
    let schema = schemars::generate::SchemaSettings::draft07()
        .into_generator()
        .into_root_schema_for::<SampleOutput>();
    let expected_body = serde_json::json!({
        "model": "example-model",
        "stream": true,
        "messages": [
            {"role": "system", "content": "system instruction"},
            {"role": "user", "content": "user request"}
        ],
        "tools": [{
            "type": "function",
            "function": {
                "name": "structured_output",
                "parameters": serde_json::to_value(schema).expect("schema is JSON")
            }
        }],
        "tool_choice": {"type": "function", "function": {"name": "structured_output"}}
    });

    assert_eq!(
        (
            requests.len(),
            requests[0].method.as_str(),
            requests[0].url.path(),
            requests[0]
                .headers
                .get("authorization")
                .and_then(|value| value.to_str().ok()),
            request_body,
            parse_sse_body(&actual),
        ),
        (
            1,
            "POST",
            "/openai/v1/chat/completions",
            Some("Bearer example-token"),
            expected_body,
            vec![SseFrame {
                lines: vec![
                    SseLine::Raw("event: result".to_owned()),
                    SseLine::Data {
                        prefix: "data: ".to_owned(),
                        value: serde_json::json!({"event":"result","data":{"text":"generated"}}),
                    },
                    SseLine::Raw(String::new()),
                ],
            }],
        )
    );
}

#[tokio::test]
async fn openai_compatible_web_search_returns_annotations_and_streams_search_progress() {
    let body = indoc! {r#"
        data: {"choices":[{"delta":{"web_search_call":{"search_queries":[{"search_query":"example query"}]}}}]}

        data: {"choices":[{"delta":{"content":"An answer mentioning https://body.example.invalid/page.","annotations":[{"type":"url_citation","url_citation":{"url":"https://source.example.invalid/first"}}]}}]}

        data: {"choices":[{"delta":{"annotations":[{"type":"url_citation","url_citation":{"url":"https://source.example.invalid/first"}},{"type":"url_citation","url_citation":{"url":"https://source.example.invalid/second"}}]}}]}

        data: [DONE]
    "#}
    .replace('\n', "\r\n");
    let (server, result, progress) = run_openai_compatible_web_search(&body).await;
    let requests = server
        .received_requests()
        .await
        .expect("provider request was received");
    let request_body: Value =
        serde_json::from_slice(&requests[0].body).expect("provider request is JSON");

    assert_eq!(
        (requests.len(), request_body, result, progress),
        (
            1,
            serde_json::json!({
                "model": "example-model",
                "stream": true,
                "web_search_options": {},
                "messages": [
                    {"role": "system", "content": "system instruction"},
                    {"role": "user", "content": "user request"}
                ]
            }),
            super::WebSearchResult {
                text: "An answer mentioning https://body.example.invalid/page.".to_owned(),
                citations: vec![
                    "https://source.example.invalid/first".to_owned(),
                    "https://source.example.invalid/second".to_owned(),
                ],
            },
            vec!["example query".to_owned()],
        )
    );
}

#[rstest]
#[case::rate_limit(429, "", "LLM provider usage limit reached")]
#[case::http_error(500, "", "failed to start or communicate with the LLM provider")]
#[case::missing_tool_call(
    200,
    indoc! {r#"
        data: {"choices":[{"delta":{}}]}

        data: [DONE]

    "#},
    "LLM provider did not return structured output"
)]
#[case::invalid_arguments(
    200,
    indoc! {r#"
        data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"structured_output","arguments":"{\"text\":"}}]}}]}

        data: [DONE]

    "#},
    "LLM provider returned invalid output"
)]
#[case::invalid_response_type(
    200,
    indoc! {r#"
        data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"structured_output","arguments":"{\"text\":1}"}}]}}]}

        data: [DONE]

    "#},
    "LLM output does not match the expected type"
)]
#[tokio::test]
async fn openai_compatible_provider_reports_provider_errors(
    #[case] status: u16,
    #[case] body: &str,
    #[case] message: &str,
) {
    let (_, actual) = run_openai_compatible_call(status, body, Some("example-token")).await;

    assert_eq!(
        parse_sse_body(&actual),
        vec![SseFrame {
            lines: vec![
                SseLine::Raw("event: error".to_owned()),
                SseLine::Data {
                    prefix: "data: ".to_owned(),
                    value: serde_json::json!({"event":"error","data":{"message":message}}),
                },
                SseLine::Raw(String::new()),
            ],
        }]
    );
}

#[tokio::test]
async fn openai_compatible_provider_omits_auth_when_no_api_key_is_configured() {
    let body = indoc! {r#"
        data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"structured_output","arguments":"{\"text\":\"generated\"}"}}]}}]}

        data: [DONE]

    "#};
    let (server, actual) = run_openai_compatible_call(200, body, None).await;
    let requests = server
        .received_requests()
        .await
        .expect("provider request was received");
    let authorization = requests[0]
        .headers
        .get("authorization")
        .and_then(|value| value.to_str().ok());

    assert_eq!(
        (requests.len(), authorization, parse_sse_body(&actual)),
        (
            1,
            None,
            vec![SseFrame {
                lines: vec![
                    SseLine::Raw("event: result".to_owned()),
                    SseLine::Data {
                        prefix: "data: ".to_owned(),
                        value: serde_json::json!({"event":"result","data":{"text":"generated"}}),
                    },
                    SseLine::Raw(String::new()),
                ],
            }],
        )
    );
}

#[tokio::test]
async fn llm_state_selects_the_configured_openai_compatible_provider() {
    let state = LlmState::new(crate::config::LlmConfig {
        provider: ProviderName::OpenAiCompatible,
        openai_compatible: OpenAiCompatibleConfig {
            base_url: Some("http://127.0.0.1".to_owned()),
            api_key: None,
            model: Some("example-model".to_owned()),
        },
        ..crate::config::LlmConfig::default()
    });

    assert_eq!(state.provider_name(), ProviderName::OpenAiCompatible);
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

#[tokio::test]
async fn claude_code_web_search_streams_progress_and_only_search_result_citations() {
    let directory = TempDir::new().expect("temporary directory is available");
    let executable = fake_claude(
        &directory,
        indoc! {r#"
            printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"WebSearch","input":{"query":"example query"}}]}}'
            printf '%s\n' '{"type":"user","tool_use_result":{"results":[{"title":"First","url":"https://source.example.invalid/first"},{"title":"Second","url":"https://source.example.invalid/second"},{"title":"Repeat","url":"https://source.example.invalid/first"}]},"message":{"content":[{"type":"tool_result","content":"Links: https://source.example.invalid/first"}]}}'
            printf '%s\n' '{"type":"result","result":"Answer mentioning https://body.example.invalid/page."}'
            printf '%s\n' "$@" > "$0.args"
            cat > "$0.input"
        "#},
    );
    let system_prompt = "Use web search and summarize results.";
    let prompt = "Find the relevant information.";
    let state = LlmState::with_provider(
        ClaudeCodeProvider::new(executable.clone().into_os_string()),
        ProviderName::ClaudeCode,
        Duration::from_secs(5),
    );
    let actual = web_search_sse_body(state, system_prompt, prompt).await;
    let input = fs::read_to_string(format!("{}.input", executable.display()))
        .expect("prompt was sent to stdin");
    let args = fs::read_to_string(format!("{}.args", executable.display()))
        .expect("provider arguments were passed to the command")
        .lines()
        .map(str::to_owned)
        .collect::<Vec<_>>();

    assert_eq!(
        (parse_sse_body(&actual), input, args),
        (
            vec![
                SseFrame {
                    lines: vec![
                        SseLine::Raw("event: progress".to_owned()),
                        SseLine::Data {
                            prefix: "data: ".to_owned(),
                            value: serde_json::json!({
                                "event": "progress",
                                "data": {"query": "example query"}
                            }),
                        },
                        SseLine::Raw(String::new()),
                    ],
                },
                SseFrame {
                    lines: vec![
                        SseLine::Raw("event: result".to_owned()),
                        SseLine::Data {
                            prefix: "data: ".to_owned(),
                            value: serde_json::json!({
                                "event": "result",
                                "data": {
                                    "text": "Answer mentioning https://body.example.invalid/page.",
                                    "citations": [
                                        "https://source.example.invalid/first",
                                        "https://source.example.invalid/second"
                                    ]
                                }
                            }),
                        },
                        SseLine::Raw(String::new()),
                    ],
                },
            ],
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
                "--tools".to_owned(),
                "WebSearch".to_owned(),
            ],
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
        ProviderName::ClaudeCode,
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
        ProviderName::ClaudeCode,
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

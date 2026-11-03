use std::time::Duration;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use indoc::indoc;
use rstest::{fixture, rstest};
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;

use super::{
    ClaudeCodeProvider, SseFrame, SseLine, TempDir as TestDirectory, fake_claude, parse_sse_body,
};
use crate::{
    app::{AppState, router},
    config::ProviderName,
    host_origin::HostOriginPolicy,
    llm::LlmState,
};

#[fixture]
fn directory() -> TempDir {
    TempDir::new().expect("temporary directory is available")
}

fn api(executable: std::path::PathBuf) -> axum::Router {
    let state = AppState {
        llm: LlmState::with_provider(
            ClaudeCodeProvider::new(executable.into_os_string()),
            ProviderName::ClaudeCode,
            Duration::from_secs(5),
        ),
        ..AppState::default()
    };
    router(
        state,
        HostOriginPolicy::new(vec!["localhost:3000".to_owned()], vec![]),
    )
}

fn fake_response(directory: &TestDirectory, structured_output: Value) -> std::path::PathBuf {
    let response = json!({
        "type": "result",
        "structured_output": structured_output,
    });
    let script = format!(
        indoc! {"
            cat > \"$0.input\"
            printf '%s\\n' '{}'
        "},
        response
    );

    fake_claude(directory, &script)
}

async fn post(api: axum::Router, request_body: Value) -> (StatusCode, String) {
    let response = api
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/research/key-points")
                .header("content-type", "application/json")
                .header("host", "localhost:3000")
                .body(Body::from(request_body.to_string()))
                .expect("request is valid"),
        )
        .await
        .expect("router returns a response");
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body is readable");

    (
        status,
        String::from_utf8(body.to_vec()).expect("response body is UTF-8"),
    )
}

#[rstest]
#[test_attr(tokio::test)]
async fn returns_only_key_points_with_quotes_found_in_the_source(directory: TempDir) {
    let executable = fake_response(
        &directory,
        json!({
            "sources": [{
                "source_id": "source-a",
                "summary": "資料の概要です。",
                "key_points": [
                    {"text": "根拠のある要点です。", "quote": "あ"},
                    {"text": "根拠のない要点です。", "quote": "い"}
                ]
            }]
        }),
    );
    let actual = post(
        api(executable),
        json!({
            "question": "問いの内容",
            "sources": [{"id": "source-a", "body": "あ"}]
        }),
    )
    .await;

    assert_eq!(
        (actual.0, parse_sse_body(&actual.1)),
        (
            StatusCode::OK,
            vec![SseFrame {
                lines: vec![
                    SseLine::Raw("event: result".to_owned()),
                    SseLine::Data {
                        prefix: "data: ".to_owned(),
                        value: json!({
                            "event": "result",
                            "data": {
                                "sources": [{
                                    "id": "source-a",
                                    "summary": "資料の概要です。",
                                    "key_points": [{
                                        "text": "根拠のある要点です。",
                                        "quote": "あ"
                                    }]
                                }]
                            }
                        }),
                    },
                    SseLine::Raw(String::new()),
                ],
            }]
        )
    );
}

#[rstest]
#[test_attr(tokio::test)]
async fn limits_source_text_in_the_provider_prompt(directory: TempDir) {
    let executable = fake_response(
        &directory,
        json!({
            "sources": [{
                "source_id": "source-a",
                "summary": "資料の概要です。",
                "key_points": []
            }]
        }),
    );
    let actual = post(
        api(executable.clone()),
        json!({
            "question": "問いの内容",
            "sources": [{"id": "source-a", "body": "あ".repeat(10_001)}]
        }),
    )
    .await;
    let provider_input = std::fs::read_to_string(format!("{}.input", executable.display()))
        .expect("provider input was captured");
    let mut expected_prompt = format!(
        "{}{}",
        indoc! {"
            依頼
            問い: 問いの内容

            資料

            資料 ID: source-a
            本文:
        "},
        "あ".repeat(10_000),
    );
    expected_prompt.push('\n');

    assert_eq!(
        (actual.0, provider_input),
        (StatusCode::OK, expected_prompt)
    );
}

#[rstest]
#[case::missing_source(json!({"sources": []}))]
#[case::duplicate_source_id(json!({
    "sources": [
        {"source_id": "source-a", "summary": "資料の概要です。", "key_points": []},
        {"source_id": "source-a", "summary": "資料の概要です。", "key_points": []}
    ]
}))]
#[case::extra_source(json!({
    "sources": [
        {"source_id": "source-a", "summary": "資料の概要です。", "key_points": []},
        {"source_id": "source-extra", "summary": "追加資料です。", "key_points": []}
    ]
}))]
#[test_attr(tokio::test)]
async fn emits_an_error_when_model_sources_do_not_match_the_request(
    directory: TempDir,
    #[case] structured_output: Value,
) {
    let executable = fake_response(&directory, structured_output);
    let actual = post(
        api(executable),
        json!({
            "question": "問いの内容",
            "sources": [{"id": "source-a", "body": "本文"}]
        }),
    )
    .await;

    assert_eq!(
        (actual.0, parse_sse_body(&actual.1)),
        (
            StatusCode::OK,
            vec![SseFrame {
                lines: vec![
                    SseLine::Raw("event: error".to_owned()),
                    SseLine::Data {
                        prefix: "data: ".to_owned(),
                        value: json!({
                            "event": "error",
                            "data": {"message": "LLM result does not match the request"}
                        }),
                    },
                    SseLine::Raw(String::new()),
                ],
            }]
        )
    );
}

#[rstest]
#[case::missing_question(None)]
#[case::empty_question(Some(""))]
#[case::whitespace_question(Some(" \t "))]
#[test_attr(tokio::test)]
async fn treats_empty_questions_as_summary_only(
    directory: TempDir,
    #[case] question: Option<&str>,
) {
    let executable = fake_response(
        &directory,
        json!({
            "sources": [{
                "source_id": "source-a",
                "summary": "資料の概要です。",
                "key_points": [{"text": "要点です。", "quote": "本文"}]
            }]
        }),
    );
    let mut request = json!({"sources": [{"id": "source-a", "body": "本文"}]});
    if let Some(question) = question {
        request["question"] = json!(question);
    }
    let actual = post(api(executable), request).await;
    let expected_prompt = indoc! {"
        依頼
        問い: なし。要約のみを作り、要点は空にしてください。

        資料

        資料 ID: source-a
        本文:
        本文
    "};

    assert_eq!(
        (
            actual.0,
            parse_sse_body(&actual.1),
            std::fs::read_to_string(directory.path().join("fake-claude.input"))
                .expect("provider input was captured"),
        ),
        (
            StatusCode::OK,
            vec![SseFrame {
                lines: vec![
                    SseLine::Raw("event: result".to_owned()),
                    SseLine::Data {
                        prefix: "data: ".to_owned(),
                        value: json!({
                            "event": "result",
                            "data": {
                                "sources": [{
                                    "id": "source-a",
                                    "summary": "資料の概要です。",
                                    "key_points": []
                                }]
                            }
                        }),
                    },
                    SseLine::Raw(String::new()),
                ],
            }],
            expected_prompt.to_owned(),
        )
    );
}

#[rstest]
#[test_attr(tokio::test)]
async fn rejects_duplicate_source_ids(directory: TempDir) {
    let executable = fake_claude(&directory, "exit 1");
    let actual = post(
        api(executable),
        json!({
            "sources": [
                {"id": "source-a", "body": "本文"},
                {"id": "source-a", "body": "別の本文"}
            ]
        }),
    )
    .await;
    let body: Value = serde_json::from_str(&actual.1).expect("error body is valid JSON");

    assert_eq!(
        (actual.0, body),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": "Source IDs must be unique"})
        )
    );
}

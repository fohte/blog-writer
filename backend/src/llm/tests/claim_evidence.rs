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

use super::{SseFrame, SseLine, TempDir as TestDirectory, fake_claude, parse_sse_body};
use crate::{
    app::{AppState, router},
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
            super::ClaudeCodeProvider::new(executable.into_os_string()),
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
                .uri("/api/research/claim-evidence")
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

fn request() -> Value {
    json!({
        "claim": "既定の保存期間は7日です。",
        "before": "設定は環境変数で変更できます。",
        "after": "設定ファイルにも値を記述できます。",
        "sources": [{
            "id": "source-a",
            "body": "現行の仕様では保存期間は30日です。"
        }]
    })
}

fn expected_frame(data: Value) -> Vec<SseFrame> {
    vec![SseFrame {
        lines: vec![
            SseLine::Raw("event: result".to_owned()),
            SseLine::Data {
                prefix: "data: ".to_owned(),
                value: json!({"event": "result", "data": data}),
            },
            SseLine::Raw(String::new()),
        ],
    }]
}

#[rstest]
#[case::supported_with_verified_quote(
    json!({"verdict": "supported", "quote": {"source_id": "source-a", "text": "現行の仕様では保存期間は30日です。"}, "suggestion": "無視される修正案"}),
    json!({"verdict": "supported", "quote": {"source_id": "source-a", "text": "現行の仕様では保存期間は30日です。"}, "suggestion": null})
)]
#[case::unsupported_quote_becomes_insufficient(
    json!({"verdict": "supported", "quote": {"source_id": "source-a", "text": "本文に存在しない引用"}, "suggestion": null}),
    json!({"verdict": "insufficient", "quote": null, "suggestion": null})
)]
#[case::unknown_source_quote_becomes_insufficient(
    json!({"verdict": "supported", "quote": {"source_id": "source-unknown", "text": "現行の仕様では保存期間は30日です。"}, "suggestion": null}),
    json!({"verdict": "insufficient", "quote": null, "suggestion": null})
)]
#[case::outdated_with_verified_quote(
    json!({"verdict": "outdated", "quote": {"source_id": "source-a", "text": "現行の仕様では保存期間は30日です。"}, "suggestion": "既定の保存期間は30日です。"}),
    json!({"verdict": "outdated", "quote": {"source_id": "source-a", "text": "現行の仕様では保存期間は30日です。"}, "suggestion": "既定の保存期間は30日です。"})
)]
#[case::contradicted_with_verified_quote(
    json!({"verdict": "contradicted", "quote": {"source_id": "source-a", "text": "現行の仕様では保存期間は30日です。"}, "suggestion": "保存期間は30日です。"}),
    json!({"verdict": "contradicted", "quote": {"source_id": "source-a", "text": "現行の仕様では保存期間は30日です。"}, "suggestion": "保存期間は30日です。"})
)]
#[case::insufficient_discards_quote_and_suggestion(
    json!({"verdict": "insufficient", "quote": {"source_id": "source-a", "text": "現行の仕様では保存期間は30日です。"}, "suggestion": "保存期間は30日です。"}),
    json!({"verdict": "insufficient", "quote": null, "suggestion": null})
)]
#[test_attr(tokio::test)]
async fn validates_the_model_verdict_and_quote(
    directory: TempDir,
    #[case] model_output: Value,
    #[case] expected_data: Value,
) {
    let executable = fake_response(&directory, model_output);
    let actual = post(api(executable), request()).await;

    assert_eq!(
        (actual.0, parse_sse_body(&actual.1)),
        (StatusCode::OK, expected_frame(expected_data))
    );
}

#[rstest]
#[test_attr(tokio::test)]
async fn includes_claim_context_and_limits_each_source_in_the_prompt(directory: TempDir) {
    let executable = fake_response(
        &directory,
        json!({"verdict": "insufficient", "quote": null, "suggestion": null}),
    );
    let mut request = request();
    request["sources"][0]["body"] = Value::String("文".repeat(10_001));
    let actual = post(api(executable.clone()), request).await;
    let provider_input = std::fs::read_to_string(format!("{}.input", executable.display()))
        .expect("provider input was captured");
    let mut expected_prompt = format!(
        "{}{}",
        indoc! {"
            判定対象
            前の文: 設定は環境変数で変更できます。
            主張: 既定の保存期間は7日です。
            後の文: 設定ファイルにも値を記述できます。

            資料

            資料 ID: source-a
            本文:
        "},
        "文".repeat(10_000),
    );
    expected_prompt.push('\n');

    assert_eq!(
        (actual.0, provider_input),
        (StatusCode::OK, expected_prompt)
    );
}

#[rstest]
#[test_attr(tokio::test)]
async fn rejects_duplicate_source_ids(directory: TempDir) {
    let executable = fake_response(
        &directory,
        json!({"verdict": "insufficient", "quote": null, "suggestion": null}),
    );
    let mut request = request();
    request["sources"] = json!([
        {"id": "source-a", "body": "架空の資料です。"},
        {"id": "source-a", "body": "別の架空の資料です。"}
    ]);
    let actual = post(api(executable), request).await;
    let body = serde_json::from_str::<Value>(&actual.1).expect("error body is valid JSON");

    assert_eq!(
        (actual.0, body),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": "Source IDs must be unique"})
        )
    );
}

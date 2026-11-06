use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{Router, body::Body, http::Request};
use indoc::indoc;
use rstest::rstest;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::super::{LlmError, LlmProvider, LlmState, WebSearchResult};
use crate::{app::AppState, config::ProviderName, proposal_body_request::router};

struct FixedProvider {
    output: Value,
    prompt: Arc<Mutex<Option<String>>>,
}

impl LlmProvider for FixedProvider {
    fn generate<'a>(
        &'a self,
        _system_prompt: String,
        prompt: String,
        _schema: Value,
    ) -> Pin<Box<dyn Future<Output = Result<Value, LlmError>> + Send + 'a>> {
        *self.prompt.lock().expect("prompt lock") = Some(prompt);
        let output = self.output.clone();
        Box::pin(async move { Ok(output) })
    }

    fn web_search<'a>(
        &'a self,
        _system_prompt: String,
        _prompt: String,
        _progress: tokio::sync::mpsc::UnboundedSender<String>,
    ) -> Pin<Box<dyn Future<Output = Result<WebSearchResult, LlmError>> + Send + 'a>> {
        Box::pin(async { Err(LlmError::Provider) })
    }
}

async fn post_request(
    request: Value,
    state: LlmState,
) -> Result<(u16, Value), Box<dyn std::error::Error>> {
    let api: Router = router().split_for_parts().0.with_state(AppState {
        export: None,
        llm: state,
        database: None,
        sync: None,
        file_sync: None,
        safe_fetch: Arc::new(crate::safe_fetch::SafeFetcher::new()),
    });
    let response = api
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/proposals/body-request")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&request)?))?,
        )
        .await?;
    let status = response.status().as_u16();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX).await?;
    let body = String::from_utf8(body.to_vec())?;
    let event = body
        .lines()
        .find_map(|line| line.strip_prefix("data: "))
        .map(serde_json::from_str::<Value>)
        .transpose()?
        .or(serde_json::from_str::<Value>(&body).ok())
        .unwrap_or(Value::Null);
    Ok((status, event))
}

#[tokio::test]
async fn returns_only_the_replacement_and_sends_the_requested_section_as_context()
-> Result<(), Box<dyn std::error::Error>> {
    let prompt = Arc::new(Mutex::new(None));
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({"replacement": "書き直した文です。"}),
            prompt: prompt.clone(),
        },
        ProviderName::ClaudeCode,
        Duration::from_secs(1),
    );
    let actual = post_request(
        json!({
            "instruction": "短くしてください",
            "premise": {
                "audience": "架空の読者",
                "purpose": "架空の目的",
                "claim": "架空の主張"
            },
            "headings": ["# 架空の記事", "## 架空の節"],
            "section": indoc! {"
                ## 架空の節
                ⟪依頼範囲の開始⟫対象の文です。⟪依頼範囲の終了⟫
                別の文です。"},
            "target": "対象の文です。"
        }),
        state,
    )
    .await?;
    let captured_prompt = prompt.lock().expect("prompt lock").clone();

    assert_eq!(
        (actual, captured_prompt),
        (
            (
                200,
                json!({
                    "data": {"replacement": "書き直した文です。"},
                    "event": "result"
                })
            ),
            Some(indoc! {"
                記事の前提
                - 読者: 架空の読者
                - 目的: 架空の目的
                - 主張: 架空の主張

                見出し一覧
                - # 架空の記事
                - ## 架空の節

                対象を含む節
                ## 架空の節
                ⟪依頼範囲の開始⟫対象の文です。⟪依頼範囲の終了⟫
                別の文です。

                書き手が選んだ範囲
                対象の文です。

                書き手の依頼
                短くしてください

                節内の ⟪依頼範囲の開始⟫ と ⟪依頼範囲の終了⟫ の間が置換対象です。マーカーを含めず、依頼に沿って置き換えた文だけを返してください。説明や前置きは付けないでください。
            "}.to_owned())
        )
    );
    Ok(())
}

#[tokio::test]
async fn rejects_an_empty_instruction() -> Result<(), Box<dyn std::error::Error>> {
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({"replacement": ""}),
            prompt: Arc::new(Mutex::new(None)),
        },
        ProviderName::ClaudeCode,
        Duration::from_secs(1),
    );
    let actual = post_request(
        json!({
            "instruction": "  ",
            "premise": {"audience": "", "purpose": "", "claim": ""},
            "headings": [],
            "section": "",
            "target": ""
        }),
        state,
    )
    .await?;

    assert_eq!(
        actual,
        (400, json!({"error": "Instruction must not be empty"}))
    );
    Ok(())
}

#[rstest]
#[case::empty_target_empty_replacement(
    "",
    "",
    json!({
        "data": {"message": "LLM result does not match the request"},
        "event": "error"
    })
)]
#[case::empty_target_whitespace_replacement(
    "",
    " \n ",
    json!({
        "data": {"message": "LLM result does not match the request"},
        "event": "error"
    })
)]
#[case::non_empty_target_empty_replacement(
    "既存の文です。",
    "",
    json!({"data": {"replacement": ""}, "event": "result"})
)]
#[case::non_empty_target_whitespace_replacement(
    "既存の文です。",
    " \n ",
    json!({"data": {"replacement": " \n "}, "event": "result"})
)]
#[tokio::test]
async fn handles_blank_replacements_according_to_the_target(
    #[case] target: &str,
    #[case] replacement: &str,
    #[case] expected_event: Value,
) -> Result<(), Box<dyn std::error::Error>> {
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({"replacement": replacement}),
            prompt: Arc::new(Mutex::new(None)),
        },
        ProviderName::ClaudeCode,
        Duration::from_secs(1),
    );
    let actual = post_request(
        json!({
            "instruction": "依頼",
            "premise": {"audience": "読者", "purpose": "目的", "claim": "主張"},
            "headings": [],
            "section": "本文",
            "target": target
        }),
        state,
    )
    .await?;

    assert_eq!(actual, (200, expected_event));
    Ok(())
}

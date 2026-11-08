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
use crate::{app::AppState, config::ProviderName, proposal_premise::router};

struct FixedProvider {
    output: Value,
    prompt: Arc<Mutex<Option<String>>>,
    schema: Arc<Mutex<Option<Value>>>,
}

impl LlmProvider for FixedProvider {
    fn generate<'a>(
        &'a self,
        _: String,
        prompt: String,
        schema: Value,
    ) -> Pin<Box<dyn Future<Output = Result<Value, LlmError>> + Send + 'a>> {
        *self.prompt.lock().expect("prompt lock") = Some(prompt);
        *self.schema.lock().expect("schema lock") = Some(schema);
        let output = self.output.clone();
        Box::pin(async move { Ok(output) })
    }

    fn web_search<'a>(
        &'a self,
        _: String,
        _: String,
        _: tokio::sync::mpsc::UnboundedSender<String>,
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
        image_publisher: None,
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
                .uri("/proposals/premise")
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
async fn includes_the_conversation_and_omits_unchanged_fields()
-> Result<(), Box<dyn std::error::Error>> {
    let prompt = Arc::new(Mutex::new(None));
    let schema = Arc::new(Mutex::new(None));
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({
                "reply": "誰に向けた記事か、もう少し絞れますか?",
                "audience": "設計を担当する開発者",
                "purpose": "変更なし",
                "thesis": "準備しておくとよい"
            }),
            prompt: prompt.clone(),
            schema: schema.clone(),
        },
        ProviderName::ClaudeCode,
        Duration::from_secs(1),
    );
    let actual = post_request(
        json!({
            "premise": {
                "audience": "開発者",
                "purpose": "変更の影響を小さくする",
                "thesis": "準備しておくとよい"
            },
            "headings": ["# 架空の記事", "## 変更の影響"],
            "messages": [
                {"role": "user", "content": "準備の話をしたい"},
                {"role": "assistant", "content": "どのような準備ですか?"},
                {"role": "user", "content": "変更前に影響を調べる準備です"}
            ]
        }),
        state,
    )
    .await?;
    let captured_prompt = prompt.lock().expect("prompt lock").clone();
    let generated_schema = schema.lock().expect("schema lock").clone();
    let actual_schema = generated_schema.map(|schema| {
        json!({
            "required": schema["required"],
            "properties": {
                "reply": schema["properties"]["reply"]["type"],
                "audience": schema["properties"]["audience"]["type"],
                "purpose": schema["properties"]["purpose"]["type"],
                "thesis": schema["properties"]["thesis"]["type"]
            }
        })
    });

    assert_eq!(
        (actual, captured_prompt, actual_schema),
        (
            (
                200,
                json!({
                    "data": {
                        "reply": "誰に向けた記事か、もう少し絞れますか?",
                        "audience": "設計を担当する開発者",
                    },
                    "event": "result"
                })
            ),
            Some(indoc! {"
                記事の前提
                - 読者: 開発者
                - 目的: 変更の影響を小さくする
                - 主張: 準備しておくとよい

                見出し一覧
                - # 架空の記事
                - ## 変更の影響

                書き手との対話履歴
                書き手: 準備の話をしたい
                アシスタント: どのような準備ですか?
                書き手: 変更前に影響を調べる準備です

                書き手の最新のメッセージを受け、記事の前提を一緒に具体化してください。
                reply は質問または確認を 1〜2 文で返してください。
                audience、purpose、thesis はそれぞれ新しい値を返すか、変更しない場合は文字列「変更なし」を返してください。
                値を変更する場合も、書き手が明示していない内容を推測して埋めないでください。
                JSON の値だけを返し、前置きや Markdown は付けないでください。
            "}.to_owned()),
            Some(json!({
                "required": ["reply", "audience", "purpose", "thesis"],
                "properties": {
                    "reply": "string",
                    "audience": "string",
                    "purpose": "string",
                    "thesis": "string"
                }
            }))
        )
    );
    Ok(())
}

#[tokio::test]
async fn omits_empty_and_whitespace_only_field_suggestions()
-> Result<(), Box<dyn std::error::Error>> {
    let prompt = Arc::new(Mutex::new(None));
    let schema = Arc::new(Mutex::new(None));
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({
                "reply": "どのような主張にしますか?",
                "audience": "",
                "purpose": "    ",
                "thesis": "変更を早めに確認すると手戻りを防げる"
            }),
            prompt,
            schema,
        },
        ProviderName::ClaudeCode,
        Duration::from_secs(1),
    );
    let actual = post_request(
        json!({
            "premise": {
                "audience": "変更を担当する開発者",
                "purpose": "手戻りを防ぐ",
                "thesis": "変更を早めに確認する"
            },
            "headings": [],
            "messages": [{"role": "user", "content": "変更前の確認について書く"}]
        }),
        state,
    )
    .await?;

    assert_eq!(
        actual,
        (
            200,
            json!({
                "data": {
                    "reply": "どのような主張にしますか?",
                    "thesis": "変更を早めに確認すると手戻りを防げる"
                },
                "event": "result"
            })
        )
    );
    Ok(())
}

#[rstest]
#[case::whitespace_only_user_message(json!([{"role": "user", "content": "   "}]))]
#[case::assistant_only(json!([{"role": "assistant", "content": "A previous question."}]))]
#[tokio::test]
async fn rejects_a_discussion_without_a_non_empty_user_message(
    #[case] messages: Value,
) -> Result<(), Box<dyn std::error::Error>> {
    let prompt = Arc::new(Mutex::new(None));
    let schema = Arc::new(Mutex::new(None));
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({
                "reply": "返答です。",
                "audience": "変更なし",
                "purpose": "変更なし",
                "thesis": "変更なし"
            }),
            prompt: prompt.clone(),
            schema,
        },
        ProviderName::ClaudeCode,
        Duration::from_secs(1),
    );
    let actual = post_request(
        json!({
            "premise": {"audience": "", "purpose": "", "thesis": ""},
            "headings": [],
            "messages": messages
        }),
        state,
    )
    .await?;
    let captured_prompt = prompt.lock().expect("prompt lock").clone();

    assert_eq!(
        (actual, captured_prompt),
        (
            (
                400,
                json!({"error": "Premise discussion must include a non-empty user message"})
            ),
            None
        )
    );
    Ok(())
}

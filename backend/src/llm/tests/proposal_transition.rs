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
use crate::{app::AppState, config::ProviderName, proposal_transition::router};

struct FixedProvider {
    output: Value,
    prompt: Arc<Mutex<Option<String>>>,
}

impl LlmProvider for FixedProvider {
    fn generate<'a>(
        &'a self,
        _: String,
        prompt: String,
        _: Value,
    ) -> Pin<Box<dyn Future<Output = Result<Value, LlmError>> + Send + 'a>> {
        *self.prompt.lock().expect("prompt lock") = Some(prompt);
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

fn transition_request() -> Value {
    let paragraph_break = std::iter::repeat_n('\n', 2).collect::<String>();

    json!({
        "premise": {
            "audience": "架空の読者",
            "purpose": "説明する",
            "thesis": "架空の主張"
        },
        "blocks": [
            {"id": "heading-a", "kind": "heading", "markdown": "## 架空の前の見出し"},
            {"id": "paragraph-a", "kind": "paragraph", "markdown": "前の架空の文です。"},
            {"id": "heading-b", "kind": "heading", "markdown": "## 架空の次の見出し"},
            {"id": "paragraph-b", "kind": "paragraph", "markdown": "次の架空の文です。"}
        ],
        "seams": [
            {
                "id": "seam-a",
                "from": 12,
                "to": 44,
                "before_sentence": "前の架空の文です。",
                "middle": paragraph_break.clone(),
                "after_sentence": "次の架空の文です。",
                "before_block_id": "paragraph-a",
                "after_block_id": "paragraph-b"
            },
            {
                "id": "seam-b",
                "from": 60,
                "to": 92,
                "before_sentence": "別の架空の文です。",
                "middle": paragraph_break.clone(),
                "after_sentence": "さらに架空の文です。",
                "before_block_id": "paragraph-a",
                "after_block_id": "paragraph-b"
            },
            {
                "id": "seam-c",
                "from": 100,
                "to": 136,
                "before_sentence": "そのまま架空の文です。",
                "middle": paragraph_break,
                "after_sentence": "保たれる架空の文です。",
                "before_block_id": "paragraph-a",
                "after_block_id": "paragraph-b"
            }
        ]
    })
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
                .uri("/proposals/transition")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&request)?))?,
        )
        .await?;
    let status = response.status().as_u16();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX).await?;
    let body = String::from_utf8(body.to_vec())?;
    let event_data = body
        .lines()
        .find_map(|line| line.strip_prefix("data: "))
        .unwrap_or(&body);
    let event = serde_json::from_str::<Value>(event_data)?;
    Ok((status, event))
}

#[rstest]
#[case::missing_before_block("before_block_id")]
#[case::missing_after_block("after_block_id")]
#[test_attr(tokio::test)]
async fn rejects_seams_that_reference_missing_blocks(
    #[case] target_field: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let prompt = Arc::new(Mutex::new(None));
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({"replacements": []}),
            prompt: prompt.clone(),
        },
        ProviderName::ClaudeCode,
        Duration::from_secs(1),
    );
    let mut request = transition_request();
    request["seams"][0][target_field] = json!("missing-block");

    let actual = post_request(request, state).await?;
    let provider_prompt = prompt.lock().expect("prompt lock").clone();

    assert_eq!(
        (actual, provider_prompt),
        (
            (
                400,
                json!({"error": "Target block `missing-block` does not exist"}),
            ),
            None
        )
    );
    Ok(())
}

#[tokio::test]
async fn returns_only_changed_known_seams_with_their_editor_ranges()
-> Result<(), Box<dyn std::error::Error>> {
    let prompt = Arc::new(Mutex::new(None));
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({
                "replacements": [
                    {
                        "before": "調整した架空の文です。",
                        "after": "つながる架空の文です。"
                    },
                    null,
                    {
                        "before": "そのまま架空の文です。",
                        "after": "保たれる架空の文です。"
                    }
                ]
            }),
            prompt: prompt.clone(),
        },
        ProviderName::ClaudeCode,
        Duration::from_secs(1),
    );

    let actual = post_request(transition_request(), state).await?;
    let captured_prompt = prompt.lock().expect("prompt lock").clone();

    assert_eq!(
        (actual, captured_prompt),
        (
            (200, json!({
                "event": "result",
                "data": {
                    "suggestions": [{
                        "seam_id": "seam-a",
                        "from": 12,
                        "to": 44,
                        "replacement": indoc! {"
                            調整した架空の文です。

                            つながる架空の文です。"}
                    }]
                }
            })),
            Some(indoc! {"
                記事の前提
                - 読者: 架空の読者
                - 目的: 説明する
                - 主張: 架空の主張

                見出し一覧
                - ## 架空の前の見出し
                - ## 架空の次の見出し

                対象と前後の本文ブロック

                [b1] 前後の文脈 (種類: heading)
                ## 架空の前の見出し

                [b2] 対象 (種類: paragraph)
                前の架空の文です。

                [b3] 前後の文脈 (種類: heading)
                ## 架空の次の見出し

                [b4] 対象 (種類: paragraph)
                次の架空の文です。

                参考資料

                継ぎ目ごとの文章調整
                各継ぎ目について、前後の文脈と記事の前提を読み、つながりを直す必要がある場合だけ前後 1 文を含む置換文を返してください。
                replacements は継ぎ目一覧と同じ順で返し、変更不要なら null にしてください。
                各置換は前後の文だけを before と after に返してください。前置きや理由は書かず、置換後の文だけを返してください。
                before と after はそれぞれ 1 行で返し、改行を含めないでください。
                継ぎ目一覧

                [seam-a]
                前後の文の間にある保持対象 Markdown:



                置換対象の前の文:
                前の架空の文です。
                置換対象の後の文:
                次の架空の文です。

                [seam-b]
                前後の文の間にある保持対象 Markdown:



                置換対象の前の文:
                別の架空の文です。
                置換対象の後の文:
                さらに架空の文です。

                [seam-c]
                前後の文の間にある保持対象 Markdown:



                置換対象の前の文:
                そのまま架空の文です。
                置換対象の後の文:
                保たれる架空の文です。
            "}.to_owned())
        )
    );
    Ok(())
}

#[tokio::test]
async fn preserves_headings_inside_seam_middle() -> Result<(), Box<dyn std::error::Error>> {
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({
                "replacements": [
                    {
                        "before": "変化した架空の前文です。",
                        "after": "続く架空の後文です。"
                    },
                    null,
                    null
                ]
            }),
            prompt: Arc::new(Mutex::new(None)),
        },
        ProviderName::ClaudeCode,
        Duration::from_secs(1),
    );
    let mut request = transition_request();
    let paragraph_break = std::iter::repeat_n('\n', 2).collect::<String>();
    request["seams"][0]["middle"] = json!(format!(
        "{paragraph_break}## 架空の次の見出し{paragraph_break}"
    ));

    let actual = post_request(request, state).await?;

    assert_eq!(
        actual,
        (
            200,
            json!({
                "event": "result",
                "data": {
                    "suggestions": [{
                        "seam_id": "seam-a",
                        "from": 12,
                        "to": 44,
                        "replacement": indoc! {"
                            変化した架空の前文です。

                            ## 架空の次の見出し

                            続く架空の後文です。"}
                    }]
                }
            })
        ),
    );
    Ok(())
}

#[tokio::test]
async fn drops_replacements_that_contain_line_breaks() -> Result<(), Box<dyn std::error::Error>> {
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({
                "replacements": [
                    {
                        "before": indoc! {"
                            見出し

                            ## 架空の見出し"},
                        "after": "継続する架空の文です。"
                    },
                    {
                        "before": "調整した架空の文です。",
                        "after": indoc! {"
                            改行を含む
                            置換文です。"}
                    },
                    {
                        "before": "調整した最後の架空の文です。",
                        "after": "つながる最後の架空の文です。"
                    }
                ]
            }),
            prompt: Arc::new(Mutex::new(None)),
        },
        ProviderName::ClaudeCode,
        Duration::from_secs(1),
    );

    let actual = post_request(transition_request(), state).await?;

    assert_eq!(
        actual,
        (
            200,
            json!({
                "event": "result",
                "data": {
                    "suggestions": [{
                        "seam_id": "seam-c",
                        "from": 100,
                        "to": 136,
                        "replacement": indoc! {"
                            調整した最後の架空の文です。

                            つながる最後の架空の文です。"}
                    }]
                }
            })
        ),
    );
    Ok(())
}

#[tokio::test]
async fn discards_all_replacements_when_the_response_length_mismatches()
-> Result<(), Box<dyn std::error::Error>> {
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({
                "replacements": [
                    null,
                    {
                        "before": "別の継ぎ目に誤って付く架空の文です。",
                        "after": "ずれた架空の文です。"
                    }
                ]
            }),
            prompt: Arc::new(Mutex::new(None)),
        },
        ProviderName::ClaudeCode,
        Duration::from_secs(1),
    );

    let actual = post_request(transition_request(), state).await?;

    assert_eq!(
        actual,
        (
            200,
            json!({
                "event": "result",
                "data": { "suggestions": [] }
            })
        ),
    );
    Ok(())
}

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

use super::super::{LlmError, LlmProvider, LlmState};
use crate::{app::AppState, write_from_key_points::router};

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
}

fn source(points: Vec<Value>) -> Value {
    source_named("架空資料", points)
}

fn source_named(title: &str, points: Vec<Value>) -> Value {
    json!({
        "title": title,
        "url": "https://example.invalid/article",
        "fetched_at": "2026-10-01",
        "summary": "架空の概要",
        "key_points": points
    })
}

fn point(id: String, heading_id: &str) -> Value {
    json!({
        "id": id,
        "researched_heading_id": heading_id,
        "text": "架空の要点",
        "quote": null
    })
}

fn request(points: Vec<Value>) -> Value {
    request_with_sources(vec![source(points)])
}

fn request_with_sources(sources: Vec<Value>) -> Value {
    json!({
        "premise": {
            "audience": "架空の読者",
            "purpose": "説明する",
            "thesis": "架空の主張"
        },
        "target_heading_id": "heading-target",
        "blocks": [
            {
                "id": "heading-target",
                "kind": "heading",
                "markdown": "## 架空の見出し"
            },
            {
                "id": "body-target",
                "kind": "paragraph",
                "markdown": "架空の既存文です。"
            },
            {
                "id": "heading-next",
                "kind": "heading",
                "markdown": "## 次の架空見出し"
            }
        ],
        "sources": sources
    })
}

async fn post_request(
    request: Value,
    state: LlmState,
) -> Result<(u16, Value), Box<dyn std::error::Error>> {
    let api: Router = router().split_for_parts().0.with_state(AppState {
        export: None,
        llm: state,
        database: None,
        safe_fetch: Arc::new(crate::safe_fetch::SafeFetcher::new()),
    });
    let response = api
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/write-from-key-points")
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
async fn translates_valid_aliases_and_discards_unknown_aliases()
-> Result<(), Box<dyn std::error::Error>> {
    let prompt = Arc::new(Mutex::new(None));
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({
                "sentences": [{
                    "text": "架空の事実です。",
                    "is_factual": true,
                    "key_point_aliases": ["s1", "missing", "s1"]
                }, {
                    "text": "架空のつなぎです。",
                    "is_factual": false,
                    "key_point_aliases": []
                }]
            }),
            prompt: prompt.clone(),
        },
        Duration::from_secs(1),
    );
    let actual = post_request(
        request(vec![point("point-a".to_owned(), "heading-target")]),
        state,
    )
    .await?;
    let captured_prompt = prompt.lock().expect("prompt lock").clone();

    assert_eq!(
        (actual, captured_prompt),
        (
            (200, json!({
                "data": {"sentences": [{
                    "text": "架空の事実です。",
                    "is_factual": true,
                    "key_point_ids": ["point-a"]
                }, {
                    "text": "架空のつなぎです。",
                    "is_factual": false,
                    "key_point_ids": []
                }]},
                "event": "result"
            })),
            Some(indoc! {"
                記事の前提
                - 読者: 架空の読者
                - 目的: 説明する
                - 主張: 架空の主張

                見出し一覧
                - ## 架空の見出し
                - ## 次の架空見出し

                対象と前後の本文ブロック

                [b1] 対象 (種類: paragraph)
                架空の既存文です。

                参考資料

                資料 1
                タイトル: 架空資料
                URL: https://example.invalid/article
                要約: 架空の概要
                取得日: 2026-10-01
                要点:
                - [s1] 架空の要点
                  調査対象見出し: ## 架空の見出し

                執筆指示
                「## 架空の見出し」の下に置く文を書いてください。
                文を分けて返し、各文が事実を述べるなら is_factual を true にしてください。
                参考要点に基づく事実の文では、根拠にした要点の別名を key_point_aliases に列挙してください。
                つなぎや意見の文は is_factual を false にし、key_point_aliases は空にしてください。
            "}.to_owned())
        )
    );
    Ok(())
}

#[tokio::test]
async fn prioritizes_target_heading_points_when_selecting_at_most_fifty()
-> Result<(), Box<dyn std::error::Error>> {
    let points = (1..=51)
        .map(|index| {
            point(
                format!("point-{index}"),
                if index == 51 {
                    "heading-target"
                } else {
                    "heading-other"
                },
            )
        })
        .collect();
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({
                "sentences": [{
                    "text": "架空の文です。",
                    "is_factual": true,
                    "key_point_aliases": [
                        "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10",
                        "s11", "s12", "s13", "s14", "s15", "s16", "s17", "s18", "s19", "s20",
                        "s21", "s22", "s23", "s24", "s25", "s26", "s27", "s28", "s29", "s30",
                        "s31", "s32", "s33", "s34", "s35", "s36", "s37", "s38", "s39", "s40",
                        "s41", "s42", "s43", "s44", "s45", "s46", "s47", "s48", "s49", "s50"
                    ]
                }]
            }),
            prompt: Arc::new(Mutex::new(None)),
        },
        Duration::from_secs(1),
    );
    let actual = post_request(request(points), state).await?;

    assert_eq!(
        actual,
        (
            200,
            json!({
                "data": {"sentences": [{
                    "text": "架空の文です。",
                    "is_factual": true,
                    "key_point_ids": [
                        "point-1", "point-2", "point-3", "point-4", "point-5", "point-6", "point-7", "point-8", "point-9", "point-10",
                        "point-11", "point-12", "point-13", "point-14", "point-15", "point-16", "point-17", "point-18", "point-19", "point-20",
                        "point-21", "point-22", "point-23", "point-24", "point-25", "point-26", "point-27", "point-28", "point-29", "point-30",
                        "point-31", "point-32", "point-33", "point-34", "point-35", "point-36", "point-37", "point-38", "point-39", "point-40",
                        "point-41", "point-42", "point-43", "point-44", "point-45", "point-46", "point-47", "point-48", "point-49", "point-51"
                    ]
                }]},
                "event": "result"
            })
        )
    );
    Ok(())
}

#[rstest]
#[test_attr(tokio::test)]
#[case::unknown_heading("heading-missing")]
#[case::existing_paragraph("body-target")]
async fn rejects_targets_that_are_not_headings(
    #[case] target_heading_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let prompt = Arc::new(Mutex::new(None));
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({"sentences": []}),
            prompt: prompt.clone(),
        },
        Duration::from_secs(1),
    );
    let mut request = request(Vec::new());
    request["target_heading_id"] = json!(target_heading_id);
    let actual = post_request(request, state).await?;
    let provider_prompt = prompt.lock().expect("prompt lock").clone();

    assert_eq!(
        (actual, provider_prompt),
        (
            (400, json!({"error": "Target heading does not exist"})),
            None
        )
    );
    Ok(())
}

#[tokio::test]
async fn groups_prioritized_key_points_by_source_in_the_prompt()
-> Result<(), Box<dyn std::error::Error>> {
    let prompt = Arc::new(Mutex::new(None));
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({"sentences": []}),
            prompt: prompt.clone(),
        },
        Duration::from_secs(1),
    );
    let actual = post_request(
        request_with_sources(vec![
            source(vec![
                point("point-a-target".to_owned(), "heading-target"),
                point("point-a-other".to_owned(), "heading-other"),
            ]),
            source_named(
                "別の架空資料",
                vec![point("point-b-target".to_owned(), "heading-target")],
            ),
        ]),
        state,
    )
    .await?;
    let captured_prompt = prompt.lock().expect("prompt lock").clone();

    assert_eq!(
        (actual, captured_prompt),
        (
            (200, json!({"data": {"sentences": []}, "event": "result"})),
            Some(indoc! {"
                記事の前提
                - 読者: 架空の読者
                - 目的: 説明する
                - 主張: 架空の主張

                見出し一覧
                - ## 架空の見出し
                - ## 次の架空見出し

                対象と前後の本文ブロック

                [b1] 対象 (種類: paragraph)
                架空の既存文です。

                参考資料

                資料 1
                タイトル: 架空資料
                URL: https://example.invalid/article
                要約: 架空の概要
                取得日: 2026-10-01
                要点:
                - [s1] 架空の要点
                  調査対象見出し: ## 架空の見出し
                - [s2] 架空の要点
                  調査対象見出し: heading-other

                資料 2
                タイトル: 別の架空資料
                URL: https://example.invalid/article
                要約: 架空の概要
                取得日: 2026-10-01
                要点:
                - [s3] 架空の要点
                  調査対象見出し: ## 架空の見出し

                執筆指示
                「## 架空の見出し」の下に置く文を書いてください。
                文を分けて返し、各文が事実を述べるなら is_factual を true にしてください。
                参考要点に基づく事実の文では、根拠にした要点の別名を key_point_aliases に列挙してください。
                つなぎや意見の文は is_factual を false にし、key_point_aliases は空にしてください。
            "}.to_owned())
        )
    );
    Ok(())
}

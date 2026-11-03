use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{Router, body::Body, http::Request};
use indoc::indoc;
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
    json!({
        "title": "架空資料",
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
        "sources": [source(points)]
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
async fn puts_target_heading_points_first_and_limits_context_to_fifty()
-> Result<(), Box<dyn std::error::Error>> {
    let prompt = Arc::new(Mutex::new(None));
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
            output: json!({"sentences": []}),
            prompt: prompt.clone(),
        },
        Duration::from_secs(1),
    );
    let response = post_request(request(points), state).await?;
    let captured_prompt = prompt
        .lock()
        .expect("prompt lock")
        .clone()
        .unwrap_or_default();
    let first_point_position = captured_prompt
        .find("[s1] 架空の要点")
        .unwrap_or(usize::MAX);
    let target_heading_position = captured_prompt
        .find("調査対象見出し: ## 架空の見出し")
        .unwrap_or(usize::MAX);
    let other_heading_position = captured_prompt
        .find("調査対象見出し: heading-other")
        .unwrap_or(usize::MAX);
    let selected_point_count = captured_prompt.matches("- [s").count();

    assert_eq!(
        (
            response.0,
            response.1,
            first_point_position < target_heading_position,
            target_heading_position < other_heading_position,
            selected_point_count
        ),
        (
            200,
            json!({"data": {"sentences": []}, "event": "result"}),
            true,
            true,
            50
        )
    );
    Ok(())
}

#[tokio::test]
async fn returns_bad_request_without_calling_the_provider_for_an_unknown_heading()
-> Result<(), Box<dyn std::error::Error>> {
    let prompt = Arc::new(Mutex::new(None));
    let state = LlmState::with_provider(
        FixedProvider {
            output: json!({"sentences": []}),
            prompt: prompt.clone(),
        },
        Duration::from_secs(1),
    );
    let mut request = request(Vec::new());
    request["target_heading_id"] = json!("heading-missing");
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

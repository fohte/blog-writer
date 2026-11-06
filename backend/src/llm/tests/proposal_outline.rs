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

use super::super::{LlmError, LlmProvider, LlmState, WebSearchResult};
use crate::{app::AppState, config::ProviderName, proposal_outline::router};

struct FixedProvider {
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
        Box::pin(async {
            Ok(json!({
                "operations": [
                    {"operation": "add", "block_alias": "b2", "replacement": "## Added\n"},
                    {"operation": "rename", "block_alias": "b1", "replacement": "# Updated"},
                    {"operation": "delete", "block_alias": "unknown", "replacement": ""}
                ]
            }))
        })
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

#[tokio::test]
async fn responds_with_range_replacements_and_full_article_context() {
    let prompt = Arc::new(Mutex::new(None));
    let state = LlmState::with_provider(
        FixedProvider {
            prompt: prompt.clone(),
        },
        ProviderName::ClaudeCode,
        Duration::from_secs(1),
    );
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
                .uri("/proposals/outline")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "premise": {"audience": "New readers", "purpose": "Explain", "thesis": "Structure matters"},
                        "body_length": 30,
                        "blocks": [
                            {"id": "heading-a", "kind": "heading", "markdown": "# Original", "from": 0, "to": 10},
                            {"id": "paragraph-a", "kind": "paragraph", "markdown": "Introduction.", "from": 12, "to": 26}
                        ]
                    })
                    .to_string(),
                ))
                .expect("request is valid"),
        )
        .await
        .expect("router responds");
    let status = response.status().as_u16();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("SSE body is readable");
    let event = String::from_utf8(body.to_vec())
        .expect("SSE body is UTF-8")
        .lines()
        .find_map(|line| line.strip_prefix("data: "))
        .and_then(|line| serde_json::from_str::<Value>(line).ok());
    let captured_prompt = prompt.lock().expect("prompt lock").clone();

    assert_eq!(
        (status, event, captured_prompt),
        (
            200,
            Some(json!({
                "event": "result",
                "data": {"suggestions": [
                    {"from": 12, "to": 12, "replacement": "## Added\n"},
                    {"from": 0, "to": 10, "replacement": "# Updated"}
                ]}
            })),
            Some(indoc! {"
                記事の前提
                - 読者: New readers
                - 目的: Explain
                - 主張: Structure matters

                見出し一覧
                - # Original

                対象と前後の本文ブロック

                [b1] 前後の文脈 (種類: heading)
                # Original

                [b2] 前後の文脈 (種類: paragraph)
                Introduction.

                参考資料

                記事の構成を控えめに見直してください。見出しの追加、改名、削除だけを提案し、本文の内容や順序は変更しないでください。
                追加は、見出しの無い段落の前にだけ行い、その段落の別名を block_alias に指定してください。
                改名と削除は、対象見出しの別名を指定してください。移動や階層変更は提案しないでください。
                追加の replacement は見出し行の後に改行を 1 つ含めてください。改名は見出し行 1 行だけにし、既存の # の数を保ってください。削除では replacement を空文字列にしてください。
                不要な変更は返さず、提案する操作ごとに operation (add, rename, delete), block_alias, replacement だけを返してください。
            "}.to_owned()),
        )
    );
}

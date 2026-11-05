use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::{
    body::to_bytes,
    extract::State,
    response::{IntoResponse, Response},
};
use indoc::indoc;
use reqwest::Url;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::{
    app::AppState,
    config::ProviderName,
    llm::{LlmError, LlmProvider, LlmState, WebSearchResult},
    safe_fetch::{FetchResponse, SafeFetchError, SafeFetchFuture, SafeFetchService},
};

use super::{handler::run_research_job, model::ResearchJobRequest};

#[derive(Clone)]
struct TestProvider {
    citations: Vec<String>,
    generation_response: Value,
    generation_calls: Arc<AtomicUsize>,
    search_prompts: Arc<Mutex<Vec<String>>>,
}

impl LlmProvider for TestProvider {
    fn generate<'a>(
        &'a self,
        _: String,
        _prompt: String,
        _: Value,
    ) -> Pin<Box<dyn Future<Output = Result<Value, LlmError>> + Send + 'a>> {
        self.generation_calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move { Ok(self.generation_response.clone()) })
    }

    fn web_search<'a>(
        &'a self,
        _: String,
        prompt: String,
        progress: mpsc::UnboundedSender<String>,
    ) -> Pin<Box<dyn Future<Output = Result<WebSearchResult, LlmError>> + Send + 'a>> {
        self.search_prompts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(prompt);
        let citations = self.citations.clone();
        Box::pin(async move {
            let _ = progress.send("sample search query".to_owned());
            Ok(WebSearchResult {
                text: "The provider response mentions https://response-body.example.test/ignored"
                    .to_owned(),
                citations,
            })
        })
    }
}

struct TestFetcher {
    unavailable_url: String,
    fetched_urls: Arc<Mutex<Vec<String>>>,
}

impl SafeFetchService for TestFetcher {
    fn fetch<'a>(&'a self, url: &'a str) -> SafeFetchFuture<'a> {
        Box::pin(async move {
            self.fetched_urls
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(url.to_owned());
            if url == self.unavailable_url {
                return Err(SafeFetchError::InvalidUrl);
            }
            Ok(FetchResponse {
                final_url: Url::parse(url).unwrap(),
                body: article_html().as_bytes().to_vec(),
                content_type: Some("text/html; charset=utf-8".to_owned()),
            })
        })
    }
}

fn article_html() -> &'static str {
    "<!doctype html><html><head><title>Example research page</title></head><body><article><h1>Example research page</h1><p>This representative sentence provides enough detail for article extraction and quote validation.</p><p>This is a second sentence with useful supporting context for the research result.</p></article></body></html>"
}

fn expected_source_body() -> String {
    indoc! {"
        This representative sentence provides enough detail for article extraction and quote validation.

        This is a second sentence with useful supporting context for the research result.
    "}
    .trim_end()
    .to_owned()
}

fn test_app_state(provider: TestProvider, fetcher: impl SafeFetchService + 'static) -> AppState {
    AppState {
        llm: LlmState::with_provider(provider, ProviderName::ClaudeCode, Duration::from_secs(30)),
        safe_fetch: Arc::new(fetcher),
        ..AppState::default()
    }
}

async fn events(response: Response) -> Vec<Value> {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body = String::from_utf8(bytes.to_vec()).unwrap();
    body.lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .map(|data| serde_json::from_str::<Value>(data).unwrap())
        .collect()
}

#[tokio::test]
async fn streams_progress_and_returns_source_backed_result() {
    let citations = (1..=6)
        .map(|index| format!("https://source-{index}.example.test/article"))
        .collect::<Vec<_>>();
    let unavailable_url = citations[1].clone();
    let fetched_urls = Arc::new(Mutex::new(Vec::new()));
    let source_ids = ["source-1", "source-3", "source-4", "source-5"];
    let provider = TestProvider {
        citations: citations.clone(),
        generation_response: json!({
            "sources": source_ids.iter().map(|source_id| json!({
                "source_id": source_id,
                "summary": "A source summary.",
                "key_points": [{
                    "text": "A supporting point.",
                    "quote": "This representative sentence provides enough detail for article extraction and quote validation."
                }]
            })).collect::<Vec<_>>()
        }),
        generation_calls: Arc::new(AtomicUsize::new(0)),
        search_prompts: Arc::new(Mutex::new(Vec::new())),
    };
    let generation_calls = provider.generation_calls.clone();
    let search_prompts = provider.search_prompts.clone();
    let app_state = test_app_state(
        provider,
        TestFetcher {
            unavailable_url,
            fetched_urls: fetched_urls.clone(),
        },
    );

    let response = run_research_job(
        State(app_state),
        crate::error::ApiJson(ResearchJobRequest::KeyPoints {
            question: "How does the example work?".to_owned(),
        }),
    )
    .await
    .unwrap()
    .into_response();
    let events = events(response).await;
    let searches = search_prompts
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();

    assert_eq!(
        json!({
            "search_prompts": searches,
            "generation_calls": generation_calls.load(Ordering::SeqCst),
            "fetched_urls": fetched_urls.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
            "events": events,
        }),
        json!({
            "search_prompts": ["Research question: How does the example work?"],
            "generation_calls": 1,
            "fetched_urls": citations.iter().take(5).cloned().collect::<Vec<_>>(),
            "events": [
                {"event": "progress", "data": {"query": "sample search query"}},
                {
                    "event": "result",
                    "data": {
                        "analysis": {
                            "task": "key_points",
                            "data": {
                                "sources": source_ids.iter().map(|source_id| json!({
                                    "id": source_id,
                                    "summary": "A source summary.",
                                    "key_points": [{"text": "A supporting point.", "quote": "This representative sentence provides enough detail for article extraction and quote validation."}]
                                })).collect::<Vec<_>>()
                            }
                        },
                        "sources": [
                            {
                                "id": "source-1", "url": citations[0], "final_url": citations[0],
                                "title": "Example research page",
                                "body": expected_source_body(),
                                "status": "available"
                            },
                            {
                                "id": "source-2", "url": citations[1], "final_url": null,
                                "title": null, "body": null, "status": "unavailable"
                            },
                            {
                                "id": "source-3", "url": citations[2], "final_url": citations[2],
                                "title": "Example research page",
                                "body": expected_source_body(),
                                "status": "available"
                            },
                            {
                                "id": "source-4", "url": citations[3], "final_url": citations[3],
                                "title": "Example research page",
                                "body": expected_source_body(),
                                "status": "available"
                            },
                            {
                                "id": "source-5", "url": citations[4], "final_url": citations[4],
                                "title": "Example research page",
                                "body": expected_source_body(),
                                "status": "available"
                            }
                        ]
                    }
                }
            ]
        })
    );
}

#[tokio::test]
async fn streams_claim_evidence_with_a_verified_quote() {
    let citation = "https://source.example.test/article".to_owned();
    let provider = TestProvider {
        citations: vec![citation.clone()],
        generation_response: json!({
            "verdict": "supported",
            "quote": {
                "source_id": "source-1",
                "text": "This representative sentence provides enough detail for article extraction and quote validation."
            },
            "suggestion": null
        }),
        generation_calls: Arc::new(AtomicUsize::new(0)),
        search_prompts: Arc::new(Mutex::new(Vec::new())),
    };
    let generation_calls = provider.generation_calls.clone();
    let search_prompts = provider.search_prompts.clone();
    let fetched_urls = Arc::new(Mutex::new(Vec::new()));
    let app_state = test_app_state(
        provider,
        TestFetcher {
            unavailable_url: String::new(),
            fetched_urls: fetched_urls.clone(),
        },
    );
    let response = run_research_job(
        State(app_state),
        crate::error::ApiJson(ResearchJobRequest::ClaimEvidence {
            claim: "The source supports this statement.".to_owned(),
            before: Some("The previous sentence adds context.".to_owned()),
            after: Some("The next sentence adds context.".to_owned()),
        }),
    )
    .await
    .unwrap()
    .into_response();
    let actual_events = events(response).await;

    assert_eq!(
        json!({
            "search_prompts": search_prompts.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
            "generation_calls": generation_calls.load(Ordering::SeqCst),
            "fetched_urls": fetched_urls.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
            "events": actual_events,
        }),
        json!({
            "search_prompts": [indoc! {"
                Find sources that can verify this claim:
                Previous sentence: The previous sentence adds context.
                Claim: The source supports this statement.
                Next sentence: The next sentence adds context.
            "}.trim_end().to_owned()],
            "generation_calls": 1,
            "fetched_urls": [citation],
            "events": [
                {"event": "progress", "data": {"query": "sample search query"}},
                {
                    "event": "result",
                    "data": {
                        "analysis": {
                            "task": "claim_evidence",
                            "data": {
                                "verdict": "supported",
                                "quote": {
                                    "source_id": "source-1",
                                    "text": "This representative sentence provides enough detail for article extraction and quote validation."
                                },
                                "suggestion": null
                            }
                        },
                        "sources": [{
                            "id": "source-1",
                            "url": citation,
                            "final_url": citation,
                            "title": "Example research page",
                            "body": expected_source_body(),
                            "status": "available"
                        }]
                    }
                }
            ]
        })
    );
}

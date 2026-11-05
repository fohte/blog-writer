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
    body::{Body, to_bytes},
    http::Request,
    response::Response,
};
use indoc::indoc;
use reqwest::Url;
use rstest::{fixture, rstest};
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tower::ServiceExt;

use crate::{
    app::AppState,
    config::ProviderName,
    llm::{LlmError, LlmProvider, LlmState, WebSearchResult},
    safe_fetch::{FetchResponse, SafeFetchError, SafeFetchFuture, SafeFetchService},
};

#[derive(Clone)]
struct TestProvider {
    citations: Vec<String>,
    generation_response: Value,
    generation_calls: Arc<AtomicUsize>,
    search_prompts: Arc<Mutex<Vec<String>>>,
    fail_search: bool,
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
        let fail_search = self.fail_search;
        Box::pin(async move {
            if fail_search {
                return Err(LlmError::Provider);
            }
            let _ = progress.send("sample search query".to_owned());
            tokio::task::yield_now().await;
            Ok(WebSearchResult {
                text: "The provider response mentions https://response-body.example.test/ignored"
                    .to_owned(),
                citations,
            })
        })
    }
}

struct TestFetcher {
    unavailable_url: Option<String>,
    fetched_urls: Arc<Mutex<Vec<String>>>,
}

impl SafeFetchService for TestFetcher {
    fn fetch<'a>(&'a self, url: &'a str) -> SafeFetchFuture<'a> {
        Box::pin(async move {
            self.fetched_urls
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(url.to_owned());
            if self.unavailable_url.as_deref() == Some(url) {
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

#[derive(Clone, Copy)]
struct TestAppStateBuilder;

impl TestAppStateBuilder {
    fn build(
        self,
        provider: TestProvider,
        fetched_urls: Arc<Mutex<Vec<String>>>,
        unavailable_url: Option<String>,
    ) -> AppState {
        AppState {
            llm: LlmState::with_provider(
                provider,
                ProviderName::ClaudeCode,
                Duration::from_secs(30),
            ),
            safe_fetch: Arc::new(TestFetcher {
                unavailable_url,
                fetched_urls,
            }),
            ..AppState::default()
        }
    }
}

#[fixture]
fn app_state_builder() -> TestAppStateBuilder {
    TestAppStateBuilder
}

#[fixture]
fn fetched_urls() -> Arc<Mutex<Vec<String>>> {
    Arc::new(Mutex::new(Vec::new()))
}

fn test_router(state: AppState) -> axum::Router {
    crate::app::llm_api_router(
        state,
        crate::host_origin::HostOriginPolicy::new(vec!["localhost:3000".to_owned()], Vec::new()),
    )
}

async fn post_job(state: AppState, payload: Value) -> Response {
    test_router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/research/jobs")
                .header("host", "localhost:3000")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn response_body(response: Response) -> (u16, String) {
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

fn sse_body(events: &[Value]) -> String {
    let mut body = String::new();
    for event in events {
        body.push_str("event: ");
        body.push_str(event["event"].as_str().unwrap());
        body.push('\n');
        body.push_str("data: ");
        body.push_str(&event.to_string());
        body.push('\n');
        body.push('\n');
    }
    body
}

fn test_provider(
    citations: Vec<String>,
    generation_response: Value,
    fail_search: bool,
) -> (TestProvider, Arc<AtomicUsize>, Arc<Mutex<Vec<String>>>) {
    let generation_calls = Arc::new(AtomicUsize::new(0));
    let search_prompts = Arc::new(Mutex::new(Vec::new()));
    (
        TestProvider {
            citations,
            generation_response,
            generation_calls: generation_calls.clone(),
            search_prompts: search_prompts.clone(),
            fail_search,
        },
        generation_calls,
        search_prompts,
    )
}

#[rstest]
#[tokio::test]
async fn streams_progress_and_returns_source_backed_result(
    app_state_builder: TestAppStateBuilder,
    fetched_urls: Arc<Mutex<Vec<String>>>,
) {
    let citations = (1..=6)
        .map(|index| format!("https://source-{index}.example.test/article"))
        .collect::<Vec<_>>();
    let source_ids = ["source-1", "source-3", "source-4", "source-5"];
    let provider_result = json!({
        "sources": source_ids.iter().map(|source_id| json!({
            "source_id": source_id,
            "summary": "A source summary.",
            "key_points": [{
                "text": "A supporting point.",
                "quote": "This representative sentence provides enough detail for article extraction and quote validation."
            }]
        })).collect::<Vec<_>>()
    });
    let (provider, generation_calls, search_prompts) =
        test_provider(citations.clone(), provider_result, false);
    let app_state =
        app_state_builder.build(provider, fetched_urls.clone(), Some(citations[1].clone()));
    let response = post_job(
        app_state,
        json!({"task": "key_points", "question": "How does the example work?"}),
    )
    .await;
    let actual = response_body(response).await;
    let expected_events = vec![
        json!({"event": "progress", "data": {"query": "sample search query"}}),
        json!({
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
                        "title": "Example research page", "body": expected_source_body(),
                        "status": "available"
                    },
                    {
                        "id": "source-2", "url": citations[1], "final_url": null,
                        "title": null, "body": null, "status": "unavailable"
                    },
                    {
                        "id": "source-3", "url": citations[2], "final_url": citations[2],
                        "title": "Example research page", "body": expected_source_body(),
                        "status": "available"
                    },
                    {
                        "id": "source-4", "url": citations[3], "final_url": citations[3],
                        "title": "Example research page", "body": expected_source_body(),
                        "status": "available"
                    },
                    {
                        "id": "source-5", "url": citations[4], "final_url": citations[4],
                        "title": "Example research page", "body": expected_source_body(),
                        "status": "available"
                    }
                ]
            }
        }),
    ];
    let actual_summary = json!({
        "status": actual.0,
        "search_prompts": search_prompts.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
        "generation_calls": generation_calls.load(Ordering::SeqCst),
        "fetched_urls": fetched_urls.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
        "body": actual.1,
    });
    let expected_summary = json!({
        "status": 200,
        "search_prompts": ["Research question: How does the example work?"],
        "generation_calls": 1,
        "fetched_urls": citations.iter().take(5).cloned().collect::<Vec<_>>(),
        "body": sse_body(&expected_events),
    });

    assert_eq!(actual_summary, expected_summary);
}

#[rstest]
#[tokio::test]
async fn streams_claim_evidence_with_a_verified_quote(
    app_state_builder: TestAppStateBuilder,
    fetched_urls: Arc<Mutex<Vec<String>>>,
) {
    let citation = "https://source.example.test/article".to_owned();
    let provider_result = json!({
        "verdict": "supported",
        "quote": {
            "source_id": "source-1",
            "text": "This representative sentence provides enough detail for article extraction and quote validation."
        },
        "suggestion": null
    });
    let (provider, generation_calls, search_prompts) =
        test_provider(vec![citation.clone()], provider_result, false);
    let app_state = app_state_builder.build(provider, fetched_urls.clone(), None);
    let response = post_job(
        app_state,
        json!({
            "task": "claim_evidence",
            "claim": "The source supports this statement.",
            "before": "The previous sentence adds context.",
            "after": "The next sentence adds context."
        }),
    )
    .await;
    let actual = response_body(response).await;
    let expected_events = vec![
        json!({"event": "progress", "data": {"query": "sample search query"}}),
        json!({
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
                    "id": "source-1", "url": citation, "final_url": citation,
                    "title": "Example research page", "body": expected_source_body(),
                    "status": "available"
                }]
            }
        }),
    ];
    let actual_summary = json!({
        "status": actual.0,
        "search_prompts": search_prompts.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
        "generation_calls": generation_calls.load(Ordering::SeqCst),
        "fetched_urls": fetched_urls.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
        "body": actual.1,
    });
    let expected_summary = json!({
        "status": 200,
        "search_prompts": [indoc! {"
            Find sources that can verify this claim:
            Previous sentence: The previous sentence adds context.
            Claim: The source supports this statement.
            Next sentence: The next sentence adds context.
        "}.trim_end().to_owned()],
        "generation_calls": 1,
        "fetched_urls": [citation],
        "body": sse_body(&expected_events),
    });

    assert_eq!(actual_summary, expected_summary);
}

#[rstest]
#[tokio::test]
async fn streams_provider_errors_as_sse_error_events(
    app_state_builder: TestAppStateBuilder,
    fetched_urls: Arc<Mutex<Vec<String>>>,
) {
    let (provider, generation_calls, search_prompts) = test_provider(Vec::new(), json!({}), true);
    let app_state = app_state_builder.build(provider, fetched_urls.clone(), None);
    let response = post_job(
        app_state,
        json!({"task": "key_points", "question": "How does the example work?"}),
    )
    .await;
    let actual = response_body(response).await;
    let expected_events = vec![json!({
        "event": "error",
        "data": {"message": "failed to start or communicate with the LLM provider"}
    })];

    assert_eq!(
        json!({
            "status": actual.0,
            "search_prompts": search_prompts.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
            "generation_calls": generation_calls.load(Ordering::SeqCst),
            "fetched_urls": fetched_urls.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
            "body": actual.1,
        }),
        json!({
            "status": 200,
            "search_prompts": ["Research question: How does the example work?"],
            "generation_calls": 0,
            "fetched_urls": [],
            "body": sse_body(&expected_events),
        })
    );
}

#[rstest]
#[tokio::test]
async fn returns_empty_analysis_without_generating_when_no_source_is_available(
    app_state_builder: TestAppStateBuilder,
    fetched_urls: Arc<Mutex<Vec<String>>>,
) {
    let (provider, generation_calls, search_prompts) = test_provider(Vec::new(), json!({}), false);
    let app_state = app_state_builder.build(provider, fetched_urls.clone(), None);
    let response = post_job(
        app_state,
        json!({
            "task": "claim_evidence",
            "claim": "The source supports this statement."
        }),
    )
    .await;
    let actual = response_body(response).await;
    let expected_events = vec![json!({
        "event": "result",
        "data": {
            "analysis": {
                "task": "claim_evidence",
                "data": {"verdict": "insufficient", "quote": null, "suggestion": null}
                },
            "sources": []
        }
    })];

    assert_eq!(
        json!({
            "status": actual.0,
            "search_prompts": search_prompts.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
            "generation_calls": generation_calls.load(Ordering::SeqCst),
            "fetched_urls": fetched_urls.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
            "body": actual.1,
        }),
        json!({
            "status": 200,
            "search_prompts": [indoc! {"
                Find sources that can verify this claim:
                Claim: The source supports this statement.
            "}.trim_end().to_owned()],
            "generation_calls": 0,
            "fetched_urls": [],
            "body": sse_body(&expected_events),
        })
    );
}

#[rstest]
#[case::blank_question(json!({"task": "key_points", "question": "  "} ))]
#[case::blank_claim(json!({"task": "claim_evidence", "claim": "  "} ))]
#[tokio::test]
async fn rejects_blank_research_requests(
    #[case] payload: Value,
    app_state_builder: TestAppStateBuilder,
    fetched_urls: Arc<Mutex<Vec<String>>>,
) {
    let (provider, _, _) = test_provider(Vec::new(), json!({}), false);
    let response = post_job(
        app_state_builder.build(provider, fetched_urls, None),
        payload,
    )
    .await;
    let actual = response_body(response).await;

    assert_eq!(
        actual,
        (
            400,
            "{\"error\":\"Question or claim must not be empty\"}".to_owned()
        )
    );
}

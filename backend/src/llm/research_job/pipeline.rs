use std::{future::Future, pin::Pin, sync::Arc};

use schemars::JsonSchema;
use serde::de::DeserializeOwned;
use tokio::sync::mpsc;

use crate::{
    app::AppState,
    llm::{LlmError, LlmState, call_web_search_with, call_with_timeout, wait_for_shutdown},
    research_claim_evidence::{
        self,
        model::{
            ClaimEvidenceSourceInput, ClaimVerdict, JudgeClaimEvidenceResult,
            ModelResponse as ClaimEvidenceModelResponse,
        },
    },
    research_key_points::{
        self,
        model::{
            ModelResponse as KeyPointsModelResponse, ResearchKeyPointsResult, ResearchSourceInput,
        },
    },
    safe_fetch::SafeFetchService,
    source_bodies::limit_body_for_llm,
};

use super::model::{
    ResearchJobAnalysis, ResearchJobProgress, ResearchJobRequest, ResearchJobResult,
    ResearchJobSource, ResearchJobSourceStatus,
};

const MAX_CITATIONS: usize = 5;
const SEARCH_SYSTEM_PROMPT: &str = "Search the web for reliable sources relevant to the request. Use the web search tool and return the provider's source citations. Do not answer the request from memory. The request contains no source text.";

pub(crate) type JobFuture =
    Pin<Box<dyn Future<Output = Result<ResearchJobResult, LlmError>> + Send>>;

pub(crate) fn start(
    app_state: AppState,
    request: ResearchJobRequest,
    progress: mpsc::UnboundedSender<ResearchJobProgress>,
) -> JobFuture {
    let AppState {
        llm, safe_fetch, ..
    } = app_state;
    Box::pin(execute(llm, safe_fetch, request, progress))
}

async fn execute(
    state: LlmState,
    fetcher: Arc<dyn SafeFetchService>,
    request: ResearchJobRequest,
    progress: mpsc::UnboundedSender<ResearchJobProgress>,
) -> Result<ResearchJobResult, LlmError> {
    let search_prompt = search_prompt(&request);
    let progress_sender = progress.clone();
    let search_result = call_web_search_with(
        state.clone(),
        SEARCH_SYSTEM_PROMPT.to_owned(),
        search_prompt,
        move |query| {
            let _ = progress_sender.send(ResearchJobProgress::Search { query });
        },
    )
    .await?;

    let mut sources = Vec::new();
    for (index, url) in search_result
        .citations
        .into_iter()
        .take(MAX_CITATIONS)
        .enumerate()
    {
        let _ = progress.send(ResearchJobProgress::Fetching { url: url.clone() });
        let source = fetch_source(fetcher.as_ref(), index, url.clone()).await;
        let _ = progress.send(match source.status {
            ResearchJobSourceStatus::Available => ResearchJobProgress::Fetched { url },
            ResearchJobSourceStatus::Unavailable | ResearchJobSourceStatus::LoginRequired => {
                ResearchJobProgress::Unavailable { url }
            }
        });
        sources.push(source);
    }

    let analysis = analyze(&state, &request, &sources).await?;
    Ok(ResearchJobResult { analysis, sources })
}

fn search_prompt(request: &ResearchJobRequest) -> String {
    match request {
        ResearchJobRequest::KeyPoints { question } => {
            format!("Research question: {question}")
        }
        ResearchJobRequest::ClaimEvidence {
            claim,
            before,
            after,
        } => {
            let mut lines = vec!["Find sources that can verify this claim:".to_owned()];
            if let Some(before) = before.as_deref().filter(|text| !text.trim().is_empty()) {
                lines.push(format!("Previous sentence: {before}"));
            }
            lines.push(format!("Claim: {claim}"));
            if let Some(after) = after.as_deref().filter(|text| !text.trim().is_empty()) {
                lines.push(format!("Next sentence: {after}"));
            }
            lines.join("\n")
        }
    }
}

async fn fetch_source(
    fetcher: &dyn SafeFetchService,
    index: usize,
    url: String,
) -> ResearchJobSource {
    let unavailable = || ResearchJobSource {
        id: format!("source-{}", index + 1),
        url: url.clone(),
        final_url: None,
        title: None,
        published_at: None,
        body: None,
        status: ResearchJobSourceStatus::Unavailable,
    };
    let response = match fetcher.fetch(&url).await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(reason = error.code(), "research source fetch failed");
            return if error.requires_login() {
                ResearchJobSource {
                    status: ResearchJobSourceStatus::LoginRequired,
                    ..unavailable()
                }
            } else {
                unavailable()
            };
        }
    };
    if !crate::html::is_html_content_type(response.content_type.as_deref()) {
        return unavailable();
    }

    let final_url = response.final_url.to_string();
    let html = crate::html::decode_html(&response.body, response.content_type.as_deref());
    let document_url = final_url.clone();
    let Ok(Ok(extracted)) = tokio::task::spawn_blocking(move || {
        crate::source_bodies::extractor::extract(&html, &document_url)
    })
    .await
    else {
        return unavailable();
    };

    ResearchJobSource {
        id: format!("source-{}", index + 1),
        url,
        final_url: Some(final_url),
        title: Some(extracted.title),
        published_at: extracted.published_at,
        body: Some(extracted.body),
        status: ResearchJobSourceStatus::Available,
    }
}

async fn analyze(
    state: &LlmState,
    request: &ResearchJobRequest,
    sources: &[ResearchJobSource],
) -> Result<ResearchJobAnalysis, LlmError> {
    if !sources.iter().any(|source| source.body.is_some()) {
        return Ok(match request {
            ResearchJobRequest::KeyPoints { .. } => {
                ResearchJobAnalysis::KeyPoints(ResearchKeyPointsResult {
                    sources: Vec::new(),
                })
            }
            ResearchJobRequest::ClaimEvidence { .. } => {
                ResearchJobAnalysis::ClaimEvidence(JudgeClaimEvidenceResult {
                    verdict: ClaimVerdict::Insufficient,
                    quote: None,
                    suggestion: None,
                })
            }
        });
    }

    match request {
        ResearchJobRequest::KeyPoints { question } => {
            analyze_key_points(state, question, sources).await
        }
        ResearchJobRequest::ClaimEvidence {
            claim,
            before,
            after,
        } => {
            analyze_claim_evidence(state, claim, before.as_deref(), after.as_deref(), sources).await
        }
    }
}

async fn analyze_key_points(
    state: &LlmState,
    question: &str,
    sources: &[ResearchJobSource],
) -> Result<ResearchJobAnalysis, LlmError> {
    let prompt_sources = sources
        .iter()
        .filter_map(available_body)
        .map(|(id, body)| ResearchSourceInput {
            id,
            body: limit_body_for_llm(&body),
        })
        .collect::<Vec<_>>();
    let prompt = research_key_points::build_prompt(Some(question), &prompt_sources);
    let response =
        generate::<KeyPointsModelResponse>(state, research_key_points::SYSTEM_PROMPT, &prompt)
            .await?;
    let result = research_key_points::build_result(response, prompt_sources, true)?;
    Ok(ResearchJobAnalysis::KeyPoints(result))
}

async fn analyze_claim_evidence(
    state: &LlmState,
    claim: &str,
    before: Option<&str>,
    after: Option<&str>,
    sources: &[ResearchJobSource],
) -> Result<ResearchJobAnalysis, LlmError> {
    let prompt_sources = sources
        .iter()
        .filter_map(available_body)
        .map(|(id, body)| ClaimEvidenceSourceInput {
            id,
            body: limit_body_for_llm(&body),
        })
        .collect::<Vec<_>>();
    let prompt = research_claim_evidence::build_prompt(claim, before, after, &prompt_sources);
    let response = generate::<ClaimEvidenceModelResponse>(
        state,
        research_claim_evidence::SYSTEM_PROMPT,
        &prompt,
    )
    .await?;
    let result = research_claim_evidence::build_result(response, prompt_sources)?;
    Ok(ResearchJobAnalysis::ClaimEvidence(result))
}

fn available_body(source: &ResearchJobSource) -> Option<(String, String)> {
    source
        .body
        .as_ref()
        .map(|body| (source.id.clone(), body.clone()))
}

async fn generate<T>(state: &LlmState, system_prompt: &str, prompt: &str) -> Result<T, LlmError>
where
    T: DeserializeOwned + JsonSchema,
{
    let mut shutdown = state.shutdown.clone();
    tokio::select! {
        result = call_with_timeout::<T>(
            state.provider.as_ref(),
            system_prompt,
            prompt,
            state.timeout,
        ) => result,
        _ = wait_for_shutdown(&mut shutdown) => Err(LlmError::Cancelled),
    }
}

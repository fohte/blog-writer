use std::collections::HashSet;

use axum::{extract::State, response::sse::Sse};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    error::{ApiJson, AppError, ErrorResponse},
    llm::{LlmState, call_to_sse_map},
    llm_context::{
        ArticleBlock, ArticlePremise, BlockScope, ContextInput, HEADING_BLOCK_KIND, ReferencePoint,
        ReferenceSource, SYSTEM_PROMPT, assemble,
    },
};

const MAX_KEY_POINTS: usize = 50;

fn push_prompt_line(prompt: &mut String, line: &str) {
    prompt.push_str(line);
    prompt.push('\n');
}

#[derive(Debug, Deserialize, Serialize, JsonSchema, ToSchema)]
pub(crate) struct WriteFromKeyPointsRequest {
    pub premise: ArticlePremiseRequest,
    pub target_heading_id: String,
    pub blocks: Vec<ArticleBlockRequest>,
    pub sources: Vec<ReferenceSourceRequest>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema, ToSchema)]
pub(crate) struct ArticlePremiseRequest {
    pub audience: String,
    pub purpose: String,
    pub thesis: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema, ToSchema)]
pub(crate) struct ArticleBlockRequest {
    pub id: String,
    pub kind: String,
    pub markdown: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema, ToSchema)]
pub(crate) struct ReferenceSourceRequest {
    pub title: String,
    pub url: String,
    pub fetched_at: String,
    pub summary: String,
    pub key_points: Vec<ReferencePointRequest>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ToSchema)]
pub(crate) struct ReferencePointRequest {
    pub id: String,
    pub researched_heading_id: String,
    pub text: String,
    pub quote: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct GeneratedDraft {
    sentences: Vec<GeneratedSentence>,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct GeneratedSentence {
    text: String,
    is_factual: bool,
    key_point_aliases: Vec<String>,
}

#[derive(Debug, Serialize, JsonSchema, ToSchema, PartialEq, Eq)]
pub(crate) struct WriteFromKeyPointsResponse {
    pub sentences: Vec<WrittenSentence>,
}

#[derive(Debug, Serialize, JsonSchema, ToSchema, PartialEq, Eq)]
pub(crate) struct WrittenSentence {
    pub text: String,
    pub is_factual: bool,
    pub key_point_ids: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
#[expect(
    dead_code,
    reason = "This type documents the use-case SSE schema in OpenAPI"
)]
pub(crate) enum WriteFromKeyPointsEvent {
    Result(WriteFromKeyPointsResponse),
    Error(WriteFromKeyPointsError),
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct WriteFromKeyPointsError {
    pub message: String,
}

#[utoipa::path(
    post,
    path = "/write-from-key-points",
    operation_id = "write_from_key_points",
    request_body = WriteFromKeyPointsRequest,
    responses(
        (status = 200, description = "Generated sentences with key point citations", content_type = "text/event-stream", body = WriteFromKeyPointsEvent),
        (status = 400, description = "Invalid request body or target heading", body = ErrorResponse)
    )
)]
pub(crate) async fn write_from_key_points(
    State(state): State<LlmState>,
    ApiJson(request): ApiJson<WriteFromKeyPointsRequest>,
) -> Result<
    Sse<
        impl futures_util::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>,
    >,
    AppError,
> {
    let heading = request
        .blocks
        .iter()
        .find(|block| block.id == request.target_heading_id && block.kind == HEADING_BLOCK_KIND)
        .map(|block| block.markdown.clone())
        .ok_or_else(target_heading_not_found)?;

    let target_block_ids = target_section_block_ids(&request.blocks, &request.target_heading_id);
    let key_points = prioritize_key_points(&request.sources, &request.target_heading_id);
    let sources = ordered_sources(&request.sources, key_points, &request.blocks);
    let context = assemble(ContextInput {
        premise: ArticlePremise {
            audience: request.premise.audience,
            purpose: request.premise.purpose,
            thesis: request.premise.thesis,
        },
        blocks: request
            .blocks
            .into_iter()
            .map(|block| ArticleBlock {
                id: block.id,
                kind: block.kind,
                markdown: block.markdown,
            })
            .collect(),
        target_block_ids,
        block_scope: BlockScope::AroundTargets {
            before: 0,
            after: 0,
        },
        sources,
    })
    .map_err(|_| target_heading_not_found())?;

    let mut prompt = context.prompt;
    prompt.push('\n');
    push_prompt_line(&mut prompt, "執筆指示");
    push_prompt_line(
        &mut prompt,
        &format!("「{heading}」の下に置く文を書いてください。"),
    );
    push_prompt_line(
        &mut prompt,
        "文を分けて返し、各文が事実を述べるなら is_factual を true にしてください。",
    );
    push_prompt_line(
        &mut prompt,
        "参考要点に基づく事実の文では、根拠にした要点の別名を key_point_aliases に列挙してください。",
    );
    push_prompt_line(
        &mut prompt,
        "つなぎや意見の文は is_factual を false にし、key_point_aliases は空にしてください。",
    );

    let aliases = context.point_aliases;
    Ok(
        call_to_sse_map::<GeneratedDraft, WriteFromKeyPointsResponse>(
            state,
            SYSTEM_PROMPT.to_owned(),
            prompt,
            move |generated| WriteFromKeyPointsResponse {
                sentences: generated
                    .sentences
                    .into_iter()
                    .map(|sentence| {
                        let mut seen = HashSet::new();
                        let key_point_ids = sentence
                            .key_point_aliases
                            .into_iter()
                            .filter_map(|alias| aliases.get(&alias).cloned())
                            .filter(|id| seen.insert(id.clone()))
                            .collect();
                        WrittenSentence {
                            text: sentence.text,
                            is_factual: sentence.is_factual,
                            key_point_ids,
                        }
                    })
                    .collect(),
            },
        ),
    )
}

fn target_heading_not_found() -> AppError {
    AppError::Client {
        status: axum::http::StatusCode::BAD_REQUEST,
        message: "Target heading does not exist".to_owned(),
    }
}

fn target_section_block_ids(
    blocks: &[ArticleBlockRequest],
    target_heading_id: &str,
) -> Vec<String> {
    let Some(heading_index) = blocks
        .iter()
        .position(|block| block.id == target_heading_id && block.kind == HEADING_BLOCK_KIND)
    else {
        return Vec::new();
    };
    let section_ids: Vec<_> = blocks[heading_index + 1..]
        .iter()
        .take_while(|block| block.kind != HEADING_BLOCK_KIND)
        .map(|block| block.id.clone())
        .collect();
    if section_ids.is_empty() {
        vec![target_heading_id.to_owned()]
    } else {
        section_ids
    }
}

struct SelectedPoint {
    source_index: usize,
    point_index: usize,
    point: ReferencePointRequest,
}

fn prioritize_key_points(
    sources: &[ReferenceSourceRequest],
    target_heading_id: &str,
) -> Vec<SelectedPoint> {
    let mut target_points = Vec::new();
    let mut other_points = Vec::new();
    for (source_index, source) in sources.iter().enumerate() {
        for (point_index, point) in source.key_points.iter().enumerate() {
            let selected = SelectedPoint {
                source_index,
                point_index,
                point: point.clone(),
            };
            if point.researched_heading_id == target_heading_id {
                target_points.push(selected);
            } else {
                other_points.push(selected);
            }
        }
    }
    target_points.extend(other_points);
    target_points.truncate(MAX_KEY_POINTS);
    target_points
}

fn ordered_sources(
    sources: &[ReferenceSourceRequest],
    points: Vec<SelectedPoint>,
    blocks: &[ArticleBlockRequest],
) -> Vec<ReferenceSource> {
    let headings: std::collections::HashMap<_, _> = blocks
        .iter()
        .filter(|block| block.kind == HEADING_BLOCK_KIND)
        .map(|block| (block.id.as_str(), block.markdown.as_str()))
        .collect();
    let mut points_by_source = std::collections::BTreeMap::<usize, Vec<SelectedPoint>>::new();
    for selected in points {
        points_by_source
            .entry(selected.source_index)
            .or_default()
            .push(selected);
    }
    points_by_source
        .into_iter()
        .map(|(source_index, mut selected_points)| {
            selected_points.sort_by_key(|selected| selected.point_index);
            let source = &sources[source_index];
            ReferenceSource {
                title: Some(source.title.clone()),
                url: Some(source.url.clone()),
                summary: source.summary.clone(),
                checked_at: source.fetched_at.clone(),
                key_points: selected_points
                    .into_iter()
                    .map(|selected| ReferencePoint {
                        id: selected.point.id,
                        heading: Some(
                            headings
                                .get(selected.point.researched_heading_id.as_str())
                                .copied()
                                .unwrap_or(&selected.point.researched_heading_id)
                                .to_owned(),
                        ),
                        text: selected.point.text,
                        quote: selected.point.quote,
                    })
                    .collect(),
            }
        })
        .collect()
}

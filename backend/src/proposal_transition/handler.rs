use axum::{extract::State, response::sse::Sse};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    error::{ApiJson, AppError, ErrorResponse},
    llm::{LlmState, call_to_sse_with},
    llm_context::{
        ArticleBlock, ArticlePremise, BlockScope, ContextInput, SYSTEM_PROMPT, assemble,
    },
};

#[derive(Debug, Deserialize, JsonSchema, ToSchema)]
pub(crate) struct TransitionRequest {
    pub premise: TransitionPremise,
    pub blocks: Vec<TransitionBlock>,
    pub seams: Vec<TransitionSeam>,
}

#[derive(Debug, Deserialize, JsonSchema, ToSchema)]
pub(crate) struct TransitionPremise {
    pub audience: String,
    pub purpose: String,
    pub thesis: String,
}

#[derive(Debug, Deserialize, JsonSchema, ToSchema)]
pub(crate) struct TransitionBlock {
    pub id: String,
    pub kind: String,
    pub markdown: String,
}

#[derive(Debug, Deserialize, JsonSchema, ToSchema)]
pub(crate) struct TransitionSeam {
    pub id: String,
    pub from: usize,
    pub to: usize,
    pub before_sentence: String,
    pub middle: String,
    pub after_sentence: String,
    pub before_block_id: String,
    pub after_block_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct GeneratedTransitions {
    replacements: Vec<Option<GeneratedSentencePair>>,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct GeneratedSentencePair {
    before: String,
    after: String,
}

#[derive(Debug, Serialize, JsonSchema, ToSchema, PartialEq, Eq)]
pub(crate) struct TransitionResponse {
    pub suggestions: Vec<TransitionSuggestion>,
}

#[derive(Debug, Serialize, JsonSchema, ToSchema, PartialEq, Eq)]
pub(crate) struct TransitionSuggestion {
    pub seam_id: String,
    pub from: usize,
    pub to: usize,
    pub replacement: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
#[expect(
    dead_code,
    reason = "This type documents the use-case SSE schema in OpenAPI"
)]
pub(crate) enum TransitionEvent {
    Result(TransitionResponse),
    Error(TransitionError),
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct TransitionError {
    pub message: String,
}

#[utoipa::path(
    post,
    path = "/proposals/transition",
    operation_id = "propose_transition",
    request_body = TransitionRequest,
    responses(
        (status = 200, description = "Transition sentence suggestions", content_type = "text/event-stream", body = TransitionEvent),
        (status = 400, description = "Invalid request body or target block", body = ErrorResponse)
    )
)]
pub(crate) async fn propose_transition(
    State(state): State<LlmState>,
    ApiJson(request): ApiJson<TransitionRequest>,
) -> Result<
    Sse<
        impl futures_util::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>,
    >,
    AppError,
> {
    let target_block_ids = request
        .seams
        .iter()
        .flat_map(|seam| [seam.before_block_id.clone(), seam.after_block_id.clone()])
        .collect::<Vec<_>>();
    let context = assemble(ContextInput {
        premise: ArticlePremise {
            audience: request.premise.audience,
            purpose: request.premise.purpose,
            thesis: request.premise.thesis,
        },
        blocks: request
            .blocks
            .iter()
            .map(|block| ArticleBlock {
                id: block.id.clone(),
                kind: block.kind.clone(),
                markdown: block.markdown.clone(),
            })
            .collect(),
        target_block_ids,
        block_scope: BlockScope::AroundTargets {
            before: 1,
            after: 1,
        },
        sources: vec![],
    })
    .map_err(|error| invalid_target(error.to_string()))?;

    let mut prompt = context.prompt;
    prompt.push('\n');
    prompt.push_str("継ぎ目ごとの文章調整");
    prompt.push('\n');
    prompt.push_str(
        "各継ぎ目について、前後の文脈と記事の前提を読み、つながりを直す必要がある場合だけ前後 1 文を含む置換文を返してください。",
    );
    prompt.push('\n');
    prompt.push_str("replacements は継ぎ目一覧と同じ順で返し、変更不要なら null にしてください。");
    prompt.push('\n');
    prompt.push_str("各置換は前後の文だけを before と after に返してください。前置きや理由は書かず、置換後の文だけを返してください。");
    prompt.push('\n');
    prompt.push_str("継ぎ目一覧");
    prompt.push('\n');
    for seam in &request.seams {
        prompt.push('\n');
        prompt.push('[');
        prompt.push_str(&seam.id);
        prompt.push(']');
        prompt.push('\n');
        prompt.push_str("前後の文の間にある保持対象 Markdown:");
        prompt.push('\n');
        prompt.push_str(&seam.middle);
        prompt.push('\n');
        prompt.push_str("置換対象の前の文:");
        prompt.push('\n');
        prompt.push_str(&seam.before_sentence);
        prompt.push('\n');
        prompt.push_str("置換対象の後の文:");
        prompt.push('\n');
        prompt.push_str(&seam.after_sentence);
        prompt.push('\n');
    }

    let seams = request.seams;

    Ok(call_to_sse_with::<
        GeneratedTransitions,
        TransitionResponse,
        _,
    >(
        state,
        SYSTEM_PROMPT.to_owned(),
        prompt,
        move |generated| {
            let suggestions = seams
                .into_iter()
                .zip(generated.replacements)
                .filter_map(|(seam, replacement)| {
                    let replacement = replacement?;
                    if replacement.before.trim().is_empty() || replacement.after.trim().is_empty() {
                        return None;
                    }
                    let original = format!(
                        "{}{}{}",
                        seam.before_sentence, seam.middle, seam.after_sentence
                    );
                    let replacement =
                        format!("{}{}{}", replacement.before, seam.middle, replacement.after);
                    (replacement != original).then_some(TransitionSuggestion {
                        seam_id: seam.id,
                        from: seam.from,
                        to: seam.to,
                        replacement,
                    })
                })
                .collect();
            Ok(TransitionResponse { suggestions })
        },
    ))
}

fn invalid_target(message: String) -> AppError {
    AppError::Client {
        status: axum::http::StatusCode::BAD_REQUEST,
        message,
    }
}

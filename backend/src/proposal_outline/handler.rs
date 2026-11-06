use std::collections::BTreeMap;

use axum::{extract::State, response::sse::Sse};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    error::{ApiJson, AppError, ErrorResponse},
    llm::{LlmState, call_to_sse_with},
    llm_context::{
        ArticleBlock, ArticlePremise, BlockScope, ContextInput, ReferenceSource, SYSTEM_PROMPT,
        assemble,
    },
};

fn push_prompt_line(prompt: &mut String, line: &str) {
    prompt.push_str(line);
    prompt.push('\n');
}

#[derive(Debug, Deserialize, Serialize, JsonSchema, ToSchema)]
pub(crate) struct OutlineProposalRequest {
    pub premise: OutlineProposalPremiseRequest,
    pub body_length: usize,
    pub blocks: Vec<OutlineProposalArticleBlockRequest>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema, ToSchema)]
pub(crate) struct OutlineProposalPremiseRequest {
    pub audience: String,
    pub purpose: String,
    pub thesis: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema, ToSchema)]
pub(crate) struct OutlineProposalArticleBlockRequest {
    pub id: String,
    pub kind: String,
    pub markdown: String,
    pub from: usize,
    pub to: usize,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct GeneratedOutline {
    operations: Vec<GeneratedOperation>,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct GeneratedOperation {
    operation: OperationKind,
    block_alias: String,
    replacement: String,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
enum OperationKind {
    Add,
    Rename,
    Delete,
}

#[derive(Debug, Serialize, JsonSchema, ToSchema, PartialEq, Eq)]
pub(crate) struct OutlineProposalResponse {
    pub suggestions: Vec<OutlineSuggestion>,
}

#[derive(Debug, Serialize, JsonSchema, ToSchema, PartialEq, Eq)]
pub(crate) struct OutlineSuggestion {
    pub from: usize,
    pub to: usize,
    pub replacement: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
#[expect(
    dead_code,
    reason = "Documents the outline proposal SSE schema in OpenAPI"
)]
pub(crate) enum OutlineProposalEvent {
    Result(OutlineProposalResponse),
    Error(OutlineProposalError),
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct OutlineProposalError {
    pub message: String,
}

fn is_heading_line(value: &str) -> Option<usize> {
    let heading = value.strip_suffix('\n').unwrap_or(value);
    if heading.is_empty() || heading.contains('\r') || heading.contains('\n') {
        return None;
    }
    let level = heading
        .chars()
        .take_while(|character| *character == '#')
        .count();
    (1..=6)
        .contains(&level)
        .then_some(level)
        .filter(|level| heading.chars().nth(*level).is_some_and(char::is_whitespace))
}

fn to_suggestions(
    generated: GeneratedOutline,
    aliases: &BTreeMap<String, String>,
    blocks: &[OutlineProposalArticleBlockRequest],
    body_length: usize,
) -> OutlineProposalResponse {
    let blocks_by_id: BTreeMap<&str, &OutlineProposalArticleBlockRequest> = blocks
        .iter()
        .map(|block| (block.id.as_str(), block))
        .collect();
    let mut suggestions = Vec::new();

    for operation in generated.operations {
        let Some(block_id) = aliases.get(&operation.block_alias) else {
            continue;
        };
        let Some(block) = blocks_by_id.get(block_id.as_str()) else {
            continue;
        };
        if block.from > block.to || block.to > body_length {
            continue;
        }

        let suggestion = match operation.operation {
            OperationKind::Add if block.kind == "paragraph" => {
                if !operation.replacement.ends_with('\n')
                    || is_heading_line(&operation.replacement).is_none()
                {
                    continue;
                }
                OutlineSuggestion {
                    from: block.from,
                    to: block.from,
                    replacement: operation.replacement,
                }
            }
            OperationKind::Rename if block.kind == "heading" => {
                if operation.replacement.ends_with('\n') {
                    continue;
                }
                let Some(previous_level) = is_heading_line(&block.markdown) else {
                    continue;
                };
                let Some(replacement_level) = is_heading_line(&operation.replacement) else {
                    continue;
                };
                if replacement_level != previous_level {
                    continue;
                }
                OutlineSuggestion {
                    from: block.from,
                    to: block.to,
                    replacement: operation.replacement,
                }
            }
            OperationKind::Delete if block.kind == "heading" => {
                if is_heading_line(&block.markdown).is_none() || !operation.replacement.is_empty() {
                    continue;
                }
                OutlineSuggestion {
                    from: block.from,
                    to: block.to,
                    replacement: String::new(),
                }
            }
            _ => continue,
        };

        if suggestions.iter().any(|existing: &OutlineSuggestion| {
            (suggestion.from == suggestion.to
                && existing.from <= suggestion.from
                && suggestion.from < existing.to)
                || (existing.from == existing.to
                    && suggestion.from <= existing.from
                    && existing.from < suggestion.to)
                || (suggestion.from < existing.to && existing.from < suggestion.to)
                || (suggestion.from == existing.from && suggestion.to == existing.to)
        }) {
            continue;
        }
        suggestions.push(suggestion);
    }

    OutlineProposalResponse { suggestions }
}

#[utoipa::path(
    post,
    path = "/proposals/outline",
    operation_id = "propose_outline",
    request_body = OutlineProposalRequest,
    responses(
        (status = 200, description = "Outline changes proposed as text replacements", content_type = "text/event-stream", body = OutlineProposalEvent),
        (status = 400, description = "Invalid request body", body = ErrorResponse)
    )
)]
pub(crate) async fn propose_outline(
    State(state): State<LlmState>,
    ApiJson(request): ApiJson<OutlineProposalRequest>,
) -> Result<
    Sse<
        impl futures_util::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>,
    >,
    AppError,
> {
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
        target_block_ids: Vec::new(),
        block_scope: BlockScope::FullArticle,
        sources: Vec::<ReferenceSource>::new(),
    })
    .map_err(|_| AppError::Client {
        status: axum::http::StatusCode::BAD_REQUEST,
        message: "Invalid article context".to_owned(),
    })?;

    let mut prompt = context.prompt;
    prompt.push('\n');
    push_prompt_line(
        &mut prompt,
        "記事の構成を控えめに見直してください。見出しの追加、改名、削除だけを提案し、本文の内容や順序は変更しないでください。",
    );
    push_prompt_line(
        &mut prompt,
        "追加は、見出しの無い段落の前にだけ行い、その段落の別名を block_alias に指定してください。",
    );
    push_prompt_line(
        &mut prompt,
        "改名と削除は、対象見出しの別名を指定してください。移動や階層変更は提案しないでください。",
    );
    push_prompt_line(
        &mut prompt,
        "追加の replacement は見出し行の後に改行を 1 つ含めてください。改名は見出し行 1 行だけにし、既存の # の数を保ってください。削除では replacement を空文字列にしてください。",
    );
    push_prompt_line(
        &mut prompt,
        "不要な変更は返さず、提案する操作ごとに operation (add, rename, delete), block_alias, replacement だけを返してください。",
    );

    let aliases = context.block_aliases;
    let blocks = request.blocks;
    let body_length = request.body_length;
    Ok(call_to_sse_with::<
        GeneratedOutline,
        OutlineProposalResponse,
        _,
    >(
        state,
        SYSTEM_PROMPT.to_owned(),
        prompt,
        move |generated| Ok(to_suggestions(generated, &aliases, &blocks, body_length)),
    ))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use rstest::rstest;

    use super::{
        GeneratedOperation, GeneratedOutline, OperationKind, OutlineProposalArticleBlockRequest,
        OutlineProposalResponse, OutlineSuggestion, to_suggestions,
    };

    #[rstest]
    #[case::valid_and_invalid_operations(
        vec![
            GeneratedOperation { operation: OperationKind::Rename, block_alias: "b1".to_owned(), replacement: "# Updated".to_owned() },
            GeneratedOperation { operation: OperationKind::Add, block_alias: "b2".to_owned(), replacement: "## Added\n".to_owned() },
            GeneratedOperation { operation: OperationKind::Delete, block_alias: "b3".to_owned(), replacement: String::new() },
            GeneratedOperation { operation: OperationKind::Rename, block_alias: "missing".to_owned(), replacement: "# Missing".to_owned() },
            GeneratedOperation { operation: OperationKind::Add, block_alias: "b1".to_owned(), replacement: "## Wrong target".to_owned() },
            GeneratedOperation { operation: OperationKind::Rename, block_alias: "b1".to_owned(), replacement: "## Wrong level".to_owned() },
            GeneratedOperation { operation: OperationKind::Add, block_alias: "b2".to_owned(), replacement: "## Multiple\nlines".to_owned() },
            GeneratedOperation { operation: OperationKind::Delete, block_alias: "b3".to_owned(), replacement: "## Not empty".to_owned() },
            GeneratedOperation { operation: OperationKind::Rename, block_alias: "b4".to_owned(), replacement: "# Not a heading".to_owned() },
        ],
        45,
        OutlineProposalResponse {
            suggestions: vec![
                OutlineSuggestion { from: 0, to: 10, replacement: "# Updated".to_owned() },
                OutlineSuggestion { from: 12, to: 12, replacement: "## Added\n".to_owned() },
                OutlineSuggestion { from: 34, to: 44, replacement: String::new() },
            ],
        }
    )]
    #[case::drops_out_of_bounds_ranges(
        vec![GeneratedOperation { operation: OperationKind::Add, block_alias: "b2".to_owned(), replacement: "## Added\n".to_owned() }],
        11,
        OutlineProposalResponse { suggestions: Vec::new() }
    )]
    fn translates_only_valid_operations(
        #[case] operations: Vec<GeneratedOperation>,
        #[case] body_length: usize,
        #[case] expected: OutlineProposalResponse,
    ) {
        let aliases = BTreeMap::from([
            ("b1".to_owned(), "heading-a".to_owned()),
            ("b2".to_owned(), "paragraph-a".to_owned()),
            ("b3".to_owned(), "heading-b".to_owned()),
            ("b4".to_owned(), "paragraph-b".to_owned()),
        ]);
        let blocks = vec![
            block("heading-a", "heading", "# Original", 0, 10),
            block("paragraph-a", "paragraph", "An introduction.", 12, 28),
            block("heading-b", "heading", "## Removed", 34, 44),
            block("paragraph-b", "paragraph", "Details.", 46, 54),
        ];

        let actual = to_suggestions(
            GeneratedOutline { operations },
            &aliases,
            &blocks,
            body_length,
        );

        assert_eq!(actual, expected);
    }

    fn block(
        id: &str,
        kind: &str,
        markdown: &str,
        from: usize,
        to: usize,
    ) -> OutlineProposalArticleBlockRequest {
        OutlineProposalArticleBlockRequest {
            id: id.to_owned(),
            kind: kind.to_owned(),
            markdown: markdown.to_owned(),
            from,
            to,
        }
    }
}

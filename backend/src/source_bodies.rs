pub(crate) mod extractor;
mod file_handler;
mod file_import;
mod handler;
mod router;
mod storage;

pub use router::router;

const MAX_LLM_BODY_CHARACTERS: usize = 10_000;

pub(crate) fn limit_body_for_llm(body: &str) -> String {
    body.chars().take(MAX_LLM_BODY_CHARACTERS).collect()
}

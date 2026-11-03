use backend::llm::{ClaudeCodeProvider, call};
use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Debug, Deserialize, JsonSchema, PartialEq)]
struct ManualOutput {
    text: String,
}

#[tokio::test]
#[ignore = "requires an authenticated Claude Code CLI; run with cargo test --test claude_code -- --ignored"]
async fn calls_the_installed_claude_code_cli() {
    let output = call::<ManualOutput>(
        &ClaudeCodeProvider::default(),
        "Return exactly this JSON object: {\"text\":\"ready\"}",
    )
    .await;

    assert_eq!(
        output,
        Ok(ManualOutput {
            text: "ready".to_owned()
        })
    );
}

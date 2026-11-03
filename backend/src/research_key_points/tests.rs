use indoc::indoc;
use rstest::rstest;

use super::{
    handler::{build_prompt, build_result},
    model::{
        ModelKeyPoint, ModelResponse, ModelSource, ResearchKeyPoint, ResearchKeyPointsRequest,
        ResearchKeyPointsResult, ResearchSourceInput, ResearchSourceResult,
    },
    quote::quote_exists,
};

#[rstest]
#[case::nfkc_fullwidth("ＡＢＣ を使う", "ABC を使う", true)]
#[case::collapse_whitespace("複数の   空白", "複数の 空白", true)]
#[case::ignore_markdown("**強調** と `コード`", "強調 と コード", true)]
#[case::reject_missing_text("本文にある一節", "本文にない一節", false)]
#[case::reject_empty_quote("本文", "  **  ", false)]
fn checks_quotes_after_normalization(
    #[case] body: &str,
    #[case] quote: &str,
    #[case] expected: bool,
) {
    assert_eq!(quote_exists(body, quote), expected);
}

#[rstest]
#[case::keeps_only_verified_quotes(true, vec![
    ModelKeyPoint { text: "本文が裏付ける要点".to_owned(), quote: "**根拠のある引用**".to_owned() },
], vec![ResearchKeyPoint { text: "本文が裏付ける要点".to_owned(), quote: "**根拠のある引用**".to_owned() }])]
#[case::drops_unverified_quotes(true, vec![
    ModelKeyPoint { text: "でっち上げの要点".to_owned(), quote: "存在しない引用".to_owned() },
], vec![])]
#[case::omits_points_without_a_question(false, vec![
    ModelKeyPoint { text: "本文の要点".to_owned(), quote: "本文の引用".to_owned() },
], vec![])]
fn filters_points_and_preserves_source_identity(
    #[case] has_question: bool,
    #[case] model_points: Vec<ModelKeyPoint>,
    #[case] expected_points: Vec<ResearchKeyPoint>,
) {
    let actual = build_result(
        ModelResponse {
            sources: vec![ModelSource {
                source_id: "source-a".to_owned(),
                summary: "資料の要約".to_owned(),
                key_points: model_points,
            }],
        },
        vec![ResearchSourceInput {
            id: "source-a".to_owned(),
            body: "本文は根拠のある引用を含みます。本文の引用".to_owned(),
        }],
        has_question,
    );

    assert_eq!(
        actual,
        ResearchKeyPointsResult {
            sources: vec![ResearchSourceResult {
                id: "source-a".to_owned(),
                summary: "資料の要約".to_owned(),
                key_points: expected_points,
            }],
        }
    );
}

#[test]
fn deserializes_the_model_response_shape() {
    let actual = serde_json::from_str::<ModelResponse>(
        r#"{"sources":[{"source_id":"source-a","summary":"資料の要約","key_points":[{"text":"要点","quote":"本文の一節"}]}]}"#,
    )
    .map_err(|error| error.to_string());

    assert_eq!(
        actual,
        Ok(ModelResponse {
            sources: vec![ModelSource {
                source_id: "source-a".to_owned(),
                summary: "資料の要約".to_owned(),
                key_points: vec![ModelKeyPoint {
                    text: "要点".to_owned(),
                    quote: "本文の一節".to_owned(),
                }],
            }],
        })
    );
}

#[test]
fn limits_each_source_to_ten_thousand_characters() {
    let actual = build_prompt(&ResearchKeyPointsRequest {
        question: None,
        sources: vec![ResearchSourceInput {
            id: "source-a".to_owned(),
            body: "あ".repeat(10_001),
        }],
    });
    let expected = format!(
        "{}{}\n",
        indoc! {"
            依頼
            問い: なし。要約のみを作り、要点は空にしてください。

            資料

            資料 ID: source-a
            本文:
        "},
        "あ".repeat(10_000),
    );

    assert_eq!(actual, expected);
}

use rstest::rstest;

use super::quote_exists;

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

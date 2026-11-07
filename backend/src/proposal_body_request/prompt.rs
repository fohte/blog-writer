use super::handler::BodyRequest;

pub(super) fn build_prompt(request: &BodyRequest) -> String {
    let line_break = "\n";
    let paragraph_break = format!("{line_break}{line_break}");
    let headings = request
        .headings
        .iter()
        .map(|heading| format!("- {heading}"))
        .collect::<Vec<_>>()
        .join(line_break);

    [
        format!(
            "記事の前提{line_break}- 読者: {}{line_break}- 目的: {}{line_break}- 主張: {}",
            request.premise.audience, request.premise.purpose, request.premise.claim,
        ),
        format!("見出し一覧{line_break}{headings}"),
        format!("対象を含む節{line_break}{}", request.section),
        format!("書き手が選んだ範囲{line_break}{}", request.target),
        format!("書き手の依頼{line_break}{}", request.instruction),
        "節内の ⟪依頼範囲の開始⟫ と ⟪依頼範囲の終了⟫ の間が置換対象です。マーカーを含めず、依頼に沿って置き換えた文だけを返してください。説明や前置きは付けないでください。".to_owned(),
    ]
    .join(&paragraph_break)
        + line_break
}

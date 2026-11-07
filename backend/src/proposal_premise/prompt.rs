use super::handler::{PremiseMessage, PremiseMessageRole, PremiseRequest, UNCHANGED};

pub(super) fn build_prompt(request: &PremiseRequest) -> String {
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
            request.premise.audience, request.premise.purpose, request.premise.thesis,
        ),
        format!("見出し一覧{line_break}{headings}"),
        format!("書き手との対話履歴{line_break}{}", render_messages(&request.messages)),
        [
            "書き手の最新のメッセージを受け、記事の前提を一緒に具体化してください。".to_owned(),
            "reply は質問または確認を 1〜2 文で返してください。".to_owned(),
            format!(
                "audience、purpose、thesis はそれぞれ新しい値を返すか、変更しない場合は文字列「{UNCHANGED}」を返してください。"
            ),
            "値を変更する場合も、書き手が明示していない内容を推測して埋めないでください。".to_owned(),
            "JSON の値だけを返し、前置きや Markdown は付けないでください。".to_owned(),
        ]
        .join(line_break),
    ]
    .join(&paragraph_break)
        + line_break
}

fn render_messages(messages: &[PremiseMessage]) -> String {
    messages
        .iter()
        .map(|message| {
            let speaker = match message.role {
                PremiseMessageRole::User => "書き手",
                PremiseMessageRole::Assistant => "アシスタント",
            };
            format!("{speaker}: {}", message.content)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

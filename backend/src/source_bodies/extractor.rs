use dom_smoothie::{Config, Readability, ReadabilityError, TextMode};

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ExtractedSource {
    pub title: String,
    pub body: String,
    /// Calendar date (`YYYY-MM-DD`) the page says it was published, if any.
    pub published_at: Option<String>,
}

pub(crate) fn extract(html: &str, document_url: &str) -> Result<ExtractedSource, ReadabilityError> {
    let config = Config {
        text_mode: TextMode::Markdown,
        ..Config::default()
    };
    let mut readability = Readability::new(html, Some(document_url), Some(config))?;
    let article = readability.parse()?;

    Ok(ExtractedSource {
        title: article.title,
        body: article.text_content.to_string(),
        published_at: article.published_time.as_deref().and_then(published_date),
    })
}

/// OGP and schema.org require ISO 8601 here, so any other format is treated as unknown.
fn published_date(value: &str) -> Option<String> {
    let date = value.trim().get(..10)?;
    let is_date = date.bytes().enumerate().all(|(index, byte)| match index {
        4 | 7 => byte == b'-',
        _ => byte.is_ascii_digit(),
    });
    is_date.then(|| date.to_owned())
}

#[cfg(test)]
mod tests {
    use indoc::{formatdoc, indoc};
    use rstest::rstest;

    use super::{ExtractedSource, extract};

    #[rstest]
    #[case::no_published_date("", None)]
    #[case::open_graph_timestamp(
        r#"<meta property="article:published_time" content="2025-03-04T09:00:00+09:00">"#,
        Some("2025-03-04")
    )]
    #[case::json_ld_date(
        r#"<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Sample article","datePublished":"2024-12-31"}</script>"#,
        Some("2024-12-31")
    )]
    #[case::not_iso_8601(
        r#"<meta property="article:published_time" content="March 4, 2025">"#,
        None
    )]
    fn extracts_markdown_title_and_published_date_from_html(
        #[case] head: &str,
        #[case] published_at: Option<&str>,
    ) -> Result<(), dom_smoothie::ReadabilityError> {
        let html = formatdoc! {r#"
            <!doctype html>
            <html>
              <head><title>Sample article</title>{head}</head>
              <body>
                <article>
                  <h1>Sample article</h1>
                  <p>This is the first paragraph with enough text for the reader extraction to identify the main article content.</p>
                  <p>Read the <a href="/guide">reference guide</a> for the complete explanation of this example.</p>
                </article>
              </body>
            </html>
        "#};

        let actual = extract(&html, "https://example.test/articles/sample")?;

        assert_eq!(
            actual,
            ExtractedSource {
                title: "Sample article".to_owned(),
                body: indoc! {"
                    This is the first paragraph with enough text for the reader extraction to identify the main article content.

                    Read the [reference guide](https://example.test/guide) for the complete explanation of this example.
                "}
                .trim_end()
                .to_owned(),
                published_at: published_at.map(str::to_owned),
            }
        );

        Ok(())
    }
}

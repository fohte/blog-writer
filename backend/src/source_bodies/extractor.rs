use dom_smoothie::{Config, Readability, ReadabilityError, TextMode};

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ExtractedSource {
    pub title: String,
    pub body: String,
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
    })
}

#[cfg(test)]
mod tests {
    use indoc::indoc;

    use super::{ExtractedSource, extract};

    #[test]
    fn extracts_markdown_and_title_from_html() -> Result<(), dom_smoothie::ReadabilityError> {
        let html = indoc! {r#"
            <!doctype html>
            <html>
              <head><title>Sample article</title></head>
              <body>
                <article>
                  <h1>Sample article</h1>
                  <p>This is the first paragraph with enough text for the reader extraction to identify the main article content.</p>
                  <p>Read the <a href="/guide">reference guide</a> for the complete explanation of this example.</p>
                </article>
              </body>
            </html>
        "#};

        let actual = extract(html, "https://example.test/articles/sample")?;

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
            }
        );

        Ok(())
    }
}

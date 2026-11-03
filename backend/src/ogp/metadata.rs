use encoding_rs::{Encoding, UTF_8};
use reqwest::Url;
use scraper::{Html, Selector};

use crate::ogp::OgpResponse;

pub(super) fn is_html_content_type(content_type: Option<&str>) -> bool {
    content_type
        .and_then(|value| value.split(';').next())
        .is_some_and(|media_type| {
            media_type.trim().eq_ignore_ascii_case("text/html")
                || media_type
                    .trim()
                    .eq_ignore_ascii_case("application/xhtml+xml")
        })
}

pub(super) fn decode_html(bytes: &[u8], content_type: Option<&str>) -> String {
    let encoding = Encoding::for_bom(bytes)
        .or_else(|| charset_from_content_type(content_type).map(|encoding| (encoding, 0)))
        .or_else(|| charset_from_meta(bytes).map(|encoding| (encoding, 0)))
        .unwrap_or((UTF_8, 0));
    encoding
        .0
        .decode_without_bom_handling(&bytes[encoding.1..])
        .0
        .into_owned()
}

fn charset_from_content_type(content_type: Option<&str>) -> Option<&'static Encoding> {
    content_type?.split(';').skip(1).find_map(|parameter| {
        let (name, value) = parameter.split_once('=')?;
        if !name.trim().eq_ignore_ascii_case("charset") {
            return None;
        }
        let label = value.trim().trim_matches(['"', '\'']);
        Encoding::for_label(label.as_bytes())
    })
}

fn charset_from_meta(bytes: &[u8]) -> Option<&'static Encoding> {
    let prefix = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]);
    let document = Html::parse_document(&prefix);
    let selector = Selector::parse("meta[charset]").ok()?;
    document
        .select(&selector)
        .find_map(|element| Encoding::for_label(element.value().attr("charset")?.trim().as_bytes()))
}

pub(super) fn extract(final_url: &Url, html: &str) -> OgpResponse {
    let document = Html::parse_document(html);
    let title = meta_content(&document, "property", "og:title")
        .or_else(|| element_text(&document, "title"));
    let description = meta_content(&document, "property", "og:description")
        .or_else(|| meta_content(&document, "name", "description"));
    let image = meta_content(&document, "property", "og:image")
        .and_then(|image| final_url.join(&image).ok())
        .map(|image| image.to_string());

    OgpResponse {
        available: true,
        final_url: Some(final_url.to_string()),
        title,
        description,
        image,
    }
}

fn meta_content(document: &Html, attribute: &str, expected: &str) -> Option<String> {
    let selector = Selector::parse("meta").ok()?;
    document.select(&selector).find_map(|element| {
        let value = element.value();
        let attribute_value = value.attr(attribute)?;
        if !attribute_value.eq_ignore_ascii_case(expected) {
            return None;
        }
        value
            .attr("content")
            .map(str::trim)
            .filter(|content| !content.is_empty())
            .map(str::to_owned)
    })
}

fn element_text(document: &Html, selector: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    document
        .select(&selector)
        .next()
        .map(|element| element.text().collect::<String>())
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

#[cfg(test)]
mod tests {
    use indoc::indoc;
    use reqwest::Url;
    use rstest::rstest;

    use super::extract;
    use crate::ogp::OgpResponse;

    #[rstest]
    #[case::open_graph_metadata(
        indoc! {r#"
            <html><head>
              <meta property="og:title" content="A page title">
              <meta property="og:description" content="A page description">
              <meta property="og:image" content="../images/card.png">
              <title>Fallback title</title>
            </head></html>
        "#},
        OgpResponse {
            available: true,
            final_url: Some("https://example.test/posts/one".to_owned()),
            title: Some("A page title".to_owned()),
            description: Some("A page description".to_owned()),
            image: Some("https://example.test/images/card.png".to_owned()),
        }
    )]
    #[case::document_fallbacks(
        r#"<html><head><meta name="description" content="Plain description"><title>Document title</title></head></html>"#,
        OgpResponse {
            available: true,
            final_url: Some("https://example.test/posts/one".to_owned()),
            title: Some("Document title".to_owned()),
            description: Some("Plain description".to_owned()),
            image: None,
        }
    )]
    #[case::empty_metadata(
        "<html><head></head></html>",
        OgpResponse {
            available: true,
            final_url: Some("https://example.test/posts/one".to_owned()),
            title: None,
            description: None,
            image: None,
        }
    )]
    fn extracts_metadata_and_fallbacks(
        #[case] html: &str,
        #[case] expected: OgpResponse,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let final_url = Url::parse("https://example.test/posts/one")?;

        assert_eq!(extract(&final_url, html), expected);
        Ok(())
    }
}

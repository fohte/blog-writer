use encoding_rs::{Encoding, UTF_8};
use scraper::{Html, Selector};

pub(crate) fn is_html_content_type(content_type: Option<&str>) -> bool {
    content_type
        .and_then(|value| value.split(';').next())
        .is_some_and(|media_type| {
            let media_type = media_type.trim();
            media_type.eq_ignore_ascii_case("text/html")
                || media_type.eq_ignore_ascii_case("application/xhtml+xml")
        })
}

pub(crate) fn decode_html(bytes: &[u8], content_type: Option<&str>) -> String {
    let (encoding, bom_len) = Encoding::for_bom(bytes)
        .or_else(|| charset_from_content_type(content_type).map(|encoding| (encoding, 0)))
        .or_else(|| charset_from_meta(bytes).map(|encoding| (encoding, 0)))
        .unwrap_or((UTF_8, 0));
    encoding
        .decode_without_bom_handling(&bytes[bom_len..])
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
    let selector = Selector::parse("meta").ok()?;
    document.select(&selector).find_map(|element| {
        let value = element.value();
        let direct_encoding = value
            .attr("charset")
            .and_then(|label| Encoding::for_label(label.trim().as_bytes()));
        direct_encoding.or_else(|| {
            value
                .attr("http-equiv")
                .is_some_and(|http_equiv| http_equiv.trim().eq_ignore_ascii_case("content-type"))
                .then(|| charset_from_content_type(value.attr("content")))
                .flatten()
        })
    })
}

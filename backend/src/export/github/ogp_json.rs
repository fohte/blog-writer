use std::{collections::HashSet, sync::Arc};

use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::Url;
use tokio::task::JoinSet;

use crate::{
    config::ExportDestination,
    ogp::{self, OgpResponse},
    safe_fetch::SafeFetchService,
};

use super::{ExportError, ExportService, PutContentsRequest};

const MAX_CONCURRENT_OGP_FETCHES: usize = 4;
const MAX_OGP_HREFS_PER_ARTICLE: usize = 50;

pub(super) struct PreparedOgpJson {
    path: String,
    sha: Option<String>,
    entries: serde_json::Map<String, serde_json::Value>,
    missing_hrefs: Vec<String>,
}

impl ExportService {
    pub(super) async fn prepare_ogp_json(
        &self,
        destination: &ExportDestination,
        json_path: &str,
        reference: &str,
        hrefs: Vec<String>,
        token: &str,
    ) -> Result<Option<PreparedOgpJson>, ExportError> {
        let remote_file = self
            .get_contents_file(destination, json_path, reference, token)
            .await?;
        let entries = match remote_file.as_ref() {
            Some(file) => {
                serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&file.content)
                    .map_err(|_| ExportError::InvalidResponse)?
            }
            None => serde_json::Map::new(),
        };

        let missing_hrefs: Vec<_> = hrefs
            .into_iter()
            .filter(|href| !entries.contains_key(href))
            .collect();
        if missing_hrefs.len() > MAX_OGP_HREFS_PER_ARTICLE {
            return Err(ExportError::TooManyOgpHrefs);
        }
        if missing_hrefs.is_empty() {
            return Ok(None);
        }

        Ok(Some(PreparedOgpJson {
            path: json_path.to_owned(),
            sha: remote_file.map(|file| file.sha),
            entries,
            missing_hrefs,
        }))
    }

    pub(super) async fn commit_ogp_json(
        &self,
        destination: &ExportDestination,
        branch: &str,
        token: &str,
        mut prepared: PreparedOgpJson,
        safe_fetch: Arc<dyn SafeFetchService>,
    ) -> Result<(), ExportError> {
        for (href, value) in fetch_ogp_entries(&prepared.missing_hrefs, safe_fetch).await? {
            prepared.entries.insert(href, value);
        }

        let mut content = serde_json::to_string_pretty(&prepared.entries)
            .map_err(|_| ExportError::InvalidResponse)?;
        content.push('\n');
        self.put_raw_contents(
            destination,
            &prepared.path,
            PutContentsRequest {
                message: format!("Update {}", prepared.path),
                content: STANDARD.encode(content.as_bytes()),
                branch,
                sha: prepared.sha.as_deref(),
            },
            token,
        )
        .await
    }
}

async fn fetch_ogp_entries(
    hrefs: &[String],
    safe_fetch: Arc<dyn SafeFetchService>,
) -> Result<Vec<(String, serde_json::Value)>, ExportError> {
    let mut pending = hrefs.iter().enumerate();
    let mut fetches = JoinSet::new();
    for _ in 0..MAX_CONCURRENT_OGP_FETCHES {
        let Some((index, href)) = pending.next() else {
            break;
        };
        spawn_ogp_fetch(&mut fetches, Arc::clone(&safe_fetch), index, href.clone());
    }

    let mut results = Vec::with_capacity(hrefs.len());
    while let Some(result) = fetches.join_next().await {
        let result = result.map_err(|_| ExportError::OgpFetchTask)?;
        results.push(result);
        if let Some((index, href)) = pending.next() {
            spawn_ogp_fetch(&mut fetches, Arc::clone(&safe_fetch), index, href.clone());
        }
    }
    results.sort_by_key(|(index, _, _)| *index);

    let entries = results
        .into_iter()
        .map(|(_, href, metadata)| {
            let value = if metadata.available {
                serde_json::json!({
                    "title": metadata.title.unwrap_or_default(),
                    "description": metadata.description.unwrap_or_default(),
                    "image": metadata.image.unwrap_or_default(),
                })
            } else {
                tracing::warn!(href = %href, "OGP metadata is unavailable");
                serde_json::json!({ "title": "", "description": "", "image": "" })
            };
            (href, value)
        })
        .collect();
    Ok(entries)
}

fn spawn_ogp_fetch(
    fetches: &mut JoinSet<(usize, String, OgpResponse)>,
    safe_fetch: Arc<dyn SafeFetchService>,
    index: usize,
    href: String,
) {
    fetches.spawn(async move {
        let metadata = ogp::fetch_metadata(safe_fetch.as_ref(), &href).await;
        (index, href, metadata)
    });
}

pub(super) fn card_link_hrefs(content: &str) -> Vec<String> {
    let mut hrefs = Vec::new();
    let mut seen = HashSet::new();
    let mut search_from = 0;
    while let Some(relative_start) = content[search_from..].find("<CardLink") {
        let tag_start = search_from + relative_start;
        let attributes_start = tag_start + "<CardLink".len();
        let bytes = content.as_bytes();
        if bytes
            .get(attributes_start)
            .is_some_and(|byte| !byte.is_ascii_whitespace() && !matches!(byte, b'/' | b'>'))
        {
            search_from = attributes_start;
            continue;
        }

        let mut quote = None;
        let mut tag_end = None;
        for (offset, byte) in bytes.iter().enumerate().skip(attributes_start) {
            match (quote, byte) {
                (Some(active), current) if *current == active => quote = None,
                (None, b'\'' | b'"') => quote = Some(*byte),
                (None, b'>') => {
                    tag_end = Some(offset);
                    break;
                }
                _ => {}
            }
        }
        let Some(tag_end) = tag_end else {
            tracing::warn!("CardLink tag is not closed");
            break;
        };
        let attributes = &content[attributes_start..tag_end];
        match quoted_attribute(attributes, "href") {
            Some(href) if !href.is_empty() && is_http_url(&href) => {
                if seen.insert(href.clone()) {
                    hrefs.push(href);
                }
            }
            Some(href) if href.is_empty() => {
                tracing::warn!("CardLink href is empty");
            }
            None => tracing::warn!("CardLink href is missing or not quoted"),
            Some(_) => {}
        }
        search_from = tag_end + 1;
    }
    hrefs
}

fn is_http_url(href: &str) -> bool {
    Url::parse(href).is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
}

fn quoted_attribute(attributes: &str, expected_name: &str) -> Option<String> {
    let bytes = attributes.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        while cursor < bytes.len() && (bytes[cursor].is_ascii_whitespace() || bytes[cursor] == b'/')
        {
            cursor += 1;
        }
        let name_start = cursor;
        while cursor < bytes.len()
            && !bytes[cursor].is_ascii_whitespace()
            && !matches!(bytes[cursor], b'=' | b'/' | b'>')
        {
            cursor += 1;
        }
        if name_start == cursor {
            cursor += 1;
            continue;
        }
        let name = &attributes[name_start..cursor];
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b'=' {
            continue;
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || !matches!(bytes[cursor], b'\'' | b'"') {
            continue;
        }
        let quote = bytes[cursor];
        cursor += 1;
        let value_start = cursor;
        while cursor < bytes.len() && bytes[cursor] != quote {
            cursor += 1;
        }
        if name == expected_name {
            return Some(attributes[value_start..cursor].to_owned());
        }
        cursor += usize::from(cursor < bytes.len());
    }
    None
}

#[cfg(test)]
mod tests {
    use indoc::indoc;
    use rstest::rstest;

    use super::card_link_hrefs;

    #[rstest]
    #[case::double_quoted(
        "<CardLink href=\"https://example.test/guide\" />",
        vec!["https://example.test/guide"]
    )]
    #[case::single_quoted(
        "<CardLink href='https://example.test/guide' />",
        vec!["https://example.test/guide"]
    )]
    #[case::attribute_order(
        "<CardLink title=\"Guide\" href=\"https://example.test/guide\" />",
        vec!["https://example.test/guide"]
    )]
    #[case::multiline_tag(
        indoc! {r#"
            <CardLink
                title="Guide"
                href="https://example.test/guide"
            />
        "#},
        vec!["https://example.test/guide"]
    )]
    #[case::duplicate_hrefs(
        "<CardLink href=\"https://example.test/guide\" /><CardLink href='https://example.test/guide' />",
        vec!["https://example.test/guide"]
    )]
    #[case::card_link_prefix_is_not_a_tag(
        "<CardLinkFoo href=\"https://example.test/guide\" />",
        vec![]
    )]
    #[case::jsx_expression_is_not_quoted(
        "<CardLink href={\"https://example.test/guide\"} />",
        vec![]
    )]
    #[case::relative_href_is_ignored("<CardLink href=\"/guide\" />", vec![])]
    #[case::mailto_href_is_ignored("<CardLink href=\"mailto:reader@example.test\" />", vec![])]
    fn extracts_distinct_http_card_link_hrefs(#[case] content: &str, #[case] expected: Vec<&str>) {
        let actual = card_link_hrefs(content);
        assert_eq!(
            actual.iter().map(String::as_str).collect::<Vec<_>>(),
            expected
        );
    }
}

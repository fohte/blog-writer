use std::{collections::HashSet, sync::Arc};

use base64::{Engine, engine::general_purpose::STANDARD};

use crate::{
    config::ExportDestination,
    ogp::{self, OgpResponse},
    safe_fetch::SafeFetchService,
};
use tokio::task::JoinSet;

use super::{ExportError, ExportService, PutContentsRequest};

const MAX_CONCURRENT_OGP_FETCHES: usize = 4;

impl ExportService {
    pub(super) async fn update_ogp_json(
        &self,
        destination: &ExportDestination,
        json_path: &str,
        branch: &str,
        article_content: &str,
        token: &str,
        safe_fetch: Arc<dyn SafeFetchService>,
    ) -> Result<(), ExportError> {
        let hrefs = card_link_hrefs(article_content);
        if hrefs.is_empty() {
            return Ok(());
        }

        let remote_file = self
            .get_contents_file(destination, json_path, branch, token)
            .await?;
        let mut entries = match remote_file.as_ref() {
            Some(file) => serde_json::from_str::<serde_json::Value>(&file.content)
                .map_err(|_| ExportError::InvalidResponse)?,
            None => serde_json::Value::Object(serde_json::Map::new()),
        };
        let Some(object) = entries.as_object_mut() else {
            return Err(ExportError::InvalidResponse);
        };

        let missing_hrefs: Vec<_> = hrefs
            .into_iter()
            .filter(|href| !object.contains_key(href))
            .collect();
        if missing_hrefs.is_empty() {
            return Ok(());
        }

        let mut pending = missing_hrefs.iter().enumerate();
        let mut fetches = JoinSet::new();
        for _ in 0..MAX_CONCURRENT_OGP_FETCHES {
            let Some((index, href)) = pending.next() else {
                break;
            };
            spawn_ogp_fetch(&mut fetches, Arc::clone(&safe_fetch), index, href.clone());
        }

        let mut results = Vec::with_capacity(missing_hrefs.len());
        while let Some(result) = fetches.join_next().await {
            let result = result.map_err(|_| ExportError::OgpFetchTask)?;
            results.push(result);
            if let Some((index, href)) = pending.next() {
                spawn_ogp_fetch(&mut fetches, Arc::clone(&safe_fetch), index, href.clone());
            }
        }
        results.sort_by_key(|(index, _, _)| *index);

        for (_, href, metadata) in results {
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
            object.insert(href, value);
        }

        let mut content =
            serde_json::to_string_pretty(&entries).map_err(|_| ExportError::InvalidResponse)?;
        content.push('\n');
        self.put_raw_contents(
            destination,
            json_path,
            PutContentsRequest {
                message: format!("Update {json_path}"),
                content: STANDARD.encode(content.as_bytes()),
                branch,
                sha: remote_file.as_ref().map(|file| file.sha.as_str()),
            },
            token,
        )
        .await
    }
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

fn card_link_hrefs(content: &str) -> Vec<String> {
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
            break;
        };
        let attributes = &content[attributes_start..tag_end];
        if let Some(href) = quoted_attribute(attributes, "href")
            && !href.is_empty()
            && seen.insert(href.clone())
        {
            hrefs.push(href);
        }
        search_from = tag_end + 1;
    }
    hrefs
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

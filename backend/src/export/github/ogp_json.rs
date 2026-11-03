use std::collections::HashSet;

use base64::{Engine, engine::general_purpose::STANDARD};

use crate::{config::ExportDestination, ogp, safe_fetch::SafeFetchService};

use super::{ExportError, ExportService, PutContentsRequest};

impl ExportService {
    pub(super) async fn update_ogp_json(
        &self,
        destination: &ExportDestination,
        json_path: &str,
        branch: &str,
        article_content: &str,
        token: &str,
        safe_fetch: &dyn SafeFetchService,
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

        let mut changed = false;
        for href in hrefs {
            if object.contains_key(&href) {
                continue;
            }
            let metadata = ogp::fetch_metadata(safe_fetch, &href).await;
            let value = if metadata.available {
                serde_json::json!({
                    "title": metadata.title.unwrap_or_default(),
                    "description": metadata.description.unwrap_or_default(),
                    "image": metadata.image.unwrap_or_default(),
                })
            } else {
                serde_json::json!({ "title": "", "description": "", "image": "" })
            };
            object.insert(href, value);
            changed = true;
        }

        if !changed {
            return Ok(());
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
            false,
        )
        .await
    }
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

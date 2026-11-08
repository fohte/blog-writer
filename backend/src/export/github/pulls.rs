use std::collections::HashSet;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    ARTICLE_BRANCH_PREFIX, ExportDestination, ExportError, ExportService, successful_response,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ArticlePullState {
    Open,
    Closed,
    Merged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ArticlePull {
    pub article_id: String,
    pub number: u64,
    pub state: ArticlePullState,
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct PullListItem {
    number: u64,
    html_url: String,
    state: String,
    merged_at: Option<String>,
    head: PullHead,
}

#[derive(Debug, Deserialize)]
struct PullHead {
    label: Option<String>,
}

impl ExportService {
    /// Returns the newest pull request of each article, newest first.
    pub async fn list_article_pulls(
        &self,
        destination: &ExportDestination,
    ) -> Result<Vec<ArticlePull>, ExportError> {
        let (owner, repo) = destination
            .repository_parts()
            .ok_or(ExportError::InvalidConfiguration)?;
        let token = self.exchange_token(owner, repo).await?;
        let mut url = self.github_url(owner, repo, &["pulls"])?;
        // shortcut: only the 100 newest pull requests are read, page through the list when a destination outgrows that.
        url.query_pairs_mut()
            .append_pair("state", "all")
            .append_pair("sort", "created")
            .append_pair("direction", "desc")
            .append_pair("per_page", "100");
        let response = self
            .send_github(self.github_request(Method::GET, url, &token))
            .await?;
        let response = successful_response(response).await?;
        let pulls = response
            .json::<Vec<PullListItem>>()
            .await
            .map_err(|_| ExportError::InvalidResponse)?;

        let mut seen = HashSet::new();
        Ok(pulls
            .into_iter()
            .filter_map(|pull| to_article_pull(owner, pull))
            .filter(|pull| seen.insert(pull.article_id.clone()))
            .collect())
    }
}

fn to_article_pull(owner: &str, pull: PullListItem) -> Option<ArticlePull> {
    // The label carries the head's owner, so a fork's branch with the same name is not mistaken for the article's.
    let label = pull.head.label?;
    let (head_owner, branch) = label.split_once(':')?;
    if !head_owner.eq_ignore_ascii_case(owner) {
        return None;
    }
    let article_id = branch.strip_prefix(ARTICLE_BRANCH_PREFIX)?.to_owned();
    let state = match (pull.merged_at, pull.state.as_str()) {
        (Some(_), _) => ArticlePullState::Merged,
        (None, "open") => ArticlePullState::Open,
        (None, _) => ArticlePullState::Closed,
    };

    Some(ArticlePull {
        article_id,
        number: pull.number,
        state,
        url: pull.html_url,
    })
}

use std::fs;

use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{Client, Response, StatusCode, Url};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    config::{ExportConfig, ExportDestination},
    export::handler::PublishArticleRequest,
};

const GITHUB_API_URL: &str = "https://api.github.com";
const GITHUB_ACCEPT: &str = "application/vnd.github+json";

#[derive(Clone)]
pub struct ExportService {
    config: ExportConfig,
    client: Client,
    github_api_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFile {
    pub content: String,
    pub sha: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ExportError {
    #[error("GitHub rejected the file update because the remote file changed")]
    RemoteConflict,
    #[error("octo-sts token exchange failed")]
    TokenExchange,
    #[error("GitHub API request failed")]
    GitHubRequest,
    #[error("GitHub API returned an invalid response")]
    InvalidResponse,
    #[error("export destination configuration is invalid")]
    InvalidConfiguration,
    #[error("export request contains an invalid article ID or slug")]
    InvalidInput,
    #[error("local service credential could not be read")]
    TokenFile,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    token: String,
}

#[derive(Debug, Deserialize)]
struct PullResponse {
    html_url: String,
    state: String,
}

#[derive(Debug, Deserialize)]
struct ReferenceResponse {
    object: ReferenceObject,
}

#[derive(Debug, Deserialize)]
struct ReferenceObject {
    sha: String,
}

#[derive(Debug, Deserialize)]
struct ContentsResponse {
    content: String,
    sha: String,
    encoding: String,
}

#[derive(Debug, Serialize)]
struct CreateReferenceRequest<'a> {
    #[serde(rename = "ref")]
    reference: String,
    sha: &'a str,
}

#[derive(Debug, Serialize)]
struct UpdateReferenceRequest<'a> {
    sha: &'a str,
    force: bool,
}

#[derive(Debug, Serialize)]
struct PutContentsRequest<'a> {
    message: String,
    content: String,
    branch: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha: Option<&'a str>,
}

#[derive(Debug, Serialize)]
struct CreatePullRequest<'a> {
    title: String,
    head: &'a str,
    base: &'a str,
    body: String,
}

impl ExportService {
    pub fn new(config: ExportConfig) -> Self {
        Self::with_github_api_url(config, GITHUB_API_URL.to_owned())
    }

    fn with_github_api_url(config: ExportConfig, github_api_url: String) -> Self {
        Self {
            config,
            client: Client::new(),
            github_api_url,
        }
    }

    pub fn destinations(&self) -> &[ExportDestination] {
        &self.config.destinations
    }

    pub async fn get_article_file(
        &self,
        destination: &ExportDestination,
        article_id: &str,
        slug: &str,
    ) -> Result<Option<RemoteFile>, ExportError> {
        if !valid_article_id(article_id) || !valid_slug(slug) {
            return Err(ExportError::InvalidInput);
        }
        let (owner, repo) = destination
            .repository_parts()
            .ok_or(ExportError::InvalidConfiguration)?;
        let token = self.exchange_token(owner, repo).await?;
        let branch = article_branch(article_id);
        let pull = self.find_open_pull(owner, repo, &branch, &token).await?;
        let reference = pull
            .as_ref()
            .map_or(destination.base_branch.as_str(), |_| branch.as_str());
        let file_path = destination.file_path(slug);
        let mut contents_path = vec!["contents"];
        contents_path.extend(file_path.split('/'));
        let mut url = self.github_url(owner, repo, &contents_path)?;
        url.query_pairs_mut().append_pair("ref", reference);
        let response = self
            .client
            .get(url)
            .bearer_auth(token)
            .header("Accept", GITHUB_ACCEPT)
            .send()
            .await
            .map_err(|_| ExportError::GitHubRequest)?;

        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let response = successful_response(response).await?;
        let contents = response
            .json::<ContentsResponse>()
            .await
            .map_err(|_| ExportError::InvalidResponse)?;
        if contents.encoding != "base64" {
            return Err(ExportError::InvalidResponse);
        }
        let compact_content = contents
            .content
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>();
        let bytes = STANDARD
            .decode(compact_content)
            .map_err(|_| ExportError::InvalidResponse)?;
        let content = String::from_utf8(bytes).map_err(|_| ExportError::InvalidResponse)?;

        Ok(Some(RemoteFile {
            content,
            sha: contents.sha,
        }))
    }

    pub async fn publish_article(
        &self,
        destination: &ExportDestination,
        article_id: &str,
        request: &PublishArticleRequest,
    ) -> Result<String, ExportError> {
        if !valid_article_id(article_id) || !valid_slug(&request.slug) {
            return Err(ExportError::InvalidInput);
        }
        let (owner, repo) = destination
            .repository_parts()
            .ok_or(ExportError::InvalidConfiguration)?;
        let token = self.exchange_token(owner, repo).await?;
        let branch = article_branch(article_id);
        let pull = self.find_open_pull(owner, repo, &branch, &token).await?;

        if pull.is_none() {
            self.reset_branch(owner, repo, destination, &branch, &token)
                .await?;
        }

        let path = destination.file_path(&request.slug);
        self.put_contents(destination, &path, &branch, request, &token)
            .await?;

        match pull {
            Some(pull) if pull.state == "open" => Ok(pull.html_url),
            _ => {
                let url = self.github_url(owner, repo, &["pulls"])?;
                let body = CreatePullRequest {
                    title: format!("Publish {}", request.slug),
                    head: &branch,
                    base: &destination.base_branch,
                    body: "Published from blog-writer.".to_owned(),
                };
                let response = self
                    .client
                    .post(url)
                    .bearer_auth(&token)
                    .header("Accept", GITHUB_ACCEPT)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|_| ExportError::GitHubRequest)?;
                let response = successful_response(response).await?;
                response
                    .json::<PullResponse>()
                    .await
                    .map(|pull| pull.html_url)
                    .map_err(|_| ExportError::InvalidResponse)
            }
        }
    }

    async fn exchange_token(&self, owner: &str, repo: &str) -> Result<String, ExportError> {
        let sa_token = fs::read_to_string(&self.config.octo_sts_sa_token_path)
            .map_err(|_| ExportError::TokenFile)?;
        let sa_token = sa_token.trim();
        if sa_token.is_empty() {
            return Err(ExportError::TokenFile);
        }

        let mut url =
            Url::parse(&self.config.octo_sts_url).map_err(|_| ExportError::InvalidConfiguration)?;
        url.set_path("/sts/exchange");
        url.query_pairs_mut()
            .append_pair("scope", &format!("{owner}/{repo}"))
            .append_pair("identity", &self.config.octo_sts_identity);
        let response = self
            .client
            .get(url)
            .bearer_auth(sa_token)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|_| ExportError::TokenExchange)?;
        let response = successful_response(response)
            .await
            .map_err(|_| ExportError::TokenExchange)?;
        let token_response = response
            .json::<TokenResponse>()
            .await
            .map_err(|_| ExportError::TokenExchange)?;
        if token_response.token.trim().is_empty() {
            return Err(ExportError::TokenExchange);
        }

        Ok(token_response.token)
    }

    async fn find_open_pull(
        &self,
        owner: &str,
        repo: &str,
        branch: &str,
        token: &str,
    ) -> Result<Option<PullResponse>, ExportError> {
        let mut url = self.github_url(owner, repo, &["pulls"])?;
        let head = format!("{owner}:{branch}");
        url.query_pairs_mut()
            .append_pair("state", "open")
            .append_pair("head", &head);
        let response = self
            .client
            .get(url)
            .bearer_auth(token)
            .header("Accept", GITHUB_ACCEPT)
            .send()
            .await
            .map_err(|_| ExportError::GitHubRequest)?;
        let response = successful_response(response).await?;
        let pulls = response
            .json::<Vec<PullResponse>>()
            .await
            .map_err(|_| ExportError::InvalidResponse)?;

        Ok(pulls.into_iter().next())
    }

    async fn reset_branch(
        &self,
        owner: &str,
        repo: &str,
        destination: &ExportDestination,
        branch: &str,
        token: &str,
    ) -> Result<(), ExportError> {
        let base_sha = self
            .get_reference_sha(owner, repo, &destination.base_branch, token)
            .await?
            .ok_or(ExportError::GitHubRequest)?;
        match self.get_reference_sha(owner, repo, branch, token).await? {
            Some(_) => {
                self.update_reference(owner, repo, branch, &base_sha, token)
                    .await
            }
            None => {
                self.create_reference(owner, repo, branch, &base_sha, token)
                    .await
            }
        }
    }

    async fn get_reference_sha(
        &self,
        owner: &str,
        repo: &str,
        branch: &str,
        token: &str,
    ) -> Result<Option<String>, ExportError> {
        let mut path = vec!["git", "ref", "heads"];
        path.extend(branch.split('/'));
        let url = self.github_url(owner, repo, &path)?;
        let response = self
            .client
            .get(url)
            .bearer_auth(token)
            .header("Accept", GITHUB_ACCEPT)
            .send()
            .await
            .map_err(|_| ExportError::GitHubRequest)?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let response = successful_response(response).await?;
        let reference = response
            .json::<ReferenceResponse>()
            .await
            .map_err(|_| ExportError::InvalidResponse)?;

        Ok(Some(reference.object.sha))
    }

    async fn create_reference(
        &self,
        owner: &str,
        repo: &str,
        branch: &str,
        sha: &str,
        token: &str,
    ) -> Result<(), ExportError> {
        let url = self.github_url(owner, repo, &["git", "refs"])?;
        let body = CreateReferenceRequest {
            reference: format!("refs/heads/{branch}"),
            sha,
        };
        let response = self
            .client
            .post(url)
            .bearer_auth(token)
            .header("Accept", GITHUB_ACCEPT)
            .json(&body)
            .send()
            .await
            .map_err(|_| ExportError::GitHubRequest)?;
        successful_response(response).await.map(|_| ())
    }

    async fn update_reference(
        &self,
        owner: &str,
        repo: &str,
        branch: &str,
        sha: &str,
        token: &str,
    ) -> Result<(), ExportError> {
        let mut path = vec!["git", "refs", "heads"];
        path.extend(branch.split('/'));
        let url = self.github_url(owner, repo, &path)?;
        let body = UpdateReferenceRequest { sha, force: true };
        let response = self
            .client
            .patch(url)
            .bearer_auth(token)
            .header("Accept", GITHUB_ACCEPT)
            .json(&body)
            .send()
            .await
            .map_err(|_| ExportError::GitHubRequest)?;
        successful_response(response).await.map(|_| ())
    }

    async fn put_contents(
        &self,
        destination: &ExportDestination,
        path: &str,
        branch: &str,
        request: &PublishArticleRequest,
        token: &str,
    ) -> Result<(), ExportError> {
        let (owner, repo) = destination
            .repository_parts()
            .ok_or(ExportError::InvalidConfiguration)?;
        let mut url_parts = vec!["contents"];
        url_parts.extend(path.split('/'));
        let url = self.github_url(owner, repo, &url_parts)?;
        let body = PutContentsRequest {
            message: format!("Publish {path}"),
            content: STANDARD.encode(request.content.as_bytes()),
            branch,
            sha: request.sha.as_deref(),
        };
        let response = self
            .client
            .put(url)
            .bearer_auth(token)
            .header("Accept", GITHUB_ACCEPT)
            .json(&body)
            .send()
            .await
            .map_err(|_| ExportError::GitHubRequest)?;
        if response.status() == StatusCode::CONFLICT {
            return Err(ExportError::RemoteConflict);
        }
        successful_response(response).await.map(|_| ())
    }

    fn github_url(&self, owner: &str, repo: &str, path: &[&str]) -> Result<Url, ExportError> {
        let mut url =
            Url::parse(&self.github_api_url).map_err(|_| ExportError::InvalidConfiguration)?;
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| ExportError::InvalidConfiguration)?;
        segments.pop_if_empty();
        segments.extend(["repos", owner, repo]);
        segments.extend(path.iter().copied());
        drop(segments);
        Ok(url)
    }
}

fn article_branch(article_id: &str) -> String {
    format!("blog-writer/{article_id}")
}

fn valid_article_id(article_id: &str) -> bool {
    !article_id.is_empty()
        && article_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn valid_slug(slug: &str) -> bool {
    !slug.is_empty() && slug != "." && slug != ".." && !slug.contains('/') && !slug.contains('\\')
}

async fn successful_response(response: Response) -> Result<Response, ExportError> {
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(ExportError::GitHubRequest)
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };

    use base64::{Engine, engine::general_purpose::STANDARD};
    use indoc::indoc;
    use serde_json::json;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{body_json, header, method, path, query_param},
    };

    use crate::{
        config::{ExportConfig, ExportDestination, ExportFormat},
        export::handler::PublishArticleRequest,
    };

    use super::{ExportError, ExportService};

    const ARTICLE_ID: &str = "01f00000-0000-7000-8000-000000000001";
    const SLUG: &str = "sample-entry";
    const BODY: &str = indoc! {"
        ---
        title: Sample
        ---

        Body
    "};
    const FILE_PATH: &str = "posts/sample-entry.mdx";

    static NEXT_TOKEN_FILE: AtomicUsize = AtomicUsize::new(0);

    struct Fixture {
        pub github: MockServer,
        pub octo_sts: MockServer,
        pub service: ExportService,
        token_file: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.token_file);
        }
    }

    async fn fixture() -> Fixture {
        let github = MockServer::start().await;
        let octo_sts = MockServer::start().await;
        let token_file = std::env::temp_dir().join(format!(
            "blog-writer-export-token-{}-{}",
            std::process::id(),
            NEXT_TOKEN_FILE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::write(&token_file, "service-account-token\n").unwrap();
        let service = ExportService::with_github_api_url(
            ExportConfig {
                destinations: vec![destination()],
                octo_sts_url: octo_sts.uri(),
                octo_sts_identity: "writer-export".to_owned(),
                octo_sts_sa_token_path: token_file.clone(),
            },
            github.uri(),
        );

        Fixture {
            github,
            octo_sts,
            service,
            token_file,
        }
    }

    fn destination() -> ExportDestination {
        ExportDestination {
            id: "site-one".to_owned(),
            repository: "writer/notes".to_owned(),
            base_branch: "main".to_owned(),
            path_template: "posts/{slug}.mdx".to_owned(),
            format: ExportFormat::Mdx,
            frontmatter_template: "title: {{ title }}".to_owned(),
        }
    }

    fn publish_request(sha: Option<&str>) -> PublishArticleRequest {
        PublishArticleRequest {
            slug: SLUG.to_owned(),
            content: BODY.to_owned(),
            sha: sha.map(str::to_owned),
        }
    }

    async fn mock_token_exchange(fixture: &Fixture) {
        Mock::given(method("GET"))
            .and(path("/sts/exchange"))
            .and(query_param("scope", "writer/notes"))
            .and(query_param("identity", "writer-export"))
            .and(header("authorization", "Bearer service-account-token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "token": "github-installation-token"
            })))
            .expect(1)
            .mount(&fixture.octo_sts)
            .await;
    }

    fn github_auth() -> wiremock::matchers::HeaderExactMatcher {
        header("authorization", "Bearer github-installation-token")
    }

    async fn mock_pulls(fixture: &Fixture, pulls: serde_json::Value) {
        Mock::given(method("GET"))
            .and(path("/repos/writer/notes/pulls"))
            .and(query_param("state", "open"))
            .and(query_param(
                "head",
                format!("writer:blog-writer/{ARTICLE_ID}"),
            ))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(200).set_body_json(pulls))
            .expect(1)
            .mount(&fixture.github)
            .await;
    }

    async fn mock_contents_commit(fixture: &Fixture, sha: Option<&str>, status: u16) {
        let mut body = json!({
            "message": format!("Publish {FILE_PATH}"),
            "content": STANDARD.encode(BODY.as_bytes()),
            "branch": format!("blog-writer/{ARTICLE_ID}"),
        });
        if let Some(sha) = sha {
            body["sha"] = json!(sha);
        }
        Mock::given(method("PUT"))
            .and(path(format!("/repos/writer/notes/contents/{FILE_PATH}")))
            .and(body_json(body))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(status))
            .expect(1)
            .mount(&fixture.github)
            .await;
    }

    #[tokio::test]
    async fn creates_branch_commits_file_and_opens_pull_request() {
        let fixture = fixture().await;
        mock_token_exchange(&fixture).await;
        mock_pulls(&fixture, json!([])).await;
        Mock::given(method("GET"))
            .and(path("/repos/writer/notes/git/ref/heads/main"))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "object": { "sha": "base-sha" }
            })))
            .expect(1)
            .mount(&fixture.github)
            .await;
        Mock::given(method("GET"))
            .and(path(format!(
                "/repos/writer/notes/git/ref/heads/blog-writer/{ARTICLE_ID}"
            )))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(404))
            .expect(1)
            .mount(&fixture.github)
            .await;
        Mock::given(method("POST"))
            .and(path("/repos/writer/notes/git/refs"))
            .and(body_json(json!({
                "ref": format!("refs/heads/blog-writer/{ARTICLE_ID}"),
                "sha": "base-sha"
            })))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(201))
            .expect(1)
            .mount(&fixture.github)
            .await;
        mock_contents_commit(&fixture, Some("file-sha"), 200).await;
        Mock::given(method("POST"))
            .and(path("/repos/writer/notes/pulls"))
            .and(body_json(json!({
                "title": format!("Publish {SLUG}"),
                "head": format!("blog-writer/{ARTICLE_ID}"),
                "base": "main",
                "body": "Published from blog-writer."
            })))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(201).set_body_json(json!({
                "html_url": "https://github.example/writer/notes/pull/12",
                "state": "open"
            })))
            .expect(1)
            .mount(&fixture.github)
            .await;

        let actual = fixture
            .service
            .publish_article(
                &destination(),
                ARTICLE_ID,
                &publish_request(Some("file-sha")),
            )
            .await;

        assert_eq!(
            actual,
            Ok("https://github.example/writer/notes/pull/12".to_owned())
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn commits_to_an_open_pull_request_branch() {
        let fixture = fixture().await;
        mock_token_exchange(&fixture).await;
        mock_pulls(
            &fixture,
            json!([{
                "html_url": "https://github.example/writer/notes/pull/12",
                "state": "open"
            }]),
        )
        .await;
        mock_contents_commit(&fixture, Some("file-sha"), 200).await;
        Mock::given(method("POST"))
            .and(path("/repos/writer/notes/pulls"))
            .respond_with(ResponseTemplate::new(500))
            .expect(0)
            .mount(&fixture.github)
            .await;

        let actual = fixture
            .service
            .publish_article(
                &destination(),
                ARTICLE_ID,
                &publish_request(Some("file-sha")),
            )
            .await;

        assert_eq!(
            actual,
            Ok("https://github.example/writer/notes/pull/12".to_owned())
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn resets_an_existing_branch_when_no_pull_request_is_open() {
        let fixture = fixture().await;
        mock_token_exchange(&fixture).await;
        mock_pulls(&fixture, json!([])).await;
        Mock::given(method("GET"))
            .and(path("/repos/writer/notes/git/ref/heads/main"))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "object": { "sha": "base-sha" }
            })))
            .expect(1)
            .mount(&fixture.github)
            .await;
        Mock::given(method("GET"))
            .and(path(format!(
                "/repos/writer/notes/git/ref/heads/blog-writer/{ARTICLE_ID}"
            )))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "object": { "sha": "old-branch-sha" }
            })))
            .expect(1)
            .mount(&fixture.github)
            .await;
        Mock::given(method("PATCH"))
            .and(path(format!(
                "/repos/writer/notes/git/refs/heads/blog-writer/{ARTICLE_ID}"
            )))
            .and(body_json(json!({ "sha": "base-sha", "force": true })))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&fixture.github)
            .await;
        mock_contents_commit(&fixture, None, 201).await;
        Mock::given(method("POST"))
            .and(path("/repos/writer/notes/pulls"))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(201).set_body_json(json!({
                "html_url": "https://github.example/writer/notes/pull/13",
                "state": "open"
            })))
            .expect(1)
            .mount(&fixture.github)
            .await;

        let actual = fixture
            .service
            .publish_article(&destination(), ARTICLE_ID, &publish_request(None))
            .await;

        assert_eq!(
            actual,
            Ok("https://github.example/writer/notes/pull/13".to_owned())
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn returns_conflict_when_the_remote_sha_changed() {
        let fixture = fixture().await;
        mock_token_exchange(&fixture).await;
        mock_pulls(&fixture, json!([])).await;
        Mock::given(method("GET"))
            .and(path("/repos/writer/notes/git/ref/heads/main"))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "object": { "sha": "base-sha" }
            })))
            .expect(1)
            .mount(&fixture.github)
            .await;
        Mock::given(method("GET"))
            .and(path(format!(
                "/repos/writer/notes/git/ref/heads/blog-writer/{ARTICLE_ID}"
            )))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(404))
            .expect(1)
            .mount(&fixture.github)
            .await;
        Mock::given(method("POST"))
            .and(path("/repos/writer/notes/git/refs"))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(201))
            .expect(1)
            .mount(&fixture.github)
            .await;
        mock_contents_commit(&fixture, Some("stale-sha"), 409).await;
        Mock::given(method("POST"))
            .and(path("/repos/writer/notes/pulls"))
            .respond_with(ResponseTemplate::new(500))
            .expect(0)
            .mount(&fixture.github)
            .await;

        let actual = fixture
            .service
            .publish_article(
                &destination(),
                ARTICLE_ID,
                &publish_request(Some("stale-sha")),
            )
            .await;

        assert_eq!(actual, Err(ExportError::RemoteConflict));
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn returns_none_when_the_file_does_not_exist() {
        let fixture = fixture().await;
        mock_token_exchange(&fixture).await;
        mock_pulls(&fixture, json!([])).await;
        Mock::given(method("GET"))
            .and(path(format!("/repos/writer/notes/contents/{FILE_PATH}")))
            .and(query_param("ref", "main"))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(404))
            .expect(1)
            .mount(&fixture.github)
            .await;

        let actual = fixture
            .service
            .get_article_file(&destination(), ARTICLE_ID, SLUG)
            .await;

        assert_eq!(actual, Ok(None));
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn reads_existing_file_content_and_sha() {
        let fixture = fixture().await;
        mock_token_exchange(&fixture).await;
        mock_pulls(&fixture, json!([])).await;
        Mock::given(method("GET"))
            .and(path(format!("/repos/writer/notes/contents/{FILE_PATH}")))
            .and(query_param("ref", "main"))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "content": "Zm9v\n",
                "sha": "file-sha",
                "encoding": "base64"
            })))
            .expect(1)
            .mount(&fixture.github)
            .await;

        let actual = fixture
            .service
            .get_article_file(&destination(), ARTICLE_ID, SLUG)
            .await;

        assert_eq!(
            actual,
            Ok(Some(super::RemoteFile {
                content: "foo".to_owned(),
                sha: "file-sha".to_owned(),
            }))
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn reads_open_pull_request_file_from_its_branch() {
        let fixture = fixture().await;
        mock_token_exchange(&fixture).await;
        mock_pulls(
            &fixture,
            json!([{
                "html_url": "https://github.example/writer/notes/pull/12",
                "state": "open"
            }]),
        )
        .await;
        Mock::given(method("GET"))
            .and(path(format!("/repos/writer/notes/contents/{FILE_PATH}")))
            .and(query_param("ref", format!("blog-writer/{ARTICLE_ID}")))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "content": "Zm9v",
                "sha": "branch-file-sha",
                "encoding": "base64"
            })))
            .expect(1)
            .mount(&fixture.github)
            .await;

        let actual = fixture
            .service
            .get_article_file(&destination(), ARTICLE_ID, SLUG)
            .await;

        assert_eq!(
            actual,
            Ok(Some(super::RemoteFile {
                content: "foo".to_owned(),
                sha: "branch-file-sha".to_owned(),
            }))
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }
}

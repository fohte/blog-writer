mod contents;
mod ogp_json;

use std::{fs, sync::Arc, time::Duration};

use reqwest::{Client, Method, RequestBuilder, Response, StatusCode, Url};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    config::{ExportConfig, ExportDestination},
    safe_fetch::SafeFetchService,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArticleContent {
    pub slug: String,
    pub content: String,
    pub sha: Option<String>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ExportError {
    #[error("GitHub rejected the file update because the remote file changed")]
    RemoteConflict,
    #[error("octo-sts token exchange failed")]
    TokenExchange,
    #[error("octo-sts returned HTTP status {0}")]
    TokenExchangeStatus(u16),
    #[error("remote API returned HTTP status {0}")]
    HttpStatus(u16),
    #[error("HTTP client initialization failed")]
    HttpClient,
    #[error("GitHub API request failed")]
    GitHubRequest,
    #[error("GitHub API returned an invalid response")]
    InvalidResponse,
    #[error("OGP metadata task failed")]
    OgpFetchTask,
    #[error("article contains more than 50 unregistered HTTP(S) CardLink hrefs")]
    TooManyOgpHrefs,
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
    pub fn new(config: ExportConfig) -> Result<Self, ExportError> {
        Self::with_github_api_url(config, GITHUB_API_URL.to_owned())
    }

    fn with_github_api_url(
        config: ExportConfig,
        github_api_url: String,
    ) -> Result<Self, ExportError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| ExportError::HttpClient)?;

        Ok(Self {
            config,
            client,
            github_api_url,
        })
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
        validate_article_target(article_id, slug)?;
        let (owner, repo) = destination
            .repository_parts()
            .ok_or(ExportError::InvalidConfiguration)?;
        let token = self.exchange_token(owner, repo).await?;
        let branch = article_branch(article_id);
        let pull = self.find_open_pull(owner, repo, &branch, &token).await?;
        let reference = article_reference(
            pull.as_ref(),
            destination.base_branch.as_str(),
            branch.as_str(),
        );
        self.get_contents_file(destination, &destination.file_path(slug), reference, &token)
            .await
    }

    pub(crate) async fn publish_article(
        &self,
        destination: &ExportDestination,
        article_id: &str,
        request: &ArticleContent,
        safe_fetch: Arc<dyn SafeFetchService>,
    ) -> Result<String, ExportError> {
        validate_article_target(article_id, &request.slug)?;
        let (owner, repo) = destination
            .repository_parts()
            .ok_or(ExportError::InvalidConfiguration)?;
        let token = self.exchange_token(owner, repo).await?;
        let branch = article_branch(article_id);
        let pull = self.find_open_pull(owner, repo, &branch, &token).await?;

        let ogp_update = if let Some(json_path) = &destination.ogp_json_path {
            self.prepare_ogp_update(
                destination,
                json_path,
                article_reference(
                    pull.as_ref(),
                    destination.base_branch.as_str(),
                    branch.as_str(),
                ),
                request,
                &token,
            )
            .await?
        } else {
            None
        };

        if pull.is_none() {
            self.reset_branch(owner, repo, destination, &branch, &token)
                .await?;
        }

        let path = destination.file_path(&request.slug);
        self.put_contents(destination, &path, &branch, request, &token)
            .await?;

        if let Some(ogp_update) = ogp_update {
            self.commit_ogp_json(destination, &branch, &token, ogp_update, safe_fetch)
                .await?;
        }

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
                    .send_github(self.github_request(Method::POST, url, &token).json(&body))
                    .await?;
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
            .map_err(|error| match error {
                ExportError::HttpStatus(status) => ExportError::TokenExchangeStatus(status),
                _ => ExportError::TokenExchange,
            })?;
        let token_response = response
            .json::<TokenResponse>()
            .await
            .map_err(|_| ExportError::TokenExchange)?;
        if token_response.token.trim().is_empty() {
            return Err(ExportError::TokenExchange);
        }

        Ok(token_response.token)
    }

    async fn prepare_ogp_update(
        &self,
        destination: &ExportDestination,
        json_path: &str,
        reference: &str,
        request: &ArticleContent,
        token: &str,
    ) -> Result<Option<ogp_json::PreparedOgpJson>, ExportError> {
        let hrefs = ogp_json::card_link_hrefs(&request.content);
        if hrefs.is_empty() {
            return Ok(None);
        }

        self.validate_article_file(
            destination,
            &destination.file_path(&request.slug),
            reference,
            request.sha.as_deref(),
            token,
        )
        .await?;

        self.prepare_ogp_json(destination, json_path, reference, hrefs, token)
            .await
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
            .send_github(self.github_request(Method::GET, url, token))
            .await?;
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
            .send_github(self.github_request(Method::GET, url, token))
            .await?;
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
            .send_github(self.github_request(Method::POST, url, token).json(&body))
            .await?;
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
            .send_github(self.github_request(Method::PATCH, url, token).json(&body))
            .await?;
        successful_response(response).await.map(|_| ())
    }

    fn github_request(&self, method: Method, url: Url, token: &str) -> RequestBuilder {
        self.client
            .request(method, url)
            .bearer_auth(token)
            .header("Accept", GITHUB_ACCEPT)
    }

    async fn send_github(&self, request: RequestBuilder) -> Result<Response, ExportError> {
        request.send().await.map_err(|_| ExportError::GitHubRequest)
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

fn article_reference<'a>(
    pull: Option<&PullResponse>,
    base_branch: &'a str,
    branch: &'a str,
) -> &'a str {
    if pull.is_some() { branch } else { base_branch }
}

pub(super) fn validate_article_target(article_id: &str, slug: &str) -> Result<(), ExportError> {
    if valid_article_id(article_id) && valid_slug(slug) {
        Ok(())
    } else {
        Err(ExportError::InvalidInput)
    }
}

fn valid_article_id(article_id: &str) -> bool {
    !article_id.is_empty()
        && article_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && !slug.starts_with('.')
        && slug
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

async fn successful_response(response: Response) -> Result<Response, ExportError> {
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(ExportError::HttpStatus(response.status().as_u16()))
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::{
            Arc, Mutex,
            atomic::{AtomicUsize, Ordering},
        },
    };

    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use base64::{Engine, engine::general_purpose::STANDARD};
    use indoc::indoc;
    use rstest::rstest;
    use serde_json::{Map, Value, json};
    use tower::ServiceExt;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{body_json, header, method, path, query_param},
    };

    use crate::{
        app::{self, AppState},
        config::{ExportConfig, ExportDestination, ExportFormat},
        host_origin::HostOriginPolicy,
        safe_fetch::{FetchResponse, SafeFetchError, SafeFetchFuture, SafeFetchService},
    };

    use super::{ArticleContent, ExportError, ExportService};

    const ARTICLE_ID: &str = "01f00000-0000-7000-8000-000000000001";
    const ARTICLE_BRANCH: &str = "blog-writer/01f00000-0000-7000-8000-000000000001";
    const SLUG: &str = "sample-entry";
    const BODY: &str = indoc! {"
        ---
        title: Sample
        ---

        Body
    "};
    const FILE_PATH: &str = "posts/sample-entry.mdx";
    const OGP_JSON_PATH: &str = "data/link-cards.json";

    static NEXT_TOKEN_FILE: AtomicUsize = AtomicUsize::new(0);

    struct Fixture {
        pub github: MockServer,
        pub octo_sts: MockServer,
        pub service: ExportService,
        token_file: PathBuf,
    }

    struct TestFetcher {
        available: bool,
        unavailable_urls: Vec<String>,
        calls: Mutex<Vec<String>>,
    }

    impl TestFetcher {
        fn available() -> Arc<Self> {
            Arc::new(Self {
                available: true,
                unavailable_urls: vec![],
                calls: Mutex::new(Vec::new()),
            })
        }

        fn unavailable() -> Arc<Self> {
            Arc::new(Self {
                available: false,
                unavailable_urls: vec![],
                calls: Mutex::new(Vec::new()),
            })
        }

        fn with_unavailable_url(url: &str) -> Arc<Self> {
            Arc::new(Self {
                available: true,
                unavailable_urls: vec![url.to_owned()],
                calls: Mutex::new(Vec::new()),
            })
        }
    }

    impl SafeFetchService for TestFetcher {
        fn fetch<'a>(&'a self, url: &'a str) -> SafeFetchFuture<'a> {
            self.calls.lock().unwrap().push(url.to_owned());
            let response = if self.available
                && !self.unavailable_urls.iter().any(|item| item == url)
            {
                Ok(FetchResponse {
                    final_url: reqwest::Url::parse(url).unwrap(),
                    body: br#"<meta property="og:title" content="Card title"><meta property="og:description" content="Card description"><meta property="og:image" content="/card.png">"#.to_vec(),
                    content_type: Some("text/html".to_owned()),
                })
            } else {
                Err(SafeFetchError::DisallowedAddress)
            };
            Box::pin(async move { response })
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.token_file);
        }
    }

    async fn fixture() -> Fixture {
        fixture_with_destination(destination()).await
    }

    async fn fixture_with_destination(destination: ExportDestination) -> Fixture {
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
                destinations: vec![destination],
                octo_sts_url: octo_sts.uri(),
                octo_sts_identity: "writer-export".to_owned(),
                octo_sts_sa_token_path: token_file.clone(),
                images: None,
            },
            github.uri(),
        )
        .unwrap();

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
            ogp_json_path: None,
        }
    }

    fn destination_with_ogp_json() -> ExportDestination {
        ExportDestination {
            ogp_json_path: Some(OGP_JSON_PATH.to_owned()),
            ..destination()
        }
    }

    fn publish_request(sha: Option<&str>) -> ArticleContent {
        ArticleContent {
            slug: SLUG.to_owned(),
            content: BODY.to_owned(),
            sha: sha.map(str::to_owned),
        }
    }

    fn api_router(fixture: &Fixture) -> axum::Router {
        app::router(
            AppState {
                export: Some(fixture.service.clone()),
                database: None,
                ..AppState::default()
            },
            HostOriginPolicy::new(
                vec!["localhost:3000".to_owned()],
                vec!["http://localhost:3000".to_owned()],
            ),
        )
    }

    async fn response_json(response: axum::response::Response) -> (u16, serde_json::Value) {
        let status = response.status().as_u16();
        let body =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        (status, body)
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
        mock_file_commit(
            fixture,
            FILE_PATH,
            BODY,
            &format!("Publish {FILE_PATH}"),
            sha,
            status,
        )
        .await;
    }

    async fn mock_file_commit(
        fixture: &Fixture,
        file_path: &str,
        content: &str,
        message: &str,
        sha: Option<&str>,
        status: u16,
    ) {
        let mut body = json!({
            "message": message,
            "content": STANDARD.encode(content.as_bytes()),
            "branch": format!("blog-writer/{ARTICLE_ID}"),
        });
        if let Some(sha) = sha {
            body["sha"] = json!(sha);
        }
        Mock::given(method("PUT"))
            .and(path(format!("/repos/writer/notes/contents/{file_path}")))
            .and(body_json(body))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(status))
            .expect(1)
            .mount(&fixture.github)
            .await;
    }

    async fn mock_open_pull_article_commit(
        fixture: &Fixture,
        article_content: &str,
        sha: Option<&str>,
        status: u16,
    ) {
        mock_open_pull(fixture).await;
        mock_file_commit(
            fixture,
            FILE_PATH,
            article_content,
            &format!("Publish {FILE_PATH}"),
            sha,
            status,
        )
        .await;
    }

    async fn mock_open_pull(fixture: &Fixture) {
        mock_token_exchange(fixture).await;
        mock_pulls(
            fixture,
            json!([{
                "html_url": "https://github.example/writer/notes/pull/12",
                "state": "open"
            }]),
        )
        .await;
    }

    async fn mock_open_pull_article_commit_with_preflight(
        fixture: &Fixture,
        article_content: &str,
        sha: Option<&str>,
        status: u16,
    ) {
        mock_open_pull_article_commit(fixture, article_content, sha, status).await;
        mock_article_contents_read(fixture, ARTICLE_BRANCH, Some(article_content), sha).await;
    }

    async fn mock_article_contents_read(
        fixture: &Fixture,
        reference: &str,
        content: Option<&str>,
        sha: Option<&str>,
    ) {
        let response = match (content, sha) {
            (Some(content), Some(sha)) => ResponseTemplate::new(200).set_body_json(json!({
                "content": STANDARD.encode(content.as_bytes()),
                "sha": sha,
                "encoding": "base64"
            })),
            (None, None) => ResponseTemplate::new(404),
            _ => unreachable!(),
        };
        Mock::given(method("GET"))
            .and(path(format!("/repos/writer/notes/contents/{FILE_PATH}")))
            .and(query_param("ref", reference))
            .and(github_auth())
            .respond_with(response)
            .expect(1)
            .mount(&fixture.github)
            .await;
    }

    async fn mock_no_github_writes(fixture: &Fixture) {
        for request_method in ["POST", "PATCH", "PUT"] {
            Mock::given(method(request_method))
                .respond_with(ResponseTemplate::new(500))
                .expect(0)
                .mount(&fixture.github)
                .await;
        }
    }

    fn expected_ogp_content(value: serde_json::Value) -> String {
        let mut content = serde_json::to_string_pretty(&value).unwrap();
        content.push('\n');
        content
    }

    async fn mock_ogp_json_read(fixture: &Fixture, content: Option<&str>) {
        mock_ogp_json_read_for_reference(fixture, ARTICLE_BRANCH, content).await;
    }

    async fn mock_ogp_json_read_for_reference(
        fixture: &Fixture,
        reference: &str,
        content: Option<&str>,
    ) {
        let response = match content {
            Some(content) => ResponseTemplate::new(200).set_body_json(json!({
                "content": STANDARD.encode(content.as_bytes()),
                "sha": "json-sha",
                "encoding": "base64"
            })),
            None => ResponseTemplate::new(404),
        };
        Mock::given(method("GET"))
            .and(path(format!(
                "/repos/writer/notes/contents/{OGP_JSON_PATH}"
            )))
            .and(query_param("ref", reference))
            .and(github_auth())
            .respond_with(response)
            .expect(1)
            .mount(&fixture.github)
            .await;
    }

    async fn mock_ogp_json_commit(
        fixture: &Fixture,
        content: &str,
        sha: Option<&str>,
        status: u16,
    ) {
        let mut body = json!({
            "message": format!("Update {OGP_JSON_PATH}"),
            "content": STANDARD.encode(content.as_bytes()),
            "branch": ARTICLE_BRANCH,
        });
        if let Some(sha) = sha {
            body["sha"] = json!(sha);
        }
        Mock::given(method("PUT"))
            .and(path(format!(
                "/repos/writer/notes/contents/{OGP_JSON_PATH}"
            )))
            .and(body_json(body))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(status))
            .expect(1)
            .mount(&fixture.github)
            .await;
    }

    async fn mock_base_reference_and_missing_article_branch(fixture: &Fixture) {
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
    }

    #[tokio::test]
    async fn creates_branch_commits_file_and_opens_pull_request() {
        let fixture = fixture().await;
        mock_token_exchange(&fixture).await;
        mock_pulls(&fixture, json!([])).await;
        mock_base_reference_and_missing_article_branch(&fixture).await;
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
                TestFetcher::unavailable(),
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
                TestFetcher::unavailable(),
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
    async fn adds_only_missing_unique_card_links_to_the_existing_ogp_json() {
        let fixture = fixture().await;
        let fetcher = TestFetcher::available();
        let article = indoc! {r#"
            <CardLink href="https://cached.example/page" />
            <CardLink href="https://new.example/page" />
            <CardLink href="https://new.example/page" />
        "#};
        let existing = indoc! {r#"
            {
              "https://old.example/page": {
                "title": "Old title",
                "description": null,
                "image": "/old.png"
              },
              "https://cached.example/page": {
                "title": "Cached title"
              }
            }
        "#};
        let expected_json = json!({
            "https://old.example/page": {
                "title": "Old title",
                "description": null,
                "image": "/old.png"
            },
            "https://cached.example/page": {
                "title": "Cached title"
            },
            "https://new.example/page": {
                "title": "Card title",
                "description": "Card description",
                "image": "https://new.example/card.png"
            }
        });
        let expected_content = expected_ogp_content(expected_json);

        mock_open_pull_article_commit_with_preflight(&fixture, article, Some("file-sha"), 200)
            .await;
        mock_ogp_json_read(&fixture, Some(existing)).await;
        mock_ogp_json_commit(&fixture, &expected_content, Some("json-sha"), 200).await;

        let actual = fixture
            .service
            .publish_article(
                &destination_with_ogp_json(),
                ARTICLE_ID,
                &ArticleContent {
                    slug: SLUG.to_owned(),
                    content: article.to_owned(),
                    sha: Some("file-sha".to_owned()),
                },
                fetcher.clone(),
            )
            .await;

        assert_eq!(
            (actual, fetcher.calls.lock().unwrap().clone()),
            (
                Ok("https://github.example/writer/notes/pull/12".to_owned()),
                vec!["https://new.example/page".to_owned()]
            )
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn skips_ogp_json_commit_when_all_card_links_already_exist() {
        let fixture = fixture().await;
        let fetcher = TestFetcher::available();
        let article = "<CardLink href=\"https://cached.example/page\" />";
        let existing = r#"{"https://cached.example/page":{"title":"Cached title"}}"#;
        mock_open_pull_article_commit_with_preflight(&fixture, article, Some("file-sha"), 200)
            .await;
        mock_ogp_json_read(&fixture, Some(existing)).await;
        Mock::given(method("PUT"))
            .and(path(format!(
                "/repos/writer/notes/contents/{OGP_JSON_PATH}"
            )))
            .respond_with(ResponseTemplate::new(500))
            .expect(0)
            .mount(&fixture.github)
            .await;

        let actual = fixture
            .service
            .publish_article(
                &destination_with_ogp_json(),
                ARTICLE_ID,
                &ArticleContent {
                    slug: SLUG.to_owned(),
                    content: article.to_owned(),
                    sha: Some("file-sha".to_owned()),
                },
                fetcher.clone(),
            )
            .await;

        assert_eq!(
            (actual, fetcher.calls.lock().unwrap().clone()),
            (
                Ok("https://github.example/writer/notes/pull/12".to_owned()),
                vec![]
            )
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn creates_missing_ogp_json_with_empty_metadata_when_fetch_is_unavailable() {
        let fixture = fixture().await;
        let fetcher = TestFetcher::unavailable();
        let article = "<CardLink href=\"https://unavailable.example/page\" />";
        let expected_json = json!({
            "https://unavailable.example/page": {
                "title": "",
                "description": "",
                "image": ""
            }
        });
        let expected_content = expected_ogp_content(expected_json);
        mock_open_pull_article_commit_with_preflight(&fixture, article, Some("file-sha"), 200)
            .await;
        mock_ogp_json_read(&fixture, None).await;
        mock_ogp_json_commit(&fixture, &expected_content, None, 201).await;

        let actual = fixture
            .service
            .publish_article(
                &destination_with_ogp_json(),
                ARTICLE_ID,
                &ArticleContent {
                    slug: SLUG.to_owned(),
                    content: article.to_owned(),
                    sha: Some("file-sha".to_owned()),
                },
                fetcher.clone(),
            )
            .await;

        assert_eq!(
            (actual, fetcher.calls.lock().unwrap().clone()),
            (
                Ok("https://github.example/writer/notes/pull/12".to_owned()),
                vec!["https://unavailable.example/page".to_owned()]
            )
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn commits_available_and_unavailable_ogp_metadata_together() {
        let fixture = fixture().await;
        let available_url = "https://available.example/page";
        let unavailable_url = "https://unavailable.example/page";
        let fetcher = TestFetcher::with_unavailable_url(unavailable_url);
        let article = format!(
            "<CardLink href=\"{available_url}\" />\n<CardLink href=\"{unavailable_url}\" />"
        );
        let expected_json = json!({
            "https://available.example/page": {
                "title": "Card title",
                "description": "Card description",
                "image": "https://available.example/card.png"
            },
            "https://unavailable.example/page": {
                "title": "",
                "description": "",
                "image": ""
            }
        });
        let expected_content = expected_ogp_content(expected_json);
        mock_open_pull_article_commit_with_preflight(&fixture, &article, Some("file-sha"), 200)
            .await;
        mock_ogp_json_read(&fixture, None).await;
        mock_ogp_json_commit(&fixture, &expected_content, None, 201).await;

        let actual = fixture
            .service
            .publish_article(
                &destination_with_ogp_json(),
                ARTICLE_ID,
                &ArticleContent {
                    slug: SLUG.to_owned(),
                    content: article,
                    sha: Some("file-sha".to_owned()),
                },
                fetcher.clone(),
            )
            .await;
        let mut fetch_calls = fetcher.calls.lock().unwrap().clone();
        fetch_calls.sort();

        assert_eq!(
            (actual, fetch_calls),
            (
                Ok("https://github.example/writer/notes/pull/12".to_owned()),
                vec![available_url.to_owned(), unavailable_url.to_owned()]
            )
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn does_not_read_ogp_json_when_configured_article_has_no_card_links() {
        let fixture = fixture().await;
        mock_open_pull_article_commit(&fixture, BODY, Some("file-sha"), 200).await;
        Mock::given(method("GET"))
            .and(path(format!(
                "/repos/writer/notes/contents/{OGP_JSON_PATH}"
            )))
            .respond_with(ResponseTemplate::new(404))
            .expect(0)
            .mount(&fixture.github)
            .await;
        Mock::given(method("PUT"))
            .and(path(format!(
                "/repos/writer/notes/contents/{OGP_JSON_PATH}"
            )))
            .respond_with(ResponseTemplate::new(500))
            .expect(0)
            .mount(&fixture.github)
            .await;

        let fetcher = TestFetcher::available();
        let actual = fixture
            .service
            .publish_article(
                &destination_with_ogp_json(),
                ARTICLE_ID,
                &publish_request(Some("file-sha")),
                fetcher.clone(),
            )
            .await;

        assert_eq!(
            (actual, fetcher.calls.lock().unwrap().clone()),
            (
                Ok("https://github.example/writer/notes/pull/12".to_owned()),
                vec![]
            )
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn rejects_more_than_50_new_ogp_hrefs_before_writing() {
        let fixture = fixture().await;
        let article = (0..51)
            .map(|index| format!("<CardLink href=\"https://example.test/{index}\" />"))
            .collect::<Vec<_>>()
            .join("\n");
        mock_open_pull(&fixture).await;
        mock_article_contents_read(
            &fixture,
            ARTICLE_BRANCH,
            Some(article.as_str()),
            Some("file-sha"),
        )
        .await;
        mock_ogp_json_read(&fixture, Some("{}")).await;
        mock_no_github_writes(&fixture).await;

        let fetcher = TestFetcher::available();
        let actual = fixture
            .service
            .publish_article(
                &destination_with_ogp_json(),
                ARTICLE_ID,
                &ArticleContent {
                    slug: SLUG.to_owned(),
                    content: article,
                    sha: Some("file-sha".to_owned()),
                },
                fetcher.clone(),
            )
            .await;

        assert_eq!(
            (actual, fetcher.calls.lock().unwrap().clone()),
            (Err(ExportError::TooManyOgpHrefs), vec![])
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn commits_exactly_50_new_ogp_hrefs() {
        let fixture = fixture().await;
        let hrefs = (0..50)
            .map(|index| format!("https://example.test/{index}"))
            .collect::<Vec<_>>();
        let article = hrefs
            .iter()
            .map(|href| format!("<CardLink href=\"{href}\" />"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut entries = Map::new();
        for href in &hrefs {
            entries.insert(
                href.clone(),
                json!({
                    "title": "Card title",
                    "description": "Card description",
                    "image": "https://example.test/card.png"
                }),
            );
        }
        let expected_content = expected_ogp_content(Value::Object(entries));
        mock_open_pull_article_commit_with_preflight(&fixture, &article, Some("file-sha"), 200)
            .await;
        mock_ogp_json_read(&fixture, None).await;
        mock_ogp_json_commit(&fixture, &expected_content, None, 201).await;

        let fetcher = TestFetcher::available();
        let actual = fixture
            .service
            .publish_article(
                &destination_with_ogp_json(),
                ARTICLE_ID,
                &ArticleContent {
                    slug: SLUG.to_owned(),
                    content: article,
                    sha: Some("file-sha".to_owned()),
                },
                fetcher.clone(),
            )
            .await;
        let mut actual_hrefs = fetcher.calls.lock().unwrap().clone();
        actual_hrefs.sort();
        let mut expected_hrefs = hrefs;
        expected_hrefs.sort();

        assert_eq!(
            (actual, actual_hrefs),
            (
                Ok("https://github.example/writer/notes/pull/12".to_owned()),
                expected_hrefs
            )
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn publish_endpoint_returns_bad_request_for_more_than_50_new_ogp_hrefs() {
        let fixture = fixture_with_destination(destination_with_ogp_json()).await;
        let article = (0..51)
            .map(|index| format!("<CardLink href=\"https://example.test/{index}\" />"))
            .collect::<Vec<_>>()
            .join("\n");
        mock_token_exchange(&fixture).await;
        mock_pulls(
            &fixture,
            json!([{
                "html_url": "https://github.example/writer/notes/pull/12",
                "state": "open"
            }]),
        )
        .await;
        mock_article_contents_read(&fixture, ARTICLE_BRANCH, Some(&article), Some("file-sha"))
            .await;
        mock_ogp_json_read(&fixture, Some("{}")).await;
        mock_no_github_writes(&fixture).await;

        let response = api_router(&fixture)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/export/site-one/articles/{ARTICLE_ID}"))
                    .header("host", "localhost:3000")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "slug": SLUG,
                            "content": article,
                            "sha": "file-sha"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response_json(response).await,
            (
                400,
                json!({
                    "error": "Article contains more than 50 unregistered HTTP(S) CardLink hrefs"
                })
            )
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn does_not_read_ogp_json_without_a_configured_path() {
        let fixture = fixture().await;
        let fetcher = TestFetcher::available();
        let article = "<CardLink href=\"https://unconfigured.example/page\" />";
        mock_open_pull_article_commit(&fixture, article, Some("file-sha"), 200).await;
        Mock::given(method("GET"))
            .and(path(format!(
                "/repos/writer/notes/contents/{OGP_JSON_PATH}"
            )))
            .respond_with(ResponseTemplate::new(404))
            .expect(0)
            .mount(&fixture.github)
            .await;
        Mock::given(method("PUT"))
            .and(path(format!(
                "/repos/writer/notes/contents/{OGP_JSON_PATH}"
            )))
            .respond_with(ResponseTemplate::new(500))
            .expect(0)
            .mount(&fixture.github)
            .await;

        let actual = fixture
            .service
            .publish_article(
                &destination(),
                ARTICLE_ID,
                &ArticleContent {
                    slug: SLUG.to_owned(),
                    content: article.to_owned(),
                    sha: Some("file-sha".to_owned()),
                },
                fetcher.clone(),
            )
            .await;

        assert_eq!(
            (actual, fetcher.calls.lock().unwrap().clone()),
            (
                Ok("https://github.example/writer/notes/pull/12".to_owned()),
                vec![]
            )
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn does_not_read_ogp_json_when_the_article_commit_conflicts() {
        let fixture = fixture().await;
        let fetcher = TestFetcher::available();
        let article = "<CardLink href=\"https://conflict.example/page\" />";
        mock_open_pull(&fixture).await;
        mock_article_contents_read(&fixture, ARTICLE_BRANCH, Some(article), Some("current-sha"))
            .await;
        Mock::given(method("GET"))
            .and(path(format!(
                "/repos/writer/notes/contents/{OGP_JSON_PATH}"
            )))
            .respond_with(ResponseTemplate::new(404))
            .expect(0)
            .mount(&fixture.github)
            .await;
        mock_no_github_writes(&fixture).await;

        let actual = fixture
            .service
            .publish_article(
                &destination_with_ogp_json(),
                ARTICLE_ID,
                &ArticleContent {
                    slug: SLUG.to_owned(),
                    content: article.to_owned(),
                    sha: Some("stale-sha".to_owned()),
                },
                fetcher.clone(),
            )
            .await;

        assert_eq!(
            (actual, fetcher.calls.lock().unwrap().clone()),
            (Err(ExportError::RemoteConflict), vec![])
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn reports_ogp_json_commit_conflicts_as_export_errors() {
        let fixture = fixture().await;
        let fetcher = TestFetcher::available();
        let article = "<CardLink href=\"https://new.example/page\" />";
        let expected_json = json!({
            "https://new.example/page": {
                "title": "Card title",
                "description": "Card description",
                "image": "https://new.example/card.png"
            }
        });
        let expected_content = expected_ogp_content(expected_json);
        mock_open_pull_article_commit_with_preflight(&fixture, article, Some("file-sha"), 200)
            .await;
        mock_ogp_json_read(&fixture, None).await;
        mock_ogp_json_commit(&fixture, &expected_content, None, 409).await;

        let actual = fixture
            .service
            .publish_article(
                &destination_with_ogp_json(),
                ARTICLE_ID,
                &ArticleContent {
                    slug: SLUG.to_owned(),
                    content: article.to_owned(),
                    sha: Some("file-sha".to_owned()),
                },
                fetcher.clone(),
            )
            .await;

        assert_eq!(actual, Err(ExportError::HttpStatus(409)));
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[rstest]
    #[case::malformed_json("{")]
    #[case::non_object_json("[]")]
    #[tokio::test]
    async fn rejects_invalid_existing_ogp_json_without_committing(#[case] existing: &str) {
        let fixture = fixture().await;
        let fetcher = TestFetcher::available();
        let article = "<CardLink href=\"https://card.example/page\" />";
        mock_token_exchange(&fixture).await;
        mock_pulls(&fixture, json!([])).await;
        mock_article_contents_read(&fixture, "main", None, None).await;
        mock_ogp_json_read_for_reference(&fixture, "main", Some(existing)).await;
        mock_no_github_writes(&fixture).await;

        let actual = fixture
            .service
            .publish_article(
                &destination_with_ogp_json(),
                ARTICLE_ID,
                &ArticleContent {
                    slug: SLUG.to_owned(),
                    content: article.to_owned(),
                    sha: None,
                },
                fetcher.clone(),
            )
            .await;

        assert_eq!(
            (actual, fetcher.calls.lock().unwrap().clone()),
            (Err(ExportError::InvalidResponse), vec![])
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
            .publish_article(
                &destination(),
                ARTICLE_ID,
                &publish_request(None),
                TestFetcher::unavailable(),
            )
            .await;

        assert_eq!(
            actual,
            Ok("https://github.example/writer/notes/pull/13".to_owned())
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[rstest]
    #[case::sha_mismatch(409)]
    #[case::file_deleted(404)]
    #[tokio::test]
    async fn returns_conflict_when_sha_is_stale_or_the_remote_file_is_missing(#[case] status: u16) {
        let fixture = fixture().await;
        mock_token_exchange(&fixture).await;
        mock_pulls(&fixture, json!([])).await;
        mock_base_reference_and_missing_article_branch(&fixture).await;
        Mock::given(method("POST"))
            .and(path("/repos/writer/notes/git/refs"))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(201))
            .expect(1)
            .mount(&fixture.github)
            .await;
        mock_contents_commit(&fixture, Some("stale-sha"), status).await;
        Mock::given(method("POST"))
            .and(path("/repos/writer/notes/pulls"))
            .respond_with(ResponseTemplate::new(500))
            .expect(0)
            .mount(&fixture.github)
            .await;

        let response = api_router(&fixture)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/export/site-one/articles/{ARTICLE_ID}"))
                    .header("host", "localhost:3000")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "slug": SLUG,
                            "content": BODY,
                            "sha": "stale-sha"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response_json(response).await,
            (
                409,
                json!({
                    "error": "The remote file changed. Fetch its current version before publishing again."
                })
            )
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn treats_missing_sha_for_a_newly_existing_file_as_a_conflict() {
        let fixture = fixture().await;
        mock_token_exchange(&fixture).await;
        mock_pulls(&fixture, json!([])).await;
        mock_base_reference_and_missing_article_branch(&fixture).await;
        Mock::given(method("POST"))
            .and(path("/repos/writer/notes/git/refs"))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(201))
            .expect(1)
            .mount(&fixture.github)
            .await;
        mock_contents_commit(&fixture, None, 422).await;

        let actual = fixture
            .service
            .publish_article(
                &destination(),
                ARTICLE_ID,
                &publish_request(None),
                TestFetcher::unavailable(),
            )
            .await;

        assert_eq!(actual, Err(ExportError::RemoteConflict));
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[tokio::test]
    async fn preserves_validation_failure_when_sha_is_present() {
        let fixture = fixture().await;
        mock_token_exchange(&fixture).await;
        mock_pulls(&fixture, json!([])).await;
        mock_base_reference_and_missing_article_branch(&fixture).await;
        Mock::given(method("POST"))
            .and(path("/repos/writer/notes/git/refs"))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(201))
            .expect(1)
            .mount(&fixture.github)
            .await;
        mock_contents_commit(&fixture, Some("file-sha"), 422).await;
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
                TestFetcher::unavailable(),
            )
            .await;

        assert_eq!(actual, Err(ExportError::HttpStatus(422)));
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

        let response = api_router(&fixture)
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/api/export/site-one/articles/{ARTICLE_ID}?slug={SLUG}"
                    ))
                    .header("host", "localhost:3000")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response_json(response).await,
            (200, json!({ "content": null, "sha": null }))
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[rstest]
    #[case::base_branch(json!([]), "main", "file-sha")]
    #[case::open_pull_request_branch(json!([{
        "html_url": "https://github.example/writer/notes/pull/12",
        "state": "open"
    }]), ARTICLE_BRANCH, "branch-file-sha")]
    #[tokio::test]
    async fn reads_existing_file_content_and_sha(
        #[case] pulls: serde_json::Value,
        #[case] reference: &str,
        #[case] expected_sha: &str,
    ) {
        let fixture = fixture().await;
        mock_token_exchange(&fixture).await;
        mock_pulls(&fixture, pulls).await;
        Mock::given(method("GET"))
            .and(path(format!("/repos/writer/notes/contents/{FILE_PATH}")))
            .and(query_param("ref", reference))
            .and(github_auth())
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "content": "Zm9v\n",
                "sha": expected_sha,
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
                sha: expected_sha.to_owned(),
            }))
        );
        fixture.github.verify().await;
        fixture.octo_sts.verify().await;
    }

    #[rstest]
    #[case::path_traversal("../secret")]
    #[case::newline("bad\nslug")]
    #[case::dot_github(".github")]
    #[case::percent_encoded_slash("bad%2Fslug")]
    #[tokio::test]
    async fn rejects_invalid_slug_before_external_requests(#[case] slug: &str) {
        let fixture = fixture().await;
        let read_result = fixture
            .service
            .get_article_file(&destination(), ARTICLE_ID, slug)
            .await
            .map(|_| ());
        let request = ArticleContent {
            slug: slug.to_owned(),
            content: BODY.to_owned(),
            sha: None,
        };
        let publish_result = fixture
            .service
            .publish_article(
                &destination(),
                ARTICLE_ID,
                &request,
                TestFetcher::unavailable(),
            )
            .await
            .map(|_| ());
        let actual = (
            read_result,
            publish_result,
            fixture
                .octo_sts
                .received_requests()
                .await
                .unwrap_or_default()
                .len(),
            fixture
                .github
                .received_requests()
                .await
                .unwrap_or_default()
                .len(),
        );

        assert_eq!(
            actual,
            (
                Err(ExportError::InvalidInput),
                Err(ExportError::InvalidInput),
                0,
                0
            )
        );
    }

    #[tokio::test]
    async fn rejects_invalid_article_id_before_external_requests() {
        let fixture = fixture().await;
        let result = fixture
            .service
            .get_article_file(&destination(), "bad/id", SLUG)
            .await
            .map(|_| ());
        let actual = (
            result,
            fixture
                .octo_sts
                .received_requests()
                .await
                .unwrap_or_default()
                .len(),
            fixture
                .github
                .received_requests()
                .await
                .unwrap_or_default()
                .len(),
        );

        assert_eq!(actual, (Err(ExportError::InvalidInput), 0, 0));
    }
}

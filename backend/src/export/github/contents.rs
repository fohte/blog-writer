use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{Method, StatusCode};

use super::{
    ArticleContent, ContentsResponse, ExportDestination, ExportError, ExportService,
    PutContentsRequest, RemoteFile, successful_response,
};

impl ExportService {
    pub(super) async fn validate_article_file(
        &self,
        destination: &ExportDestination,
        path: &str,
        reference: &str,
        expected_sha: Option<&str>,
        token: &str,
    ) -> Result<(), ExportError> {
        let remote_file = self
            .get_contents_file(destination, path, reference, token)
            .await?;
        if remote_file.as_ref().map(|file| file.sha.as_str()) != expected_sha {
            return Err(ExportError::RemoteConflict);
        }
        Ok(())
    }

    pub(super) async fn get_contents_file(
        &self,
        destination: &ExportDestination,
        file_path: &str,
        reference: &str,
        token: &str,
    ) -> Result<Option<RemoteFile>, ExportError> {
        let (owner, repo) = destination
            .repository_parts()
            .ok_or(ExportError::InvalidConfiguration)?;
        let mut contents_path = vec!["contents"];
        contents_path.extend(file_path.split('/'));
        let mut url = self.github_url(owner, repo, &contents_path)?;
        url.query_pairs_mut().append_pair("ref", reference);
        let response = self
            .send_github(self.github_request(Method::GET, url, token))
            .await?;
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

    pub(super) async fn put_contents(
        &self,
        destination: &ExportDestination,
        path: &str,
        branch: &str,
        request: &ArticleContent,
        token: &str,
    ) -> Result<(), ExportError> {
        let result = self
            .put_raw_contents(
                destination,
                path,
                PutContentsRequest {
                    message: format!("Publish {path}"),
                    content: STANDARD.encode(request.content.as_bytes()),
                    branch,
                    sha: request.sha.as_deref(),
                },
                token,
            )
            .await;
        match result {
            Err(ExportError::HttpStatus(409)) => Err(ExportError::RemoteConflict),
            Err(ExportError::HttpStatus(422)) if request.sha.is_none() => {
                Err(ExportError::RemoteConflict)
            }
            Err(ExportError::HttpStatus(404)) if request.sha.is_some() => {
                Err(ExportError::RemoteConflict)
            }
            other => other,
        }
    }

    pub(super) async fn put_raw_contents(
        &self,
        destination: &ExportDestination,
        path: &str,
        body: PutContentsRequest<'_>,
        token: &str,
    ) -> Result<(), ExportError> {
        let (owner, repo) = destination
            .repository_parts()
            .ok_or(ExportError::InvalidConfiguration)?;
        let mut url_parts = vec!["contents"];
        url_parts.extend(path.split('/'));
        let url = self.github_url(owner, repo, &url_parts)?;
        let response = self
            .send_github(self.github_request(Method::PUT, url, token).json(&body))
            .await?;
        successful_response(response).await.map(|_| ())
    }
}

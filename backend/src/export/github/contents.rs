use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{Method, StatusCode};

use super::{
    ContentsResponse, ExportDestination, ExportError, ExportService, RemoteFile,
    successful_response,
};

impl ExportService {
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
}

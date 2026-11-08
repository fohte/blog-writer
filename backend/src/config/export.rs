use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;

use super::{ConfigError, ExportImageConfig};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportConfig {
    pub destinations: Vec<ExportDestination>,
    pub octo_sts_url: String,
    pub octo_sts_identity: String,
    pub octo_sts_sa_token_path: PathBuf,
    pub images: Option<ExportImageConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ExportDestination {
    pub id: String,
    pub repository: String,
    pub base_branch: String,
    pub path_template: String,
    pub format: ExportFormat,
    pub frontmatter_template: String,
    #[serde(default)]
    pub ogp_json_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Markdown,
    Mdx,
}

impl ExportConfig {
    pub(super) fn from_values(
        raw_destinations: Option<&str>,
        octo_sts_url: Option<&str>,
        octo_sts_identity: Option<&str>,
        octo_sts_sa_token_path: Option<&str>,
        images: Option<ExportImageConfig>,
    ) -> Result<Option<Self>, ConfigError> {
        let Some(raw_destinations) = raw_destinations else {
            return Ok(None);
        };

        let destinations: Vec<ExportDestination> = serde_json::from_str(raw_destinations)
            .map_err(|_| ConfigError::InvalidExportDestinations)?;
        validate_destinations(&destinations).map_err(|_| ConfigError::InvalidExportDestinations)?;

        let (Some(octo_sts_url), Some(octo_sts_identity), Some(octo_sts_sa_token_path)) =
            (octo_sts_url, octo_sts_identity, octo_sts_sa_token_path)
        else {
            return Err(ConfigError::MissingOctoStsConfiguration);
        };

        if octo_sts_url.trim().is_empty()
            || octo_sts_identity.trim().is_empty()
            || octo_sts_sa_token_path.trim().is_empty()
        {
            return Err(ConfigError::MissingOctoStsConfiguration);
        }

        Ok(Some(Self {
            destinations,
            octo_sts_url: octo_sts_url.to_owned(),
            octo_sts_identity: octo_sts_identity.to_owned(),
            octo_sts_sa_token_path: PathBuf::from(octo_sts_sa_token_path),
            images,
        }))
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
enum DestinationValidationError {
    #[error("at least one destination is required")]
    Empty,
    #[error("destination values must be valid")]
    InvalidValue,
    #[error("destination IDs must be unique")]
    DuplicateId,
}

fn validate_destinations(
    destinations: &[ExportDestination],
) -> Result<(), DestinationValidationError> {
    if destinations.is_empty() {
        return Err(DestinationValidationError::Empty);
    }

    for (index, destination) in destinations.iter().enumerate() {
        if destinations[..index]
            .iter()
            .any(|previous| previous.id == destination.id)
        {
            return Err(DestinationValidationError::DuplicateId);
        }
        if destination.id.trim().is_empty()
            || destination.base_branch.trim().is_empty()
            || !valid_repository(&destination.repository)
            || !valid_path_template(&destination.path_template)
            || destination
                .ogp_json_path
                .as_deref()
                .is_some_and(|path| !valid_repository_path(path))
        {
            return Err(DestinationValidationError::InvalidValue);
        }
    }

    Ok(())
}

fn valid_repository_path(path: &str) -> bool {
    !path.starts_with('/')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn valid_repository(repository: &str) -> bool {
    let mut parts = repository.split('/');
    matches!((parts.next(), parts.next(), parts.next()), (Some(owner), Some(repo), None) if !owner.is_empty() && !repo.is_empty())
}

fn valid_path_template(path_template: &str) -> bool {
    path_template.matches("{slug}").count() == 1
        && !path_template.starts_with('/')
        && path_template
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

impl ExportDestination {
    pub fn file_path(&self, slug: &str) -> String {
        self.path_template.replace("{slug}", slug)
    }

    pub fn repository_parts(&self) -> Option<(&str, &str)> {
        self.repository.split_once('/')
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::ExportConfig;
    use crate::config::{ConfigError, ExportFormat};

    const DESTINATIONS: &str = r#"[{"id":"site-one","repository":"writer/notes","base_branch":"main","path_template":"posts/{slug}.mdx","format":"mdx","frontmatter_template":"title: {{ title }}"}]"#;
    const DESTINATIONS_WITH_OGP_PATH: &str = r#"[{"id":"site-one","repository":"writer/notes","base_branch":"main","path_template":"posts/{slug}.mdx","format":"mdx","frontmatter_template":"title: {{ title }}","ogp_json_path":"data/link-cards.json"}]"#;
    const DESTINATIONS_WITH_INVALID_OGP_PATH: &str = r#"[{"id":"site-one","repository":"writer/notes","base_branch":"main","path_template":"posts/{slug}.mdx","format":"mdx","frontmatter_template":"","ogp_json_path":"../cards.json"}]"#;
    const DUPLICATE_ID_DESTINATIONS: &str = r#"[{"id":"site-one","repository":"writer/notes","base_branch":"main","path_template":"posts/{slug}.mdx","format":"mdx","frontmatter_template":""},{"id":"site-one","repository":"writer/other","base_branch":"main","path_template":"posts/{slug}.mdx","format":"mdx","frontmatter_template":""}]"#;
    const TRAVERSAL_PATH_DESTINATIONS: &str = r#"[{"id":"site-one","repository":"writer/notes","base_branch":"main","path_template":"posts/../{slug}.mdx","format":"mdx","frontmatter_template":""}]"#;
    const PATH_WITHOUT_SLUG_DESTINATIONS: &str = r#"[{"id":"site-one","repository":"writer/notes","base_branch":"main","path_template":"posts/article.mdx","format":"mdx","frontmatter_template":""}]"#;
    const PATH_WITH_MULTIPLE_SLUGS_DESTINATIONS: &str = r#"[{"id":"site-one","repository":"writer/notes","base_branch":"main","path_template":"posts/{slug}/{slug}.mdx","format":"mdx","frontmatter_template":""}]"#;
    const MALFORMED_REPOSITORY_DESTINATIONS: &str = r#"[{"id":"site-one","repository":"writer/notes/archive","base_branch":"main","path_template":"posts/{slug}.mdx","format":"mdx","frontmatter_template":""}]"#;

    #[rstest]
    #[case::disabled(None, None, None, None, Ok(None))]
    #[case::missing_sts_url(
        Some(DESTINATIONS),
        None,
        Some("writer-export"),
        Some("/var/run/token"),
        Err(ConfigError::MissingOctoStsConfiguration)
    )]
    #[case::invalid_json(
        Some("not-json"),
        Some("https://sts.example"),
        Some("writer-export"),
        Some("/var/run/token"),
        Err(ConfigError::InvalidExportDestinations)
    )]
    #[case::empty_destination_list(
        Some("[]"),
        Some("https://sts.example"),
        Some("writer-export"),
        Some("/var/run/token"),
        Err(ConfigError::InvalidExportDestinations)
    )]
    #[case::duplicate_destination_id(
        Some(DUPLICATE_ID_DESTINATIONS),
        Some("https://sts.example"),
        Some("writer-export"),
        Some("/var/run/token"),
        Err(ConfigError::InvalidExportDestinations)
    )]
    #[case::path_template_traversal(
        Some(TRAVERSAL_PATH_DESTINATIONS),
        Some("https://sts.example"),
        Some("writer-export"),
        Some("/var/run/token"),
        Err(ConfigError::InvalidExportDestinations)
    )]
    #[case::path_template_without_slug(
        Some(PATH_WITHOUT_SLUG_DESTINATIONS),
        Some("https://sts.example"),
        Some("writer-export"),
        Some("/var/run/token"),
        Err(ConfigError::InvalidExportDestinations)
    )]
    #[case::path_template_with_multiple_slugs(
        Some(PATH_WITH_MULTIPLE_SLUGS_DESTINATIONS),
        Some("https://sts.example"),
        Some("writer-export"),
        Some("/var/run/token"),
        Err(ConfigError::InvalidExportDestinations)
    )]
    #[case::malformed_repository(
        Some(MALFORMED_REPOSITORY_DESTINATIONS),
        Some("https://sts.example"),
        Some("writer-export"),
        Some("/var/run/token"),
        Err(ConfigError::InvalidExportDestinations)
    )]
    #[case::ogp_path_traversal(
        Some(DESTINATIONS_WITH_INVALID_OGP_PATH),
        Some("https://sts.example"),
        Some("writer-export"),
        Some("/var/run/token"),
        Err(ConfigError::InvalidExportDestinations)
    )]
    fn parses_export_configuration(
        #[case] destinations: Option<&str>,
        #[case] octo_sts_url: Option<&str>,
        #[case] identity: Option<&str>,
        #[case] token_path: Option<&str>,
        #[case] expected: Result<Option<ExportConfig>, ConfigError>,
    ) {
        let actual =
            ExportConfig::from_values(destinations, octo_sts_url, identity, token_path, None);

        assert_eq!(actual, expected);
    }

    #[rstest]
    #[case::without_ogp_path(DESTINATIONS, None)]
    #[case::with_ogp_path(DESTINATIONS_WITH_OGP_PATH, Some("data/link-cards.json"))]
    fn parses_valid_destination(
        #[case] raw_destinations: &str,
        #[case] ogp_json_path: Option<&str>,
    ) {
        let actual = ExportConfig::from_values(
            Some(raw_destinations),
            Some("https://sts.example"),
            Some("writer-export"),
            Some("/var/run/token"),
            None,
        );

        assert_eq!(
            actual,
            Ok(Some(ExportConfig {
                destinations: vec![super::ExportDestination {
                    id: "site-one".to_owned(),
                    repository: "writer/notes".to_owned(),
                    base_branch: "main".to_owned(),
                    path_template: "posts/{slug}.mdx".to_owned(),
                    format: ExportFormat::Mdx,
                    frontmatter_template: "title: {{ title }}".to_owned(),
                    ogp_json_path: ogp_json_path.map(str::to_owned),
                }],
                octo_sts_url: "https://sts.example".to_owned(),
                octo_sts_identity: "writer-export".to_owned(),
                octo_sts_sa_token_path: "/var/run/token".into(),
                images: None,
            }))
        );
    }
}

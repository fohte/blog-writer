use reqwest::Url;

use super::ConfigError;

const ENDPOINT_ENV: &str = "BLOG_EXPORT_IMAGE_ENDPOINT";
const BUCKET_ENV: &str = "BLOG_EXPORT_IMAGE_BUCKET";
const ACCESS_KEY_ID_ENV: &str = "BLOG_EXPORT_IMAGE_ACCESS_KEY_ID";
const SECRET_ACCESS_KEY_ENV: &str = "BLOG_EXPORT_IMAGE_SECRET_ACCESS_KEY";
const PUBLIC_URL_ENV: &str = "BLOG_EXPORT_IMAGE_PUBLIC_URL";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportImageConfig {
    pub endpoint: Url,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    /// Base URL of the published images, without a trailing slash.
    pub public_url: String,
}

impl ExportImageConfig {
    pub(super) fn from_env(
        read: impl Fn(&str) -> Result<Option<String>, ConfigError>,
    ) -> Result<Option<Self>, ConfigError> {
        let read_set = |name| Ok(read(name)?.filter(|value| !value.trim().is_empty()));
        let endpoint = read_set(ENDPOINT_ENV)?;
        let bucket = read_set(BUCKET_ENV)?;
        let access_key_id = read_set(ACCESS_KEY_ID_ENV)?;
        let secret_access_key = read_set(SECRET_ACCESS_KEY_ENV)?;
        let public_url = read_set(PUBLIC_URL_ENV)?;

        match (
            endpoint,
            bucket,
            access_key_id,
            secret_access_key,
            public_url,
        ) {
            (None, None, None, None, None) => Ok(None),
            (
                Some(endpoint),
                Some(bucket),
                Some(access_key_id),
                Some(secret_access_key),
                Some(public_url),
            ) => Ok(Some(Self {
                endpoint: http_url(&endpoint)?,
                bucket,
                access_key_id,
                secret_access_key,
                public_url: http_url(&public_url)?
                    .as_str()
                    .trim_end_matches('/')
                    .to_owned(),
            })),
            _ => Err(ConfigError::MissingExportImageConfiguration),
        }
    }
}

fn http_url(value: &str) -> Result<Url, ConfigError> {
    Url::parse(value)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https"))
        .ok_or(ConfigError::InvalidExportImageUrl)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use reqwest::Url;
    use rstest::rstest;

    use super::{
        ACCESS_KEY_ID_ENV, BUCKET_ENV, ENDPOINT_ENV, ExportImageConfig, PUBLIC_URL_ENV,
        SECRET_ACCESS_KEY_ENV,
    };
    use crate::config::ConfigError;

    fn complete() -> HashMap<&'static str, &'static str> {
        HashMap::from([
            (ENDPOINT_ENV, "https://storage.example"),
            (BUCKET_ENV, "site-assets"),
            (ACCESS_KEY_ID_ENV, "example-key"),
            (SECRET_ACCESS_KEY_ENV, "example-secret"),
            (PUBLIC_URL_ENV, "https://assets.example"),
        ])
    }

    fn parse(
        values: &HashMap<&'static str, &'static str>,
    ) -> Result<Option<ExportImageConfig>, ConfigError> {
        ExportImageConfig::from_env(|name| Ok(values.get(name).map(|value| (*value).to_owned())))
    }

    #[rstest]
    #[case::without_trailing_slash("https://assets.example")]
    #[case::with_trailing_slash("https://assets.example/")]
    fn parses_complete_configuration(#[case] public_url: &'static str) {
        let mut values = complete();
        values.insert(PUBLIC_URL_ENV, public_url);

        assert_eq!(
            parse(&values),
            Ok(Some(ExportImageConfig {
                endpoint: Url::parse("https://storage.example").unwrap(),
                bucket: "site-assets".to_owned(),
                access_key_id: "example-key".to_owned(),
                secret_access_key: "example-secret".to_owned(),
                public_url: "https://assets.example".to_owned(),
            })),
        );
    }

    #[test]
    fn is_disabled_when_nothing_is_set() {
        assert_eq!(parse(&HashMap::new()), Ok(None));
    }

    #[rstest]
    #[case::endpoint(ENDPOINT_ENV)]
    #[case::bucket(BUCKET_ENV)]
    #[case::access_key_id(ACCESS_KEY_ID_ENV)]
    #[case::secret_access_key(SECRET_ACCESS_KEY_ENV)]
    #[case::public_url(PUBLIC_URL_ENV)]
    fn rejects_partial_configuration(#[case] missing: &'static str) {
        let mut values = complete();
        values.remove(missing);

        assert_eq!(
            parse(&values),
            Err(ConfigError::MissingExportImageConfiguration),
        );
    }

    #[rstest]
    #[case::endpoint_is_not_a_url(ENDPOINT_ENV, "not a url")]
    #[case::endpoint_is_not_http(ENDPOINT_ENV, "ftp://storage.example")]
    #[case::public_url_is_relative(PUBLIC_URL_ENV, "/images")]
    fn rejects_invalid_urls(#[case] name: &'static str, #[case] value: &'static str) {
        let mut values = complete();
        values.insert(name, value);

        assert_eq!(parse(&values), Err(ConfigError::InvalidExportImageUrl));
    }
}

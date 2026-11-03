use std::{env, ffi::OsString, net::SocketAddr};

use thiserror::Error;

mod export;
pub use export::{ExportConfig, ExportDestination, ExportFormat};

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:3000";
const BIND_ADDR_ENV: &str = "BACKEND_BIND_ADDR";
const DATABASE_URL_ENV: &str = "DATABASE_URL";
const ALLOWED_HOSTS_ENV: &str = "BACKEND_ALLOWED_HOSTS";
const ALLOWED_ORIGINS_ENV: &str = "BACKEND_ALLOWED_ORIGINS";
const EXPORT_DESTINATIONS_ENV: &str = "BLOG_EXPORT_DESTINATIONS";
const OCTO_STS_URL_ENV: &str = "BLOG_EXPORT_OCTO_STS_URL";
const OCTO_STS_IDENTITY_ENV: &str = "BLOG_EXPORT_OCTO_STS_IDENTITY";
const OCTO_STS_SA_TOKEN_PATH_ENV: &str = "BLOG_EXPORT_OCTO_STS_SA_TOKEN_PATH";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub bind_addr: SocketAddr,
    pub database_url: Option<String>,
    pub allowed_hosts: Vec<String>,
    pub allowed_origins: Vec<String>,
    pub export: Option<ExportConfig>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("{BIND_ADDR_ENV} must be a valid socket address")]
    InvalidBindAddress,
    #[error("{BIND_ADDR_ENV} must contain valid Unicode")]
    NonUnicodeBindAddress,
    #[error("{DATABASE_URL_ENV} must contain valid Unicode")]
    NonUnicodeDatabaseUrl,
    #[error("{ALLOWED_HOSTS_ENV} must contain valid Unicode")]
    NonUnicodeAllowedHosts,
    #[error("{ALLOWED_ORIGINS_ENV} must contain valid Unicode")]
    NonUnicodeAllowedOrigins,
    #[error("{EXPORT_DESTINATIONS_ENV} must contain valid Unicode")]
    NonUnicodeExportDestinations,
    #[error("{OCTO_STS_URL_ENV} must contain valid Unicode")]
    NonUnicodeOctoStsUrl,
    #[error("{OCTO_STS_IDENTITY_ENV} must contain valid Unicode")]
    NonUnicodeOctoStsIdentity,
    #[error("{OCTO_STS_SA_TOKEN_PATH_ENV} must contain valid Unicode")]
    NonUnicodeOctoStsSaTokenPath,
    #[error("{EXPORT_DESTINATIONS_ENV} must be valid JSON with at least one destination")]
    InvalidExportDestinations,
    #[error(
        "all BLOG_EXPORT_OCTO_STS_* variables are required when {EXPORT_DESTINATIONS_ENV} is set"
    )]
    MissingOctoStsConfiguration,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_env_with(|name| env::var_os(name))
    }

    fn from_env_with(
        read_env_value: impl Fn(&str) -> Option<OsString>,
    ) -> Result<Self, ConfigError> {
        let value = read_env_value(BIND_ADDR_ENV)
            .map(|value| {
                value
                    .into_string()
                    .map_err(|_| ConfigError::NonUnicodeBindAddress)
            })
            .transpose()?;

        let allowed_hosts = read_env(
            ALLOWED_HOSTS_ENV,
            ConfigError::NonUnicodeAllowedHosts,
            &read_env_value,
        )?;
        let database_url = read_env(
            DATABASE_URL_ENV,
            ConfigError::NonUnicodeDatabaseUrl,
            &read_env_value,
        )?;
        let allowed_origins = read_env(
            ALLOWED_ORIGINS_ENV,
            ConfigError::NonUnicodeAllowedOrigins,
            &read_env_value,
        )?;
        let export_destinations = read_env(
            EXPORT_DESTINATIONS_ENV,
            ConfigError::NonUnicodeExportDestinations,
            &read_env_value,
        )?;
        let octo_sts_url = read_env(
            OCTO_STS_URL_ENV,
            ConfigError::NonUnicodeOctoStsUrl,
            &read_env_value,
        )?;
        let octo_sts_identity = read_env(
            OCTO_STS_IDENTITY_ENV,
            ConfigError::NonUnicodeOctoStsIdentity,
            &read_env_value,
        )?;
        let octo_sts_sa_token_path = read_env(
            OCTO_STS_SA_TOKEN_PATH_ENV,
            ConfigError::NonUnicodeOctoStsSaTokenPath,
            &read_env_value,
        )?;

        let mut config = Self::from_values(
            value.as_deref(),
            allowed_hosts.as_deref(),
            allowed_origins.as_deref(),
            export_destinations.as_deref(),
            octo_sts_url.as_deref(),
            octo_sts_identity.as_deref(),
            octo_sts_sa_token_path.as_deref(),
        )?;
        config.database_url = database_url;
        Ok(config)
    }

    pub fn from_bind_addr(value: Option<&str>) -> Result<Self, ConfigError> {
        Self::from_values(value, None, None, None, None, None, None)
    }

    fn from_values(
        bind_addr: Option<&str>,
        allowed_hosts: Option<&str>,
        allowed_origins: Option<&str>,
        export_destinations: Option<&str>,
        octo_sts_url: Option<&str>,
        octo_sts_identity: Option<&str>,
        octo_sts_sa_token_path: Option<&str>,
    ) -> Result<Self, ConfigError> {
        let bind_addr = bind_addr.unwrap_or(DEFAULT_BIND_ADDR);
        let bind_addr: SocketAddr = bind_addr
            .parse()
            .map_err(|_| ConfigError::InvalidBindAddress)?;

        let port = bind_addr.port();
        let default_hosts = format!("localhost:{port},127.0.0.1:{port},[::1]:{port}");
        let default_origins =
            format!("http://localhost:{port},http://127.0.0.1:{port},http://[::1]:{port}");

        Ok(Self {
            bind_addr,
            database_url: None,
            allowed_hosts: parse_list(allowed_hosts.unwrap_or(&default_hosts)),
            allowed_origins: parse_list(allowed_origins.unwrap_or(&default_origins)),
            export: ExportConfig::from_values(
                export_destinations,
                octo_sts_url,
                octo_sts_identity,
                octo_sts_sa_token_path,
            )?,
        })
    }
}

fn read_env(
    name: &str,
    error: ConfigError,
    read_env_value: &impl Fn(&str) -> Option<OsString>,
) -> Result<Option<String>, ConfigError> {
    read_env_value(name)
        .map(|value| value.into_string().map_err(|_| error))
        .transpose()
}

fn parse_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::{ffi::OsString, net::SocketAddr};

    use rstest::rstest;

    use super::{Config, ConfigError, DATABASE_URL_ENV};

    #[rstest]
    #[case::default(
        None,
        Ok(Config {
            bind_addr: "127.0.0.1:3000".parse::<SocketAddr>().unwrap(),
            database_url: None,
            allowed_hosts: vec![
                "localhost:3000".to_owned(),
                "127.0.0.1:3000".to_owned(),
                "[::1]:3000".to_owned(),
            ],
            allowed_origins: vec![
                "http://localhost:3000".to_owned(),
                "http://127.0.0.1:3000".to_owned(),
                "http://[::1]:3000".to_owned(),
            ],
            export: None,
        })
    )]
    #[case::configured(
        Some("0.0.0.0:8080"),
        Ok(Config {
            bind_addr: "0.0.0.0:8080".parse::<SocketAddr>().unwrap(),
            database_url: None,
            allowed_hosts: vec![
                "localhost:8080".to_owned(),
                "127.0.0.1:8080".to_owned(),
                "[::1]:8080".to_owned(),
            ],
            allowed_origins: vec![
                "http://localhost:8080".to_owned(),
                "http://127.0.0.1:8080".to_owned(),
                "http://[::1]:8080".to_owned(),
            ],
            export: None,
        })
    )]
    #[case::invalid(Some("not-an-address"), Err(ConfigError::InvalidBindAddress))]
    fn parses_bind_address(
        #[case] value: Option<&str>,
        #[case] expected: Result<Config, ConfigError>,
    ) {
        let actual = Config::from_values(value, None, None, None, None, None, None);

        assert_eq!(actual, expected);
    }

    #[test]
    fn reads_database_url_from_environment() {
        let actual = Config::from_env_with(|name| {
            (name == DATABASE_URL_ENV).then(|| OsString::from("sqlite://sample.db"))
        })
        .map(|config| config.database_url);

        assert_eq!(actual, Ok(Some("sqlite://sample.db".to_owned())));
    }

    #[rstest]
    #[case::comma_separated(
        Some("127.0.0.1:4312"),
        Some("Editor.Example, preview.example:4312"),
        Some("https://Editor.Example, http://preview.example:4312"),
        Ok(Config {
            bind_addr: "127.0.0.1:4312".parse::<SocketAddr>().unwrap(),
            database_url: None,
            allowed_hosts: vec!["Editor.Example".to_owned(), "preview.example:4312".to_owned()],
            allowed_origins: vec![
                "https://Editor.Example".to_owned(),
                "http://preview.example:4312".to_owned(),
            ],
            export: None,
        })
    )]
    #[case::empty_allow_lists(
        Some("127.0.0.1:4312"),
        Some(""),
        Some(""),
        Ok(Config {
            bind_addr: "127.0.0.1:4312".parse::<SocketAddr>().unwrap(),
            database_url: None,
            allowed_hosts: vec![],
            allowed_origins: vec![],
            export: None,
        })
    )]
    fn parses_allow_lists(
        #[case] bind_addr: Option<&str>,
        #[case] allowed_hosts: Option<&str>,
        #[case] allowed_origins: Option<&str>,
        #[case] expected: Result<Config, ConfigError>,
    ) {
        assert_eq!(
            Config::from_values(
                bind_addr,
                allowed_hosts,
                allowed_origins,
                None,
                None,
                None,
                None
            ),
            expected
        );
    }
}

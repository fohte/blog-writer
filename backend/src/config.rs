use std::{env, net::SocketAddr};

use thiserror::Error;

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:3000";
const BIND_ADDR_ENV: &str = "BACKEND_BIND_ADDR";
const ALLOWED_HOSTS_ENV: &str = "BACKEND_ALLOWED_HOSTS";
const ALLOWED_ORIGINS_ENV: &str = "BACKEND_ALLOWED_ORIGINS";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub bind_addr: SocketAddr,
    pub allowed_hosts: Vec<String>,
    pub allowed_origins: Vec<String>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("{BIND_ADDR_ENV} must be a valid socket address")]
    InvalidBindAddress,
    #[error("{BIND_ADDR_ENV} must contain valid Unicode")]
    NonUnicodeBindAddress,
    #[error("{ALLOWED_HOSTS_ENV} must contain valid Unicode")]
    NonUnicodeAllowedHosts,
    #[error("{ALLOWED_ORIGINS_ENV} must contain valid Unicode")]
    NonUnicodeAllowedOrigins,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let value = env::var_os(BIND_ADDR_ENV)
            .map(|value| {
                value
                    .into_string()
                    .map_err(|_| ConfigError::NonUnicodeBindAddress)
            })
            .transpose()?;

        let allowed_hosts = read_env(ALLOWED_HOSTS_ENV, ConfigError::NonUnicodeAllowedHosts)?;
        let allowed_origins = read_env(ALLOWED_ORIGINS_ENV, ConfigError::NonUnicodeAllowedOrigins)?;

        let mut config = Self::from_bind_addr(value.as_deref())?;
        if let Some(allowed_hosts) = allowed_hosts {
            config.allowed_hosts = parse_list(&allowed_hosts);
        }
        if let Some(allowed_origins) = allowed_origins {
            config.allowed_origins = parse_list(&allowed_origins);
        }

        Ok(config)
    }

    pub fn from_bind_addr(value: Option<&str>) -> Result<Self, ConfigError> {
        Self::from_values(value, None, None)
    }

    fn from_values(
        bind_addr: Option<&str>,
        allowed_hosts: Option<&str>,
        allowed_origins: Option<&str>,
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
            allowed_hosts: parse_list(allowed_hosts.unwrap_or(&default_hosts)),
            allowed_origins: parse_list(allowed_origins.unwrap_or(&default_origins)),
        })
    }
}

fn read_env(name: &str, error: ConfigError) -> Result<Option<String>, ConfigError> {
    env::var_os(name)
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
    use std::net::SocketAddr;

    use rstest::rstest;

    use super::{Config, ConfigError};

    #[rstest]
    #[case::default(
        None,
        Ok(Config {
            bind_addr: "127.0.0.1:3000".parse::<SocketAddr>().unwrap(),
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
        })
    )]
    #[case::configured(
        Some("0.0.0.0:8080"),
        Ok(Config {
            bind_addr: "0.0.0.0:8080".parse::<SocketAddr>().unwrap(),
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
        })
    )]
    #[case::invalid(Some("not-an-address"), Err(ConfigError::InvalidBindAddress))]
    fn parses_bind_address(
        #[case] value: Option<&str>,
        #[case] expected: Result<Config, ConfigError>,
    ) {
        let actual = Config::from_values(value, None, None);

        assert_eq!(actual, expected);
    }

    #[rstest]
    #[case::comma_separated(
        Some("127.0.0.1:4312"),
        Some("Editor.Example, preview.example:4312"),
        Some("https://Editor.Example, http://preview.example:4312"),
        Ok(Config {
            bind_addr: "127.0.0.1:4312".parse::<SocketAddr>().unwrap(),
            allowed_hosts: vec!["Editor.Example".to_owned(), "preview.example:4312".to_owned()],
            allowed_origins: vec![
                "https://Editor.Example".to_owned(),
                "http://preview.example:4312".to_owned(),
            ],
        })
    )]
    #[case::empty_allow_lists(
        Some("127.0.0.1:4312"),
        Some(""),
        Some(""),
        Ok(Config {
            bind_addr: "127.0.0.1:4312".parse::<SocketAddr>().unwrap(),
            allowed_hosts: vec![],
            allowed_origins: vec![],
        })
    )]
    fn parses_allow_lists(
        #[case] bind_addr: Option<&str>,
        #[case] allowed_hosts: Option<&str>,
        #[case] allowed_origins: Option<&str>,
        #[case] expected: Result<Config, ConfigError>,
    ) {
        assert_eq!(
            Config::from_values(bind_addr, allowed_hosts, allowed_origins),
            expected
        );
    }
}

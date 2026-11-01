use std::{env, net::SocketAddr};

use thiserror::Error;

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:3000";
const BIND_ADDR_ENV: &str = "BACKEND_BIND_ADDR";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub bind_addr: SocketAddr,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("{BIND_ADDR_ENV} must be a valid socket address")]
    InvalidBindAddress,
    #[error("{BIND_ADDR_ENV} must contain valid Unicode")]
    NonUnicodeBindAddress,
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

        Self::from_bind_addr(value.as_deref())
    }

    pub fn from_bind_addr(value: Option<&str>) -> Result<Self, ConfigError> {
        let bind_addr = value.unwrap_or(DEFAULT_BIND_ADDR);
        let bind_addr = bind_addr
            .parse()
            .map_err(|_| ConfigError::InvalidBindAddress)?;

        Ok(Self { bind_addr })
    }
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
            bind_addr: "127.0.0.1:3000".parse::<SocketAddr>().unwrap()
        })
    )]
    #[case::configured(
        Some("0.0.0.0:8080"),
        Ok(Config {
            bind_addr: "0.0.0.0:8080".parse::<SocketAddr>().unwrap()
        })
    )]
    #[case::invalid(Some("not-an-address"), Err(ConfigError::InvalidBindAddress))]
    fn parses_bind_address(
        #[case] value: Option<&str>,
        #[case] expected: Result<Config, ConfigError>,
    ) {
        let actual = Config::from_bind_addr(value);

        assert_eq!(actual, expected);
    }
}

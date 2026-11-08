use std::{
    env,
    ffi::OsString,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
};

use thiserror::Error;

mod export;
mod export_image;
mod llm;
pub use export::{ExportConfig, ExportDestination, ExportFormat};
pub use export_image::ExportImageConfig;
pub use llm::{LlmConfig, OpenAiCompatibleConfig, ProviderName};

use llm::{
    ANTHROPIC_API_KEY_ENV, LLM_API_KEY_ENV, LLM_BASE_URL_ENV, LLM_MODEL_ENV, LLM_PROVIDER_ENV,
    LLM_PROVIDER_LOCKED_ENV,
};

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:3000";
const BIND_ADDR_ENV: &str = "BACKEND_BIND_ADDR";
const DATABASE_URL_ENV: &str = "DATABASE_URL";
const LLM_API_ONLY_ENV: &str = "LLM_API_ONLY";
const ALLOWED_HOSTS_ENV: &str = "BACKEND_ALLOWED_HOSTS";
const ALLOWED_ORIGINS_ENV: &str = "BACKEND_ALLOWED_ORIGINS";
const EXPORT_DESTINATIONS_ENV: &str = "BLOG_EXPORT_DESTINATIONS";
const SYNC_DIRECTORY_ENV: &str = "BLOG_SYNC_DIRECTORY";
const OCTO_STS_URL_ENV: &str = "BLOG_EXPORT_OCTO_STS_URL";
const OCTO_STS_IDENTITY_ENV: &str = "BLOG_EXPORT_OCTO_STS_IDENTITY";
const OCTO_STS_SA_TOKEN_PATH_ENV: &str = "BLOG_EXPORT_OCTO_STS_SA_TOKEN_PATH";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub bind_addr: SocketAddr,
    pub llm_api_only: bool,
    pub database_url: Option<String>,
    pub allowed_hosts: Vec<String>,
    pub allowed_origins: Vec<String>,
    pub export: Option<ExportConfig>,
    pub sync_directory: Option<PathBuf>,
    pub llm: LlmConfig,
}

#[derive(Default)]
struct ConfigValues<'a> {
    bind_addr: Option<&'a str>,
    llm_api_only: bool,
    database_url: Option<&'a str>,
    allowed_hosts: Option<&'a str>,
    allowed_origins: Option<&'a str>,
    export_destinations: Option<&'a str>,
    octo_sts_url: Option<&'a str>,
    octo_sts_identity: Option<&'a str>,
    octo_sts_sa_token_path: Option<&'a str>,
    export_images: Option<ExportImageConfig>,
    sync_directory: Option<&'a str>,
}

#[derive(Default)]
struct LlmValues<'a> {
    provider: Option<&'a str>,
    locked: bool,
    anthropic_api_key_set: bool,
    openai_compatible: OpenAiCompatibleConfig,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("{BIND_ADDR_ENV} must be a valid socket address")]
    InvalidBindAddress,
    #[error("{BIND_ADDR_ENV} must use 127.0.0.1 when {LLM_API_ONLY_ENV} is set")]
    LlmApiOnlyRequiresLoopback,
    #[error("{BIND_ADDR_ENV} must contain valid Unicode")]
    NonUnicodeBindAddress,
    #[error("{DATABASE_URL_ENV} must contain valid Unicode")]
    NonUnicodeDatabaseUrl,
    #[error("{LLM_API_ONLY_ENV} must contain valid Unicode")]
    NonUnicodeLlmApiOnly,
    #[error("{ALLOWED_HOSTS_ENV} must contain valid Unicode")]
    NonUnicodeAllowedHosts,
    #[error("{ALLOWED_ORIGINS_ENV} must contain valid Unicode")]
    NonUnicodeAllowedOrigins,
    #[error("{EXPORT_DESTINATIONS_ENV} must contain valid Unicode")]
    NonUnicodeExportDestinations,
    #[error("{SYNC_DIRECTORY_ENV} must contain valid Unicode")]
    NonUnicodeSyncDirectory,
    #[error("{SYNC_DIRECTORY_ENV} must be a non-empty path")]
    InvalidSyncDirectory,
    #[error("{LLM_PROVIDER_ENV} must contain valid Unicode")]
    NonUnicodeLlmProvider,
    #[error("{LLM_BASE_URL_ENV} must contain valid Unicode")]
    NonUnicodeLlmBaseUrl,
    #[error("{LLM_API_KEY_ENV} must contain valid Unicode")]
    NonUnicodeLlmApiKey,
    #[error("{LLM_MODEL_ENV} must contain valid Unicode")]
    NonUnicodeLlmModel,
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
    #[error("BLOG_EXPORT_IMAGE_* variables must contain valid Unicode")]
    NonUnicodeExportImage,
    #[error("either all or none of the BLOG_EXPORT_IMAGE_* variables must be set")]
    MissingExportImageConfiguration,
    #[error(
        "BLOG_EXPORT_IMAGE_ENDPOINT and BLOG_EXPORT_IMAGE_PUBLIC_URL must be HTTP(S) URLs without a query or fragment"
    )]
    InvalidExportImageUrl,
    #[error("{LLM_PROVIDER_ENV} must name a supported provider")]
    InvalidLlmProvider,
    #[error("{LLM_API_ONLY_ENV} must be one of 1, 0, true, or false")]
    InvalidLlmApiOnly,
    #[error("{LLM_BASE_URL_ENV} is required when {LLM_PROVIDER_ENV} is openai_compatible")]
    MissingOpenAiCompatibleBaseUrl,
    #[error("{LLM_MODEL_ENV} is required when {LLM_PROVIDER_ENV} is openai_compatible")]
    MissingOpenAiCompatibleModel,
    #[error("provider-specific settings cannot be set when {LLM_PROVIDER_LOCKED_ENV} is set")]
    OtherProviderConfigurationWithLockedProvider,
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
        let database_url = read_env(
            DATABASE_URL_ENV,
            ConfigError::NonUnicodeDatabaseUrl,
            &read_env_value,
        )?;
        let llm_api_only = read_env(
            LLM_API_ONLY_ENV,
            ConfigError::NonUnicodeLlmApiOnly,
            &read_env_value,
        )?
        .map(|value| match value.to_ascii_lowercase().as_str() {
            "1" | "true" => Ok(true),
            "0" | "false" => Ok(false),
            _ => Err(ConfigError::InvalidLlmApiOnly),
        })
        .transpose()?
        .unwrap_or(false);
        let allowed_hosts = read_env(
            ALLOWED_HOSTS_ENV,
            ConfigError::NonUnicodeAllowedHosts,
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
        let sync_directory = read_env(
            SYNC_DIRECTORY_ENV,
            ConfigError::NonUnicodeSyncDirectory,
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
        let export_images = ExportImageConfig::from_env(|name| {
            read_env(name, ConfigError::NonUnicodeExportImage, &read_env_value)
        })?;
        let llm_provider = read_env(
            LLM_PROVIDER_ENV,
            ConfigError::NonUnicodeLlmProvider,
            &read_env_value,
        )?;
        let llm_provider_locked = read_env_value(LLM_PROVIDER_LOCKED_ENV).is_some();
        let llm_base_url = read_env(
            LLM_BASE_URL_ENV,
            ConfigError::NonUnicodeLlmBaseUrl,
            &read_env_value,
        )?;
        let llm_api_key = read_env(
            LLM_API_KEY_ENV,
            ConfigError::NonUnicodeLlmApiKey,
            &read_env_value,
        )?;
        let llm_model = read_env(
            LLM_MODEL_ENV,
            ConfigError::NonUnicodeLlmModel,
            &read_env_value,
        )?;
        let anthropic_api_key_set = read_env_value(ANTHROPIC_API_KEY_ENV).is_some();

        Self::from_values(
            ConfigValues {
                bind_addr: value.as_deref(),
                llm_api_only,
                database_url: database_url.as_deref(),
                allowed_hosts: allowed_hosts.as_deref(),
                allowed_origins: allowed_origins.as_deref(),
                export_destinations: export_destinations.as_deref(),
                sync_directory: sync_directory.as_deref(),
                octo_sts_url: octo_sts_url.as_deref(),
                octo_sts_identity: octo_sts_identity.as_deref(),
                octo_sts_sa_token_path: octo_sts_sa_token_path.as_deref(),
                export_images,
            },
            LlmValues {
                provider: llm_provider.as_deref(),
                locked: llm_provider_locked,
                anthropic_api_key_set,
                openai_compatible: OpenAiCompatibleConfig {
                    base_url: llm_base_url,
                    api_key: llm_api_key,
                    model: llm_model,
                },
            },
        )
    }

    pub fn from_bind_addr(value: Option<&str>) -> Result<Self, ConfigError> {
        Self::from_values(
            ConfigValues {
                bind_addr: value,
                ..ConfigValues::default()
            },
            LlmValues::default(),
        )
    }

    fn from_values(values: ConfigValues<'_>, llm: LlmValues<'_>) -> Result<Self, ConfigError> {
        let bind_addr = values.bind_addr.unwrap_or(DEFAULT_BIND_ADDR);
        let bind_addr: SocketAddr = bind_addr
            .parse()
            .map_err(|_| ConfigError::InvalidBindAddress)?;
        if values.llm_api_only && bind_addr.ip() != IpAddr::V4(Ipv4Addr::LOCALHOST) {
            return Err(ConfigError::LlmApiOnlyRequiresLoopback);
        }

        let port = bind_addr.port();
        let default_hosts = format!("localhost:{port},127.0.0.1:{port},[::1]:{port}");
        let default_origins =
            format!("http://localhost:{port},http://127.0.0.1:{port},http://[::1]:{port}");

        let sync_directory = values
            .sync_directory
            .map(|directory| {
                if directory.is_empty() {
                    Err(ConfigError::InvalidSyncDirectory)
                } else {
                    Ok(PathBuf::from(directory))
                }
            })
            .transpose()?;

        Ok(Self {
            bind_addr,
            llm_api_only: values.llm_api_only,
            database_url: values.database_url.map(str::to_owned),
            allowed_hosts: parse_list(values.allowed_hosts.unwrap_or(&default_hosts)),
            allowed_origins: parse_list(values.allowed_origins.unwrap_or(&default_origins)),
            export: ExportConfig::from_values(
                values.export_destinations,
                values.octo_sts_url,
                values.octo_sts_identity,
                values.octo_sts_sa_token_path,
                values.export_images,
            )?,
            sync_directory,
            llm: LlmConfig::from_values(
                llm.provider,
                llm.locked,
                llm.anthropic_api_key_set,
                llm.openai_compatible,
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

    use super::{
        Config, ConfigError, ConfigValues, DATABASE_URL_ENV, LLM_API_KEY_ENV, LLM_API_ONLY_ENV,
        LLM_BASE_URL_ENV, LLM_MODEL_ENV, LLM_PROVIDER_ENV, LLM_PROVIDER_LOCKED_ENV, LlmConfig,
        LlmValues, OpenAiCompatibleConfig, ProviderName, SYNC_DIRECTORY_ENV,
    };

    #[rstest]
    #[case::default(
        None,
        Ok(Config {
            bind_addr: "127.0.0.1:3000".parse::<SocketAddr>().unwrap(),
            llm_api_only: false,
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
            sync_directory: None,
            llm: LlmConfig::default(),
        })
    )]
    #[case::configured(
        Some("0.0.0.0:8080"),
        Ok(Config {
            bind_addr: "0.0.0.0:8080".parse::<SocketAddr>().unwrap(),
            llm_api_only: false,
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
            sync_directory: None,
            llm: LlmConfig::default(),
        })
    )]
    #[case::invalid(Some("not-an-address"), Err(ConfigError::InvalidBindAddress))]
    fn parses_bind_address(
        #[case] value: Option<&str>,
        #[case] expected: Result<Config, ConfigError>,
    ) {
        let actual = Config::from_values(
            ConfigValues {
                bind_addr: value,
                ..ConfigValues::default()
            },
            LlmValues::default(),
        );

        assert_eq!(actual, expected);
    }

    #[rstest]
    #[case::loopback("127.0.0.1:4312", Ok(()))]
    #[case::wildcard("0.0.0.0:4312", Err(ConfigError::LlmApiOnlyRequiresLoopback))]
    fn requires_loopback_for_llm_api_only(
        #[case] bind_addr: &str,
        #[case] expected: Result<(), ConfigError>,
    ) {
        let actual = Config::from_values(
            ConfigValues {
                bind_addr: Some(bind_addr),
                llm_api_only: true,
                ..ConfigValues::default()
            },
            LlmValues::default(),
        )
        .map(|_| ());

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
    #[case::unset(None, None)]
    #[case::configured(Some("/notes"), Some("/notes"))]
    fn reads_sync_directory_from_environment(
        #[case] value: Option<&str>,
        #[case] expected: Option<&str>,
    ) {
        let actual = Config::from_env_with(|name| {
            if name == SYNC_DIRECTORY_ENV {
                value.map(OsString::from)
            } else {
                None
            }
        })
        .map(|config| {
            config
                .sync_directory
                .map(|path| path.to_string_lossy().into_owned())
        });

        assert_eq!(actual, Ok(expected.map(str::to_owned)));
    }

    #[test]
    fn rejects_an_empty_sync_directory() {
        let actual = Config::from_env_with(|name| (name == SYNC_DIRECTORY_ENV).then(OsString::new));

        assert_eq!(actual, Err(ConfigError::InvalidSyncDirectory));
    }

    #[rstest]
    #[case::unset(None, Ok(false))]
    #[case::enabled_one(Some("1"), Ok(true))]
    #[case::enabled_true(Some("true"), Ok(true))]
    #[case::disabled_zero(Some("0"), Ok(false))]
    #[case::disabled_false(Some("false"), Ok(false))]
    #[case::invalid(Some("unexpected"), Err(ConfigError::InvalidLlmApiOnly))]
    fn reads_llm_api_only_from_environment(
        #[case] value: Option<&str>,
        #[case] expected: Result<bool, ConfigError>,
    ) {
        let actual = Config::from_env_with(|name| {
            if name == LLM_API_ONLY_ENV {
                value.map(OsString::from)
            } else {
                None
            }
        })
        .map(|config| config.llm_api_only);

        assert_eq!(actual, expected);
    }

    #[test]
    fn reads_openai_compatible_provider_settings_from_environment() {
        let actual = Config::from_env_with(|name| match name {
            LLM_PROVIDER_ENV => Some(OsString::from("openai_compatible")),
            LLM_BASE_URL_ENV => Some(OsString::from("https://api.example")),
            LLM_API_KEY_ENV => Some(OsString::new()),
            LLM_MODEL_ENV => Some(OsString::from("example-model")),
            _ => None,
        })
        .map(|config| config.llm);

        assert_eq!(
            actual,
            Ok(LlmConfig {
                provider: ProviderName::OpenAiCompatible,
                openai_compatible: OpenAiCompatibleConfig {
                    base_url: Some("https://api.example".to_owned()),
                    api_key: None,
                    model: Some("example-model".to_owned()),
                },
                ..LlmConfig::default()
            })
        );
    }

    #[rstest]
    #[case::missing_base_url(
        None,
        Some("example-model"),
        ConfigError::MissingOpenAiCompatibleBaseUrl
    )]
    #[case::empty_base_url(
        Some(""),
        Some("example-model"),
        ConfigError::MissingOpenAiCompatibleBaseUrl
    )]
    #[case::missing_model(
        Some("https://api.example"),
        None,
        ConfigError::MissingOpenAiCompatibleModel
    )]
    #[case::empty_model(
        Some("https://api.example"),
        Some(""),
        ConfigError::MissingOpenAiCompatibleModel
    )]
    fn requires_openai_compatible_base_url_and_model_at_startup(
        #[case] base_url: Option<&str>,
        #[case] model: Option<&str>,
        #[case] expected: ConfigError,
    ) {
        let actual = Config::from_env_with(|name| match name {
            LLM_PROVIDER_ENV => Some(OsString::from("openai_compatible")),
            LLM_BASE_URL_ENV => base_url.map(OsString::from),
            LLM_MODEL_ENV => model.map(OsString::from),
            _ => None,
        });

        assert_eq!(actual, Err(expected));
    }

    #[test]
    fn treats_empty_openai_compatible_settings_as_unset_when_claude_code_is_locked() {
        let actual = Config::from_env_with(|name| match name {
            LLM_PROVIDER_LOCKED_ENV | LLM_BASE_URL_ENV | LLM_API_KEY_ENV | LLM_MODEL_ENV => {
                Some(OsString::new())
            }
            _ => None,
        })
        .map(|config| config.llm);

        assert_eq!(
            actual,
            Ok(LlmConfig {
                locked: true,
                ..LlmConfig::default()
            })
        );
    }

    #[test]
    fn rejects_other_provider_environment_settings_when_provider_is_locked() {
        let actual = Config::from_env_with(|name| match name {
            LLM_PROVIDER_LOCKED_ENV => Some(OsString::new()),
            LLM_BASE_URL_ENV => Some(OsString::from("https://api.example")),
            _ => None,
        });

        assert_eq!(
            actual,
            Err(ConfigError::OtherProviderConfigurationWithLockedProvider)
        );
    }

    #[rstest]
    #[case::comma_separated(
        Some("127.0.0.1:4312"),
        Some("Editor.Example, preview.example:4312"),
        Some("https://Editor.Example, http://preview.example:4312"),
        Ok(Config {
            bind_addr: "127.0.0.1:4312".parse::<SocketAddr>().unwrap(),
            llm_api_only: false,
            database_url: None,
            allowed_hosts: vec!["Editor.Example".to_owned(), "preview.example:4312".to_owned()],
            allowed_origins: vec![
                "https://Editor.Example".to_owned(),
                "http://preview.example:4312".to_owned(),
            ],
            export: None,
            sync_directory: None,
            llm: LlmConfig::default(),
        })
    )]
    #[case::empty_allow_lists(
        Some("127.0.0.1:4312"),
        Some(""),
        Some(""),
        Ok(Config {
            bind_addr: "127.0.0.1:4312".parse::<SocketAddr>().unwrap(),
            llm_api_only: false,
            database_url: None,
            allowed_hosts: vec![],
            allowed_origins: vec![],
            export: None,
            sync_directory: None,
            llm: LlmConfig::default(),
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
                ConfigValues {
                    bind_addr,
                    allowed_hosts,
                    allowed_origins,
                    ..ConfigValues::default()
                },
                LlmValues::default(),
            ),
            expected
        );
    }

    #[rstest]
    #[case::claude_code_locked_with_openai_config(
        Some("claude_code"),
        true,
        false,
        OpenAiCompatibleConfig { base_url: Some("https://api.example".to_owned()), ..OpenAiCompatibleConfig::default() },
        Err(ConfigError::OtherProviderConfigurationWithLockedProvider)
    )]
    #[case::claude_code_unlocked_with_openai_config(
        Some("claude_code"),
        false,
        false,
        OpenAiCompatibleConfig { base_url: Some("https://api.example".to_owned()), ..OpenAiCompatibleConfig::default() },
        Ok(LlmConfig {
            openai_compatible: OpenAiCompatibleConfig {
                base_url: Some("https://api.example".to_owned()),
                ..OpenAiCompatibleConfig::default()
            },
            ..LlmConfig::default()
        })
    )]
    #[case::openai_compatible_locked_with_anthropic_key(
        Some("openai_compatible"),
        true,
        true,
        OpenAiCompatibleConfig::default(),
        Err(ConfigError::OtherProviderConfigurationWithLockedProvider)
    )]
    #[case::openai_compatible_locked_with_its_settings(
        Some("openai_compatible"),
        true,
        false,
        OpenAiCompatibleConfig {
            base_url: Some("https://api.example".to_owned()),
            api_key: Some("example-token".to_owned()),
            model: Some("example-model".to_owned()),
        },
        Ok(LlmConfig {
            provider: ProviderName::OpenAiCompatible,
            locked: true,
            anthropic_api_key_set: false,
            openai_compatible: OpenAiCompatibleConfig {
                base_url: Some("https://api.example".to_owned()),
                api_key: Some("example-token".to_owned()),
                model: Some("example-model".to_owned()),
            },
        })
    )]
    #[case::openai_compatible_with_config(
        Some("openai_compatible"),
        false,
        false,
        OpenAiCompatibleConfig { base_url: Some("https://api.example".to_owned()), api_key: Some("secret".to_owned()), model: Some("model".to_owned()) },
        Ok(LlmConfig { provider: ProviderName::OpenAiCompatible, locked: false, anthropic_api_key_set: false, openai_compatible: OpenAiCompatibleConfig { base_url: Some("https://api.example".to_owned()), api_key: Some("secret".to_owned()), model: Some("model".to_owned()) } })
    )]
    #[case::unsupported_provider(
        Some("unknown_provider"),
        false,
        false,
        OpenAiCompatibleConfig::default(),
        Err(ConfigError::InvalidLlmProvider)
    )]
    fn validates_llm_configuration(
        #[case] provider: Option<&str>,
        #[case] locked: bool,
        #[case] anthropic_api_key_set: bool,
        #[case] openai_compatible: OpenAiCompatibleConfig,
        #[case] expected: Result<LlmConfig, ConfigError>,
    ) {
        let actual = Config::from_values(
            ConfigValues::default(),
            LlmValues {
                provider,
                locked,
                anthropic_api_key_set,
                openai_compatible,
            },
        )
        .map(|config| config.llm);

        assert_eq!(actual, expected);
    }
}

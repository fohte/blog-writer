use std::str::FromStr;

use serde::Serialize;
use utoipa::ToSchema;

use super::ConfigError;

pub const LLM_PROVIDER_ENV: &str = "LLM_PROVIDER";
pub const LLM_PROVIDER_LOCKED_ENV: &str = "LLM_PROVIDER_LOCKED";
pub const LLM_BASE_URL_ENV: &str = "LLM_BASE_URL";
pub const LLM_API_KEY_ENV: &str = "LLM_API_KEY";
pub const LLM_MODEL_ENV: &str = "LLM_MODEL";
pub const ANTHROPIC_API_KEY_ENV: &str = "ANTHROPIC_API_KEY";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProviderName {
    #[default]
    ClaudeCode,
    #[serde(rename = "openai_compatible")]
    OpenAiCompatible,
}

impl FromStr for ProviderName {
    type Err = ConfigError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "claude_code" => Ok(Self::ClaudeCode),
            "openai_compatible" => Ok(Self::OpenAiCompatible),
            _ => Err(ConfigError::InvalidLlmProvider),
        }
    }
}

#[derive(Clone, Default, PartialEq, Eq)]
pub struct OpenAiCompatibleConfig {
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
}

impl std::fmt::Debug for OpenAiCompatibleConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OpenAiCompatibleConfig")
            .field("base_url", &self.base_url)
            .field("api_key", &self.api_key.as_ref().map(|_| "[REDACTED]"))
            .field("model", &self.model)
            .finish()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LlmConfig {
    pub provider: ProviderName,
    pub locked: bool,
    pub anthropic_api_key_set: bool,
    pub openai_compatible: OpenAiCompatibleConfig,
}

impl LlmConfig {
    pub(super) fn from_values(
        provider: Option<&str>,
        locked: bool,
        anthropic_api_key_set: bool,
        openai_compatible: OpenAiCompatibleConfig,
    ) -> Result<Self, ConfigError> {
        let provider = provider.map(str::parse).transpose()?.unwrap_or_default();
        let openai_compatible = openai_compatible.without_empty_values();
        let other_provider_configured = match provider {
            ProviderName::ClaudeCode => openai_compatible.is_configured(),
            ProviderName::OpenAiCompatible => anthropic_api_key_set,
        };

        if locked && other_provider_configured {
            return Err(ConfigError::OtherProviderConfigurationWithLockedProvider);
        }

        if provider == ProviderName::OpenAiCompatible {
            if openai_compatible.base_url.is_none() {
                return Err(ConfigError::MissingOpenAiCompatibleBaseUrl);
            }
            if openai_compatible.model.is_none() {
                return Err(ConfigError::MissingOpenAiCompatibleModel);
            }
        }

        Ok(Self {
            provider,
            locked,
            anthropic_api_key_set,
            openai_compatible,
        })
    }
}

impl OpenAiCompatibleConfig {
    fn without_empty_values(self) -> Self {
        Self {
            base_url: self.base_url.filter(|value| !value.is_empty()),
            api_key: self.api_key.filter(|value| !value.is_empty()),
            model: self.model.filter(|value| !value.is_empty()),
        }
    }

    fn is_configured(&self) -> bool {
        self.base_url.is_some() || self.api_key.is_some() || self.model.is_some()
    }
}

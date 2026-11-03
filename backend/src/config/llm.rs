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
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LlmConfig {
    pub provider: ProviderName,
    pub locked: bool,
    pub anthropic_api_key_set: bool,
}

impl LlmConfig {
    pub(super) fn from_values(
        provider: Option<&str>,
        locked: bool,
        other_provider_configured: bool,
        anthropic_api_key_set: bool,
    ) -> Result<Self, ConfigError> {
        let provider = match provider.unwrap_or("claude_code") {
            "claude_code" => ProviderName::ClaudeCode,
            _ => return Err(ConfigError::InvalidLlmProvider),
        };

        if locked && other_provider_configured {
            return Err(ConfigError::OtherProviderConfigurationWithLockedProvider);
        }

        Ok(Self {
            provider,
            locked,
            anthropic_api_key_set,
        })
    }
}

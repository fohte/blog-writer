pub mod app;
pub mod config;
pub mod db;
pub mod error;
mod export;
mod frontend;
pub mod health;
pub mod host_origin;
pub(crate) mod html;
#[expect(dead_code, reason = "call_to_sse has no production caller")]
mod llm;
pub mod llm_context;
pub mod ogp;
pub mod safe_fetch;
pub mod source_bodies;

use std::error::Error;
use tokio::{net::TcpListener, sync::watch};
use tracing_subscriber::EnvFilter;

use crate::{app::AppState, config::Config};

pub fn dump_openapi() -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(&app::openapi())
}

pub async fn serve(config: Config) -> Result<(), Box<dyn Error + Send + Sync>> {
    let database = initialize_database(&config).await?;
    serve_with_database(config, database).await
}

pub async fn serve_without_database(config: Config) -> Result<(), Box<dyn Error + Send + Sync>> {
    serve_with_database(config, None).await
}

async fn serve_with_database(
    config: Config,
    database: Option<sqlx::AnyPool>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    if config.llm.anthropic_api_key_set {
        tracing::warn!("ANTHROPIC_API_KEY is set; Claude Code will prefer API key authentication");
    }
    let (shutdown_sender, shutdown_receiver) = watch::channel(false);
    let state =
        AppState::new_with_shutdown(config.export, config.llm, database, shutdown_receiver)?;
    let host_origin_policy =
        host_origin::HostOriginPolicy::new(config.allowed_hosts, config.allowed_origins.clone());
    let app = if config.llm_api_only {
        app::llm_api_router(state, host_origin_policy, config.allowed_origins)
    } else {
        app::router(state, host_origin_policy)
    };
    let listener = TcpListener::bind(config.bind_addr).await?;

    tracing::info!(address = %config.bind_addr, "backend listening");
    if config.llm_api_only {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                shutdown_signal().await;
                shutdown_sender.send_replace(true);
            })
            .await?;
    } else {
        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal())
            .await?;
    }

    Ok(())
}

async fn initialize_database(config: &Config) -> Result<Option<sqlx::AnyPool>, db::DatabaseError> {
    if config.llm_api_only {
        Ok(None)
    } else {
        db::initialize(config.database_url.as_deref())
            .await
            .map(Some)
    }
}

pub fn init_tracing() -> Result<(), Box<dyn Error + Send + Sync>> {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .try_init()?;
    Ok(())
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};

        match signal(SignalKind::terminate()) {
            Ok(mut terminate) => {
                tokio::select! {
                    result = tokio::signal::ctrl_c() => {
                        if let Err(error) = result {
                            tracing::error!(%error, "failed to listen for Ctrl-C");
                        }
                    }
                    _ = terminate.recv() => {}
                }
            }
            Err(error) => {
                tracing::error!(%error, "failed to listen for SIGTERM");
                if let Err(error) = tokio::signal::ctrl_c().await {
                    tracing::error!(%error, "failed to listen for Ctrl-C");
                }
            }
        }
    }

    #[cfg(not(unix))]
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::error!(%error, "failed to listen for Ctrl-C");
    }
}

#[cfg(test)]
mod tests {
    use crate::config::Config;

    use super::initialize_database;

    #[tokio::test]
    async fn skips_database_initialization_in_llm_api_only_mode() {
        let mut config = Config::from_bind_addr(None).expect("default config is valid");
        config.llm_api_only = true;

        let actual = initialize_database(&config)
            .await
            .map(|database| database.is_none())
            .map_err(|error| error.to_string());

        assert_eq!(actual, Ok(true));
    }
}

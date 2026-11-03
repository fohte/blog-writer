pub mod app;
pub mod config;
pub mod db;
pub mod error;
mod export;
mod frontend;
pub mod health;
pub mod host_origin;
#[expect(dead_code, reason = "call_to_sse has no production caller")]
mod llm;
pub mod llm_context;
pub mod ogp;
pub mod safe_fetch;
pub(crate) mod write_from_key_points;

use std::error::Error;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

use crate::{app::AppState, config::Config};

pub fn dump_openapi() -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(&app::openapi())
}

pub async fn serve(config: Config) -> Result<(), Box<dyn Error + Send + Sync>> {
    let database = db::initialize(config.database_url.as_deref()).await?;
    serve_with_database(config, Some(database)).await
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
    let state = AppState::new(config.export, config.llm, database)?;
    let host_origin_policy =
        host_origin::HostOriginPolicy::new(config.allowed_hosts, config.allowed_origins);
    let app = app::router(state, host_origin_policy);
    let listener = TcpListener::bind(config.bind_addr).await?;

    tracing::info!(address = %config.bind_addr, "backend listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
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

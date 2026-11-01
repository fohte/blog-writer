pub mod app;
pub mod config;
pub mod error;
mod frontend;
pub mod health;

use std::error::Error;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

use crate::{app::AppState, config::Config};

pub fn dump_openapi() -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(&app::openapi())
}

pub async fn serve(config: Config) -> Result<(), Box<dyn Error + Send + Sync>> {
    let state = AppState::default();
    let app = app::router(state);
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

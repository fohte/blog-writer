pub mod app;
pub mod config;
pub mod db;
pub mod error;
mod export;
mod frontend;
pub mod health;
pub mod host_origin;
pub(crate) mod html;
pub(crate) mod images;
#[expect(dead_code, reason = "LLM call helpers have no production callers yet")]
mod llm;
pub mod llm_context;
pub mod local_file_sync;
pub mod ogp;
pub(crate) mod proposal_body_request;
pub(crate) mod proposal_outline;
pub(crate) mod proposal_premise;
pub(crate) mod proposal_transition;
pub(crate) mod research_claim_evidence;
pub(crate) mod research_key_points;
pub mod safe_fetch;
pub mod source_bodies;
pub(crate) mod source_quote;
pub mod sync;
pub(crate) mod write_from_key_points;

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
    if config.llm.provider == config::ProviderName::ClaudeCode && config.llm.anthropic_api_key_set {
        tracing::warn!("ANTHROPIC_API_KEY is set; Claude Code will prefer API key authentication");
    }
    let (shutdown_sender, shutdown_receiver) = watch::channel(false);
    let llm_api_only = config.llm_api_only;
    let host_origin_policy = host_origin::HostOriginPolicy::new(
        config.allowed_hosts.clone(),
        config.allowed_origins.clone(),
    );
    let state = AppState::new_with_shutdown(
        config.export,
        config.llm,
        database,
        config.sync_directory,
        shutdown_receiver,
    )?;
    if let Some(file_sync) = &state.file_sync {
        file_sync.start().await?;
    }
    let app = app_for_config(state, llm_api_only, host_origin_policy);
    let listener = TcpListener::bind(config.bind_addr).await?;

    tracing::info!(address = %config.bind_addr, "backend listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            shutdown_sender.send_replace(true);
        })
        .await?;

    Ok(())
}

fn app_for_config(
    state: AppState,
    llm_api_only: bool,
    host_origin_policy: host_origin::HostOriginPolicy,
) -> axum::Router {
    if llm_api_only {
        app::llm_api_router(state, host_origin_policy)
    } else {
        app::router(state, host_origin_policy)
    }
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
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use crate::{app::AppState, config::Config};

    use super::{app_for_config, initialize_database};

    #[tokio::test]
    async fn api_only_config_selects_only_the_llm_router() {
        let mut config = Config::from_bind_addr(None).expect("default config is valid");
        config.llm_api_only = true;
        let host_origin_policy = crate::host_origin::HostOriginPolicy::new(
            config.allowed_hosts.clone(),
            config.allowed_origins.clone(),
        );
        let router = app_for_config(AppState::default(), config.llm_api_only, host_origin_policy);
        let mut actual = Vec::new();

        for uri in ["/api/health", "/"] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(uri)
                        .header("host", "127.0.0.1:3000")
                        .body(Body::empty())
                        .expect("request is valid"),
                )
                .await
                .expect("router responds");
            let status = response.status().as_u16();
            let body: Value = serde_json::from_slice(
                &to_bytes(response.into_body(), usize::MAX)
                    .await
                    .expect("response body is readable"),
            )
            .expect("response body is JSON");
            actual.push((status, body));
        }

        assert_eq!(
            actual,
            vec![
                (404, json!({"error": "Not Found"})),
                (404, json!({"error": "Not Found"})),
            ]
        );
    }

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

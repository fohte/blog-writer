use std::convert::Infallible;

use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::stream;
use tokio::sync::mpsc;

use crate::{
    app::AppState,
    error::{ApiJson, AppError, ErrorResponse},
    llm::{LlmErrorPayload, LlmEvent, LlmProgress},
};

use super::{model::ResearchJobRequest, pipeline};

#[utoipa::path(
    post,
    path = "/research/jobs",
    operation_id = "run_research_job",
    request_body = ResearchJobRequest,
    responses(
        (status = 200, description = "Research progress and source-backed result", content_type = "text/event-stream", body = super::model::ResearchJobEvent),
        (status = 400, description = "Invalid request body", body = ErrorResponse)
    )
)]
pub(crate) async fn run_research_job(
    State(app_state): State<AppState>,
    ApiJson(request): ApiJson<ResearchJobRequest>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, AppError> {
    let (progress_sender, progress_receiver) = mpsc::unbounded_channel();
    let keep_alive_interval = app_state.llm.keep_alive_interval;
    let future = pipeline::start(app_state.llm.clone(), app_state, request, progress_sender);
    let events = stream::unfold(
        ResearchJobStream {
            future,
            progress_receiver,
            progress_closed: false,
            finished: false,
        },
        |mut state| async move {
            if state.finished {
                return None;
            }
            loop {
                let event = tokio::select! {
                    biased;
                    query = state.progress_receiver.recv(), if !state.progress_closed => {
                        match query {
                            Some(query) => Some(LlmEvent::Progress(LlmProgress { query })),
                            None => {
                                state.progress_closed = true;
                                continue;
                            }
                        }
                    }
                    result = &mut state.future => {
                        state.finished = true;
                        Some(match result {
                            Ok(result) => match serde_json::to_value(result) {
                                Ok(result) => LlmEvent::Result(result),
                                Err(_) => LlmEvent::Error(LlmErrorPayload {
                                    message: "LLM result could not be serialized".to_owned(),
                                }),
                            },
                            Err(error) => LlmEvent::Error(LlmErrorPayload {
                                message: error.to_string(),
                            }),
                        })
                    }
                };
                if let Some(event) = event {
                    return Some((Ok(event.into_sse_event()), state));
                }
            }
        },
    );

    Ok(Sse::new(events).keep_alive(
        KeepAlive::new()
            .interval(keep_alive_interval)
            .text("keep-alive"),
    ))
}

struct ResearchJobStream {
    future: pipeline::JobFuture,
    progress_receiver: mpsc::UnboundedReceiver<String>,
    progress_closed: bool,
    finished: bool,
}

use std::convert::Infallible;

use axum::{
    extract::State,
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::stream;
use tokio::sync::mpsc;

use crate::{
    app::AppState,
    error::{ApiJson, AppError, ErrorResponse},
    llm::{LlmErrorPayload, sse_event},
};

use super::{
    model::{ResearchJobEvent, ResearchJobProgress, ResearchJobRequest},
    pipeline,
};

#[utoipa::path(
    post,
    path = "/research/jobs",
    operation_id = "run_research_job",
    request_body = ResearchJobRequest,
    responses(
        (status = 200, description = "Research progress and source-backed result", content_type = "text/event-stream", body = super::model::ResearchJobEvent),
        (status = 400, description = "Invalid request body or blank question or claim", body = ErrorResponse)
    )
)]
pub(crate) async fn run_research_job(
    State(app_state): State<AppState>,
    ApiJson(request): ApiJson<ResearchJobRequest>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, AppError> {
    let request = validate_request(request)?;
    let (progress_sender, progress_receiver) = mpsc::unbounded_channel();
    let keep_alive_interval = app_state.llm.keep_alive_interval;
    let future = pipeline::start(app_state, request, progress_sender);
    let events = stream::unfold(
        ResearchJobStream {
            future,
            progress_receiver,
            progress_closed: false,
            outcome: None,
            finished: false,
        },
        |mut state| async move {
            if state.finished {
                return None;
            }
            loop {
                // The job can finish in the same poll that queued its last progress.
                if let Some(outcome) = state.outcome.take() {
                    let event = match state.progress_receiver.try_recv() {
                        Ok(progress) => {
                            state.outcome = Some(outcome);
                            ResearchJobEvent::Progress(progress)
                        }
                        Err(_) => {
                            state.finished = true;
                            outcome
                        }
                    };
                    return Some((Ok(sse_event(&event)), state));
                }
                let event = tokio::select! {
                    biased;
                    progress = state.progress_receiver.recv(), if !state.progress_closed => {
                        match progress {
                            Some(progress) => ResearchJobEvent::Progress(progress),
                            None => {
                                state.progress_closed = true;
                                continue;
                            }
                        }
                    }
                    result = &mut state.future => {
                        state.outcome = Some(match result {
                            Ok(result) => ResearchJobEvent::Result(result),
                            Err(error) => {
                                tracing::warn!(error_kind = ?error, "research job failed");
                                ResearchJobEvent::Error(LlmErrorPayload::from(&error))
                            }
                        });
                        continue;
                    }
                };
                return Some((Ok(sse_event(&event)), state));
            }
        },
    );

    Ok(Sse::new(events).keep_alive(
        KeepAlive::new()
            .interval(keep_alive_interval)
            .text("keep-alive"),
    ))
}

fn validate_request(request: ResearchJobRequest) -> Result<ResearchJobRequest, AppError> {
    let message = "Question or claim must not be empty";
    let client_error = || AppError::Client {
        status: StatusCode::BAD_REQUEST,
        message: message.to_owned(),
    };
    match request {
        ResearchJobRequest::KeyPoints { question } => {
            let question = question.trim().to_owned();
            if question.is_empty() {
                return Err(client_error());
            }
            Ok(ResearchJobRequest::KeyPoints { question })
        }
        ResearchJobRequest::ClaimEvidence {
            claim,
            before,
            after,
        } => {
            let claim = claim.trim().to_owned();
            if claim.is_empty() {
                return Err(client_error());
            }
            Ok(ResearchJobRequest::ClaimEvidence {
                claim,
                before,
                after,
            })
        }
    }
}

struct ResearchJobStream {
    future: pipeline::JobFuture,
    progress_receiver: mpsc::UnboundedReceiver<ResearchJobProgress>,
    progress_closed: bool,
    outcome: Option<ResearchJobEvent>,
    finished: bool,
}

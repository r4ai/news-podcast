#![forbid(unsafe_code)]

use std::{collections::HashMap, sync::Arc};

use async_trait::async_trait;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, post},
};
use sandbox_protocol::{
    CheckpointResponse, CreateSessionRequest, CreateSessionResponse, ExecRequest, ExecResponse,
};
use serde::Serialize;
use thiserror::Error;
use tokio::sync::RwLock;

#[derive(Debug, Error)]
pub enum BackendError {
    #[error("sandbox profile is not configured")]
    ProfileNotConfigured,
    #[error("sandbox session was not found")]
    NotFound,
    #[error("sandbox backend failed")]
    Failed,
}

#[async_trait]
pub trait SandboxBackend: Send + Sync + 'static {
    async fn create(
        &self,
        request: CreateSessionRequest,
    ) -> Result<CreateSessionResponse, BackendError>;
    async fn exec(
        &self,
        session_id: &str,
        request: ExecRequest,
    ) -> Result<ExecResponse, BackendError>;
    async fn checkpoint(&self, session_id: &str) -> Result<CheckpointResponse, BackendError>;
    async fn destroy(&self, session_id: &str) -> Result<(), BackendError>;
}

#[derive(Clone)]
struct AppState {
    token: Arc<str>,
    backend: Arc<dyn SandboxBackend>,
}

pub fn router(token: String, backend: Arc<dyn SandboxBackend>) -> Router {
    Router::new()
        .route("/v1/sessions", post(create_session))
        .route("/v1/sessions/{session_id}", delete(destroy_session))
        .route("/v1/sessions/{session_id}/exec", post(exec))
        .route("/v1/sessions/{session_id}/checkpoint", post(checkpoint))
        .with_state(AppState {
            token: token.into(),
            backend,
        })
}

async fn create_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateSessionRequest>,
) -> Result<Json<CreateSessionResponse>, ApiError> {
    authorize(&headers, &state.token)?;
    request.validate().map_err(|_| ApiError::InvalidRequest)?;
    Ok(Json(state.backend.create(request).await?))
}

async fn exec(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Json(request): Json<ExecRequest>,
) -> Result<Json<ExecResponse>, ApiError> {
    authorize(&headers, &state.token)?;
    request.validate().map_err(|_| ApiError::InvalidRequest)?;
    Ok(Json(state.backend.exec(&session_id, request).await?))
}

async fn checkpoint(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> Result<Json<CheckpointResponse>, ApiError> {
    authorize(&headers, &state.token)?;
    Ok(Json(state.backend.checkpoint(&session_id).await?))
}

async fn destroy_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    authorize(&headers, &state.token)?;
    state.backend.destroy(&session_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

fn authorize(headers: &HeaderMap, token: &str) -> Result<(), ApiError> {
    let expected = format!("Bearer {token}");
    if headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        == Some(&expected)
    {
        Ok(())
    } else {
        Err(ApiError::Unauthorized)
    }
}

#[derive(Debug)]
enum ApiError {
    Unauthorized,
    InvalidRequest,
    Backend(BackendError),
}

impl From<BackendError> for ApiError {
    fn from(value: BackendError) -> Self {
        Self::Backend(value)
    }
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match self {
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Self::InvalidRequest => (StatusCode::BAD_REQUEST, "invalid_request"),
            Self::Backend(BackendError::NotFound) => (StatusCode::NOT_FOUND, "not_found"),
            Self::Backend(BackendError::ProfileNotConfigured) => {
                (StatusCode::SERVICE_UNAVAILABLE, "sandbox_unavailable")
            }
            Self::Backend(BackendError::Failed) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "sandbox_failed")
            }
        };
        (status, Json(ErrorBody { code })).into_response()
    }
}

/// Test/development backend. Production startup deliberately does not select it.
#[derive(Default)]
pub struct InMemoryBackend {
    sessions: RwLock<HashMap<String, CreateSessionRequest>>,
}

#[async_trait]
impl SandboxBackend for InMemoryBackend {
    async fn create(
        &self,
        request: CreateSessionRequest,
    ) -> Result<CreateSessionResponse, BackendError> {
        let id = uuid::Uuid::new_v4().to_string();
        self.sessions.write().await.insert(id.clone(), request);
        Ok(CreateSessionResponse {
            id,
            state: sandbox_protocol::SessionState::Ready,
        })
    }

    async fn exec(
        &self,
        session_id: &str,
        _request: ExecRequest,
    ) -> Result<ExecResponse, BackendError> {
        if !self.sessions.read().await.contains_key(session_id) {
            return Err(BackendError::NotFound);
        }
        Ok(ExecResponse {
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
            truncated: false,
        })
    }

    async fn checkpoint(&self, session_id: &str) -> Result<CheckpointResponse, BackendError> {
        if !self.sessions.read().await.contains_key(session_id) {
            return Err(BackendError::NotFound);
        }
        Ok(CheckpointResponse {
            object_key: format!("checkpoints/{session_id}.tar.zst"),
        })
    }

    async fn destroy(&self, session_id: &str) -> Result<(), BackendError> {
        self.sessions
            .write()
            .await
            .remove(session_id)
            .map(|_| ())
            .ok_or(BackendError::NotFound)
    }
}

/// Secure default until a Firecracker/Jailer profile is explicitly configured.
pub struct UnconfiguredFirecrackerBackend;

#[async_trait]
impl SandboxBackend for UnconfiguredFirecrackerBackend {
    async fn create(
        &self,
        _request: CreateSessionRequest,
    ) -> Result<CreateSessionResponse, BackendError> {
        Err(BackendError::ProfileNotConfigured)
    }
    async fn exec(
        &self,
        _session_id: &str,
        _request: ExecRequest,
    ) -> Result<ExecResponse, BackendError> {
        Err(BackendError::ProfileNotConfigured)
    }
    async fn checkpoint(&self, _session_id: &str) -> Result<CheckpointResponse, BackendError> {
        Err(BackendError::ProfileNotConfigured)
    }
    async fn destroy(&self, _session_id: &str) -> Result<(), BackendError> {
        Err(BackendError::ProfileNotConfigured)
    }
}

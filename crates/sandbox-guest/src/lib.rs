#![forbid(unsafe_code)]

use std::{path::Path, process::Stdio, time::Duration};

use sandbox_protocol::{ExecRequest, ExecResponse, ValidationError};
use thiserror::Error;
use tokio::{process::Command, time::timeout};

#[derive(Debug, Error)]
pub enum GuestExecError {
    #[error(transparent)]
    InvalidRequest(#[from] ValidationError),
    #[error("working directory is unavailable")]
    WorkingDirectoryUnavailable,
    #[error("command timed out")]
    Timeout,
    #[error("command execution failed")]
    Execution,
}

pub async fn execute(
    request: &ExecRequest,
    output_limit: usize,
) -> Result<ExecResponse, GuestExecError> {
    request.validate()?;
    if !Path::new(&request.working_directory).is_dir() {
        return Err(GuestExecError::WorkingDirectoryUnavailable);
    }
    let mut command = Command::new(&request.command[0]);
    command
        .args(&request.command[1..])
        .current_dir(&request.working_directory)
        .env_clear()
        .env("PATH", "/usr/local/bin:/usr/bin:/bin")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = timeout(
        Duration::from_secs(u64::from(request.timeout_seconds)),
        command.output(),
    )
    .await
    .map_err(|_| GuestExecError::Timeout)?
    .map_err(|_| GuestExecError::Execution)?;
    let total = output.stdout.len().saturating_add(output.stderr.len());
    Ok(ExecResponse {
        exit_code: output.status.code().unwrap_or(128),
        stdout: truncate_utf8(&output.stdout, output_limit),
        stderr: truncate_utf8(&output.stderr, output_limit),
        truncated: total > output_limit,
    })
}

fn truncate_utf8(value: &[u8], limit: usize) -> String {
    String::from_utf8_lossy(&value[..value.len().min(limit)]).into_owned()
}

#[cfg(test)]
mod tests {
    use sandbox_protocol::PROTOCOL_VERSION;

    use super::*;

    #[tokio::test]
    async fn rejects_execution_outside_the_workspace() {
        let request = ExecRequest {
            protocol_version: PROTOCOL_VERSION.into(),
            command: vec!["printf".into(), "literal;$HOME".into()],
            working_directory: "/etc".into(),
            timeout_seconds: 2,
        };
        assert!(matches!(
            execute(&request, 7).await,
            Err(GuestExecError::InvalidRequest(
                ValidationError::InvalidWorkingDirectory
            ))
        ));
        assert_eq!(truncate_utf8(b"literal;$HOME", 7), "literal");
    }
}

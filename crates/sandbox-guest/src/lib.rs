#![forbid(unsafe_code)]

use std::{
    path::Path,
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use sandbox_protocol::{ExecRequest, ExecResponse, ValidationError};
use thiserror::Error;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    time::timeout,
};

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
    let mut child = command.spawn().map_err(|_| GuestExecError::Execution)?;
    let stdout = child.stdout.take().ok_or(GuestExecError::Execution)?;
    let stderr = child.stderr.take().ok_or(GuestExecError::Execution)?;
    let budget = Arc::new(AtomicUsize::new(output_limit));
    let (status, stdout, stderr) = timeout(
        Duration::from_secs(u64::from(request.timeout_seconds)),
        async {
            tokio::join!(
                child.wait(),
                capture_output(stdout, Arc::clone(&budget)),
                capture_output(stderr, budget)
            )
        },
    )
    .await
    .map_err(|_| GuestExecError::Timeout)?;
    let status = status.map_err(|_| GuestExecError::Execution)?;
    let stdout = stdout?;
    let stderr = stderr?;
    Ok(ExecResponse {
        exit_code: status.code().unwrap_or(128),
        stdout: String::from_utf8_lossy(&stdout.bytes).into_owned(),
        stderr: String::from_utf8_lossy(&stderr.bytes).into_owned(),
        truncated: stdout.total.saturating_add(stderr.total) > output_limit,
    })
}

struct CapturedOutput {
    bytes: Vec<u8>,
    total: usize,
}

async fn capture_output(
    mut reader: impl AsyncRead + Unpin,
    budget: Arc<AtomicUsize>,
) -> Result<CapturedOutput, GuestExecError> {
    let mut bytes = Vec::new();
    let mut total = 0usize;
    let mut chunk = [0u8; 8 * 1024];
    loop {
        let count = reader
            .read(&mut chunk)
            .await
            .map_err(|_| GuestExecError::Execution)?;
        if count == 0 {
            break;
        }
        total = total.saturating_add(count);
        let mut remaining = budget.load(Ordering::Relaxed);
        while remaining > 0 {
            let retained = remaining.min(count);
            match budget.compare_exchange_weak(
                remaining,
                remaining - retained,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => {
                    bytes.extend_from_slice(&chunk[..retained]);
                    break;
                }
                Err(actual) => remaining = actual,
            }
        }
    }
    Ok(CapturedOutput { bytes, total })
}

#[cfg(test)]
mod tests {
    use sandbox_protocol::PROTOCOL_VERSION;
    use tokio::io::AsyncWriteExt;

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
    }

    #[tokio::test]
    async fn drains_output_while_retaining_only_the_shared_budget() {
        let budget = Arc::new(AtomicUsize::new(7));
        let (mut stdout_writer, stdout_reader) = tokio::io::duplex(32);
        let (mut stderr_writer, stderr_reader) = tokio::io::duplex(32);
        let writer = async move {
            stdout_writer.write_all(b"stdout-data").await.unwrap();
            stderr_writer.write_all(b"stderr-data").await.unwrap();
        };

        let (_, stdout, stderr) = tokio::join!(
            writer,
            capture_output(stdout_reader, Arc::clone(&budget)),
            capture_output(stderr_reader, budget)
        );
        let stdout = stdout.unwrap();
        let stderr = stderr.unwrap();

        assert_eq!(stdout.total, 11);
        assert_eq!(stderr.total, 11);
        assert_eq!(stdout.bytes.len() + stderr.bytes.len(), 7);
    }
}

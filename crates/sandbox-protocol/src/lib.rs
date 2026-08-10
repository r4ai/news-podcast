#![forbid(unsafe_code)]

use std::path::{Component, Path};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const PROTOCOL_VERSION: &str = "v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SandboxLimits {
    pub vcpu_count: u8,
    pub memory_mib: u32,
    pub disk_mib: u32,
    pub wall_time_seconds: u32,
    pub output_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateSessionRequest {
    pub protocol_version: String,
    pub run_id: String,
    pub profile: String,
    pub limits: SandboxLimits,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateSessionResponse {
    pub id: String,
    pub state: SessionState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Ready,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecRequest {
    pub protocol_version: String,
    pub command: Vec<String>,
    pub working_directory: String,
    pub timeout_seconds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecResponse {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CheckpointResponse {
    pub object_key: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("unsupported sandbox protocol version")]
    UnsupportedVersion,
    #[error("sandbox command must not be empty")]
    EmptyCommand,
    #[error("sandbox working directory must be under /workspace")]
    InvalidWorkingDirectory,
    #[error("sandbox command timeout is outside the policy")]
    InvalidTimeout,
    #[error("sandbox resource limits are outside the policy")]
    InvalidLimits,
}

impl CreateSessionRequest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(ValidationError::UnsupportedVersion);
        }
        if self.limits.vcpu_count == 0
            || self.limits.vcpu_count > 4
            || self.limits.memory_mib < 64
            || self.limits.memory_mib > 4096
            || self.limits.disk_mib < 64
            || self.limits.disk_mib > 8192
            || self.limits.wall_time_seconds == 0
            || self.limits.wall_time_seconds > 1800
            || self.limits.output_bytes == 0
            || self.limits.output_bytes > 16 * 1024 * 1024
        {
            return Err(ValidationError::InvalidLimits);
        }
        Ok(())
    }
}

impl ExecRequest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(ValidationError::UnsupportedVersion);
        }
        if self.command.is_empty() || self.command[0].is_empty() {
            return Err(ValidationError::EmptyCommand);
        }
        let working_directory = Path::new(&self.working_directory);
        let has_unsafe_component = working_directory
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir));
        if (!working_directory.starts_with("/workspace")) || has_unsafe_component {
            return Err(ValidationError::InvalidWorkingDirectory);
        }
        if self.timeout_seconds == 0 || self.timeout_seconds > 1800 {
            return Err(ValidationError::InvalidTimeout);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_versioned_typescript_contract() {
        let request: CreateSessionRequest = serde_json::from_str(
            r#"{"protocol_version":"v1","run_id":"run-1","profile":"podcast-text-v1","limits":{"vcpu_count":1,"memory_mib":256,"disk_mib":512,"wall_time_seconds":120,"output_bytes":1000000}}"#,
        )
        .unwrap();
        assert_eq!(request.validate(), Ok(()));
    }

    #[test]
    fn rejects_resource_and_exec_boundary_violations() {
        let mut create = CreateSessionRequest {
            protocol_version: "v0".into(),
            run_id: "run-1".into(),
            profile: "default".into(),
            limits: SandboxLimits {
                vcpu_count: 1,
                memory_mib: 256,
                disk_mib: 512,
                wall_time_seconds: 120,
                output_bytes: 1000,
            },
        };
        assert_eq!(create.validate(), Err(ValidationError::UnsupportedVersion));
        create.protocol_version = PROTOCOL_VERSION.into();
        create.limits.vcpu_count = 0;
        assert_eq!(create.validate(), Err(ValidationError::InvalidLimits));

        let mut exec = ExecRequest {
            protocol_version: PROTOCOL_VERSION.into(),
            command: vec![],
            working_directory: "/workspace".into(),
            timeout_seconds: 1,
        };
        assert_eq!(exec.validate(), Err(ValidationError::EmptyCommand));
        exec.command = vec!["true".into()];
        exec.working_directory = "/etc".into();
        assert_eq!(
            exec.validate(),
            Err(ValidationError::InvalidWorkingDirectory)
        );
        exec.working_directory = "/workspace".into();
        exec.protocol_version = "v2".into();
        assert_eq!(exec.validate(), Err(ValidationError::UnsupportedVersion));
        exec.protocol_version = PROTOCOL_VERSION.into();
        exec.working_directory = "/workspace/../etc".into();
        assert_eq!(
            exec.validate(),
            Err(ValidationError::InvalidWorkingDirectory)
        );
        exec.working_directory = "/workspace".into();
        exec.timeout_seconds = 0;
        assert_eq!(exec.validate(), Err(ValidationError::InvalidTimeout));
    }
}

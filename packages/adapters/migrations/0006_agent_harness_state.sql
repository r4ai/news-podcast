CREATE TABLE agent_tool_calls_legacy AS SELECT * FROM agent_tool_calls;
DROP TABLE agent_tool_calls;

ALTER TABLE agent_runs RENAME TO agent_runs_legacy;

CREATE TABLE agent_instances (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, agent_key)
);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  episode_job_id TEXT NOT NULL REFERENCES episode_jobs(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  agent_instance_id TEXT REFERENCES agent_instances(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'queued', 'running', 'waiting_approval', 'retrying',
      'succeeded', 'failed', 'canceled'
    )
  ),
  policy_hash TEXT NOT NULL DEFAULT 'legacy',
  checkpoint_json TEXT,
  sandbox_session_id TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  failure_code TEXT
);

INSERT INTO agent_runs (
  id, episode_job_id, owner_id, model, status, turn_count,
  tool_call_count, started_at, finished_at, failure_code
)
SELECT
  id, episode_job_id, owner_id, model, status, turn_count,
  tool_call_count, started_at, finished_at, failure_code
FROM agent_runs_legacy;

DROP TABLE agent_runs_legacy;

CREATE TABLE agent_tool_calls (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  tool_call_id TEXT,
  tool_name TEXT NOT NULL,
  effect TEXT NOT NULL DEFAULT 'read' CHECK (effect IN ('read', 'write', 'approval')),
  input_json TEXT NOT NULL,
  output_summary_json TEXT NOT NULL,
  result_hash TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (agent_run_id, position),
  UNIQUE (agent_run_id, tool_call_id)
);

INSERT INTO agent_tool_calls (
  id, agent_run_id, position, tool_name, input_json,
  output_summary_json, created_at
)
SELECT
  id, agent_run_id, position, tool_name, input_json,
  output_summary_json, created_at
FROM agent_tool_calls_legacy;

DROP TABLE agent_tool_calls_legacy;

CREATE INDEX idx_agent_runs_owner_status
  ON agent_runs(owner_id, status, started_at DESC);

CREATE TABLE agent_events (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE (agent_run_id, sequence)
);

CREATE TABLE agent_approval_requests (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (agent_run_id, tool_call_id)
);

CREATE INDEX idx_agent_approvals_owner_status
  ON agent_approval_requests(owner_id, status, expires_at);

CREATE TABLE agent_memories (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('preference', 'episode_history', 'working_note')),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'rejected', 'deleted')),
  current_version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_agent_memories_scope
  ON agent_memories(owner_id, agent_instance_id, status, kind);

CREATE TABLE agent_memory_versions (
  memory_id TEXT NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  source_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (memory_id, version)
);

CREATE TABLE agent_workspace_snapshots (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE sandbox_sessions (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  runner_session_id TEXT NOT NULL UNIQUE,
  profile TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('creating', 'ready', 'stopped', 'destroyed', 'failed')),
  created_at TEXT NOT NULL,
  stopped_at TEXT
);

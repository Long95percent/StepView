-- Agent 会话、轮次、窗口、信号、提示词快照与 Mem0 同步日志。
-- 表结构逐字沿用重构前的 stepview-agent.sqlite，保证历史数据可以直接整表搬过来。
CREATE TABLE IF NOT EXISTS agent_sessions (
  session_id TEXT PRIMARY KEY,
  task_line_id TEXT NOT NULL,
  title TEXT NOT NULL,
  persona_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_turns (
  turn_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
  user_text TEXT NOT NULL,
  assistant_text TEXT NOT NULL DEFAULT '',
  route_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'pending',
  model TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_turns_session_created
  ON agent_turns(session_id, created_at);

CREATE TABLE IF NOT EXISTS agent_session_windows (
  session_id TEXT PRIMARY KEY REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
  recent_turn_ids_json TEXT NOT NULL DEFAULT '[]',
  rolling_summary_text TEXT NOT NULL DEFAULT '',
  rolling_summary_turn_ids_json TEXT NOT NULL DEFAULT '[]',
  session_state_json TEXT NOT NULL DEFAULT '{}',
  prompt_state_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_signals (
  signal_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES agent_turns(turn_id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_signals_session_created
  ON agent_signals(session_id, created_at);

CREATE TABLE IF NOT EXISTS agent_prompt_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES agent_turns(turn_id) ON DELETE SET NULL,
  prompt_json TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_prompt_snapshots_session_created
  ON agent_prompt_snapshots(session_id, created_at);

CREATE TABLE IF NOT EXISTS agent_mem0_sync_log (
  sync_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES agent_turns(turn_id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  mem0_id TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

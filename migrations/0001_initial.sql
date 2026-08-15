PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_player_id ON sessions(player_id);

CREATE TABLE IF NOT EXISTS player_input_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('search', 'talk_send')),
  player_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  app_id TEXT,
  talk_id TEXT,
  from_id TEXT,
  user_input TEXT NOT NULL,
  normalized_input TEXT NOT NULL,
  status TEXT NOT NULL,
  matched INTEGER CHECK (matched IN (0, 1)),
  rule_id TEXT,
  next_from_id TEXT,
  response_snapshot_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (event_type, player_id, request_key)
);

CREATE INDEX IF NOT EXISTS idx_player_input_events_occurred
  ON player_input_events(occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_player_input_events_talk
  ON player_input_events(talk_id, from_id, occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS scheduled_events (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  due_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'canceled', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (player_id, schedule_id),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scheduled_events_due
  ON scheduled_events(status, due_at);

CREATE TABLE IF NOT EXISTS generated_audio_jobs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  audio_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_job_id TEXT,
  input_hash TEXT NOT NULL,
  output_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (player_id, audio_id),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_generated_audio_jobs_player
  ON generated_audio_jobs(player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS talk_branch_review_clusters (
  id TEXT PRIMARY KEY,
  talk_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  actual_rule_id TEXT NOT NULL,
  fit TEXT NOT NULL CHECK (fit IN ('blue', 'yellow', 'red')),
  representative_input TEXT NOT NULL,
  input_count INTEGER NOT NULL,
  source_event_ids_json TEXT NOT NULL DEFAULT '[]',
  inputs_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT NOT NULL DEFAULT '{}',
  analysis_version TEXT NOT NULL,
  scenario_revision TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_talk_branch_review_clusters_from
  ON talk_branch_review_clusters(talk_id, from_id, actual_rule_id, input_count DESC);

CREATE TABLE IF NOT EXISTS talk_branch_review_judgments (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('branch', 'criteria', 'input_selection', 'input')),
  source_event_ids_json TEXT NOT NULL DEFAULT '[]',
  cluster_id TEXT,
  talk_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  actual_rule_id TEXT,
  expected_rule_id TEXT,
  judgment TEXT NOT NULL CHECK (judgment IN ('move_to_existing', 'needs_new_branch', 'hold', 'comment_only')),
  comment TEXT NOT NULL DEFAULT '',
  new_branch_note TEXT NOT NULL DEFAULT '',
  reviewer_label TEXT NOT NULL DEFAULT '',
  scenario_revision TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'reported', 'applied', 'dismissed')) DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_talk_branch_review_judgments_from
  ON talk_branch_review_judgments(talk_id, from_id, actual_rule_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS talk_branch_review_trial_inputs (
  id TEXT PRIMARY KEY,
  talk_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  actual_rule_id TEXT NOT NULL,
  user_input TEXT NOT NULL,
  next_from_id TEXT,
  response_snapshot_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('active', 'deleted')) DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_talk_branch_review_trial_inputs_from
  ON talk_branch_review_trial_inputs(talk_id, from_id, actual_rule_id, status, created_at DESC);

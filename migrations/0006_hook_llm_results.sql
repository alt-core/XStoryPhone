CREATE TABLE IF NOT EXISTS hook_llm_results (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  model_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  schema_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'fallback')),
  output_json TEXT NOT NULL,
  error_code TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  UNIQUE(player_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_hook_llm_results_player ON hook_llm_results(player_id);
CREATE INDEX IF NOT EXISTS idx_hook_llm_results_expires ON hook_llm_results(expires_at);

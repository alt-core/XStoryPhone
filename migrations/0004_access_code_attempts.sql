CREATE TABLE IF NOT EXISTS access_code_attempts (
  counter_text TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_player_input_events_type_occurred
  ON player_input_events(event_type, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_player_input_events_player_occurred
  ON player_input_events(player_id, occurred_at DESC, id DESC);

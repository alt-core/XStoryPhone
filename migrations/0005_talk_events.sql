CREATE TABLE IF NOT EXISTS talk_events (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  transcript_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sms', 'chat')),
  talk_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('player_message', 'message_block')),
  body TEXT,
  block_id TEXT,
  format_env_json TEXT,
  delivered_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  CHECK (
    (event_type = 'player_message' AND body IS NOT NULL AND block_id IS NULL)
    OR (event_type = 'message_block' AND body IS NULL AND block_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_talk_events_player_talk_delivered
  ON talk_events(player_id, talk_id, transcript_key, delivered_at, id);

ALTER TABLE players ADD COLUMN last_mutation_id TEXT;

CREATE TABLE IF NOT EXISTS player_transcripts (
  player_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  transcript_key TEXT NOT NULL,
  messages_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (player_id, stream_id),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

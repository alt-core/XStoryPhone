-- browserの補助jobはplayer行を作らず、現在jobだけを保存する。
CREATE TABLE generated_audio_jobs_next (
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
  input_text TEXT,
  UNIQUE (player_id, audio_id)
);
INSERT INTO generated_audio_jobs_next
  SELECT id, player_id, audio_id, provider, external_job_id, input_hash, output_key,
    status, error_code, created_at, updated_at, completed_at, input_text
  FROM generated_audio_jobs;
DROP TABLE generated_audio_jobs;
ALTER TABLE generated_audio_jobs_next RENAME TO generated_audio_jobs;
CREATE INDEX idx_generated_audio_jobs_player ON generated_audio_jobs(player_id, created_at DESC);

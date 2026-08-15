ALTER TABLE players ADD COLUMN access_code_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_access_code_hash
  ON players(access_code_hash)
  WHERE access_code_hash IS NOT NULL;

ALTER TABLE access_code_attempts ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1));
ALTER TABLE access_code_attempts ADD COLUMN success_count INTEGER NOT NULL DEFAULT 0;

-- reset前のsessionが、再開始したプレイへ遅着操作を送らないための境界。
ALTER TABLE players ADD COLUMN session_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;

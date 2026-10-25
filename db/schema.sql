CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'multi',
  target_players SMALLINT NOT NULL DEFAULT 6,
  subject TEXT NOT NULL DEFAULT 'all',
  host_player_id TEXT NOT NULL DEFAULT '',
  seed BIGINT NOT NULL,
  phase TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  house JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'multi';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS target_players SMALLINT NOT NULL DEFAULT 6;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'all';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS host_player_id TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('mcq','fill_blank')),
  tier SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 5),
  trait_tag TEXT NOT NULL,
  question JSONB NOT NULL,
  source_url TEXT
);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS source_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS questions_source_url_unique ON questions(source_url) WHERE source_url IS NOT NULL;
CREATE TABLE IF NOT EXISTS answer_events (
  id UUID PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id),
  player_id TEXT NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  correct BOOLEAN NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  tier SMALLINT NOT NULL,
  exit_id TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS answer_events_match_idx ON answer_events(match_id,created_at);

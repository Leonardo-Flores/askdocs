CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id         BIGSERIAL PRIMARY KEY,
  path       TEXT NOT NULL UNIQUE,
  sha256     TEXT NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id          BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal     INT NOT NULL,
  content     TEXT NOT NULL,
  -- text-embedding-3-small produces 1536 dimensions
  embedding   vector(1536) NOT NULL,
  UNIQUE (document_id, ordinal)
);

-- HNSW gives good recall without tuning lists like ivfflat requires.
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

-- One row per ask(): the observability spine. Cost and latency per stage,
-- so quality regressions and cost creep show up in a query, not in vibes.
CREATE TABLE IF NOT EXISTS traces (
  id                BIGSERIAL PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  question          TEXT NOT NULL,
  embed_ms          INT NOT NULL,
  search_ms         INT NOT NULL,
  chat_ms           INT NOT NULL,
  total_ms          INT NOT NULL,
  hits              INT NOT NULL,
  top_similarity    REAL,
  prompt_tokens     INT,
  completion_tokens INT,
  cost_usd          NUMERIC(10, 6),
  model             TEXT NOT NULL
);

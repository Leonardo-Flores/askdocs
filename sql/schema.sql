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

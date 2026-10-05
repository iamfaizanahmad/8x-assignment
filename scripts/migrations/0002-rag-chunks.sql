-- Hybrid RAG for library-wide Ask AI: transcript chunks with a pgvector embedding and a tsvector.
-- Idempotent. Run `npm run index` afterwards to chunk and embed existing meetings.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS transcript_chunks (
  id serial PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  content text NOT NULL,
  embedding vector(1024),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE INDEX IF NOT EXISTS chunks_meeting_idx ON transcript_chunks (meeting_id, start_ms);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON transcript_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON transcript_chunks USING hnsw (embedding vector_cosine_ops);

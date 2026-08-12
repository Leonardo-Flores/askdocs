# askdocs

RAG over your own documents, built by hand to understand every moving part. No LangChain, no LlamaIndex: OpenAI embeddings, Postgres with pgvector, and a chat model that answers with numbered citations.

Ask a question, get an answer grounded in your files, with the sources listed.

## How it works

```
ingest:  .md/.txt files -> paragraph-aware chunks -> text-embedding-3-small -> pgvector
ask:     question -> embedding -> cosine top-k (HNSW index) -> chat model -> answer + [1][2] citations
```

Design choices, since the point of this repo is understanding the pieces:

- **Chunking**: paragraph-aware packing up to ~1200 chars with ~200 chars of word-boundary overlap. Splitting mid-sentence hurts retrieval more than any other single mistake.
- **pgvector with HNSW**: cosine distance, no tuning knobs needed at this scale. Postgres is already in the stack, so no extra vector database to operate.
- **Idempotent ingest**: files are hashed (sha256); re-ingesting unchanged files is a no-op, changed files are re-chunked atomically in a transaction.
- **Similarity cutoff**: hits below 0.2 are dropped instead of letting the model improvise on weak context. The honest answer for out-of-corpus questions is "not in the documents".
- **Citations**: the model only sees numbered passages and must cite them inline, so every claim in the answer is traceable to a chunk.

## Running it

Needs Node 22+, Docker and an `OPENAI_API_KEY`.

```sh
docker compose up -d          # Postgres 16 + pgvector, schema auto-applied
npm install

export OPENAI_API_KEY=sk-...
npm run ingest -- ./docs      # or any folder with .md/.txt files
npm run ask -- "what does the ingest pipeline do?"
```

Or as an HTTP API:

```sh
npm run serve
curl -s localhost:8787/ask -d '{"question": "how are chunks stored?"}'
```

## Tests

```sh
npm test
```

Unit tests cover the chunker, which is the only part with real logic worth testing in isolation. Everything else is glue between Postgres and the OpenAI API.

## Layout

```
src/chunk.ts    paragraph-aware chunking (pure, tested)
src/embed.ts    OpenAI embeddings, batched
src/ingest.ts   files -> chunks -> embeddings -> Postgres
src/search.ts   cosine top-k over pgvector
src/ask.ts      retrieval + chat completion with citations (CLI)
src/server.ts   POST /ask (Hono)
sql/schema.sql  documents, chunks, HNSW index
```

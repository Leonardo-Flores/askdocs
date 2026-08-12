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

Needs Node 22+, Docker and one API key. Either provider handles both embeddings and chat:

- `GEMINI_API_KEY`: free tier, no credit card (aistudio.google.com/apikey)
- `OPENAI_API_KEY`: what most job specs name

Anthropic is not an option on purpose: Claude has no embeddings endpoint, and RAG needs one.

```sh
docker compose up -d          # Postgres 16 + pgvector, schema auto-applied
npm install

export GEMINI_API_KEY=...     # or OPENAI_API_KEY=sk-...
npm run ingest -- ./docs      # or any folder with .md/.txt files
npm run ask -- "what does the ingest pipeline do?"
```

Or in the browser: `npm run serve` and open http://localhost:8787 for a small chat UI (Catppuccin Mocha, of course) that shows the cited sources and the trace (latency, tokens, cost) under every answer. The same endpoint works headless:

```sh
curl -s localhost:8787/ask -d '{"question": "how are chunks stored?"}'
```

## Evals and observability

"It seems to work" is not a metric. Two commands turn vibes into numbers:

```sh
npm run eval    # golden set: retrieval recall, string checks, LLM-as-judge
npm run stats   # traces: latency avg/p95, retrieval health, total spend
```

Every `ask` writes a trace row (latency per stage, tokens, cost in USD, top similarity), so cost creep and quality regressions show up in a query.

The eval harness scores each golden case three ways, because none is enough alone:

- **retrieval recall@6**: did the expected document reach the top-k at all? If retrieval fails, nothing downstream can save the answer.
- **string checks**: does the answer literally contain the expected facts? Cheap, fast, catches regressions.
- **LLM-as-judge**: a second model call with **structured output** (strict JSON schema) grades whether the answer is grounded in the passages and actually answers the question. Catches paraphrase and hallucination that string checks miss.

There is also a refusal case ("capital of France") asserting the system says "not in the documents" instead of improvising. `npm run eval` exits non-zero on judge failures, so it can gate CI.

## Tests

```sh
npm test
```

Unit tests cover the chunker, which is the only part with real logic worth testing in isolation. Everything else is glue between Postgres and the OpenAI API.

## Layout

```
src/chunk.ts    paragraph-aware chunking (pure, tested)
src/embed.ts    embeddings + chat, Gemini or OpenAI, batched
src/ingest.ts   files -> chunks -> embeddings -> Postgres
src/search.ts   cosine top-k over pgvector
src/ask.ts      retrieval + chat completion with citations, traced (CLI)
src/server.ts   chat UI + POST /ask (Hono)
src/eval.ts     golden-set eval: recall, string checks, LLM-as-judge
src/stats.ts    latency/cost/retrieval aggregates from traces
sql/schema.sql  documents, chunks, HNSW index, traces
```

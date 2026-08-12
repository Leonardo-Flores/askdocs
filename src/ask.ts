// Usage: npm run ask -- "your question"
// Full RAG round trip: embed the question, retrieve the closest chunks,
// hand them to the chat model and print an answer with numbered sources.
// Every call writes a trace row: latency per stage, tokens, cost.

import { pool } from "./db.ts";
import { CHAT_MODEL, chatAnswer, costUsd, embedOne } from "./embed.ts";
import { searchByEmbedding, type Hit } from "./search.ts";

const MIN_SIMILARITY = 0.2;

export interface Trace {
  embedMs: number;
  searchMs: number;
  chatMs: number;
  totalMs: number;
  hits: number;
  topSimilarity: number | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model: string;
}

export async function ask(
  question: string,
): Promise<{ answer: string; sources: Hit[]; trace: Trace }> {
  const t0 = performance.now();

  const embedding = await embedOne(question);
  const t1 = performance.now();

  const all = await searchByEmbedding(embedding, 6);
  const hits = all.filter((h) => h.similarity >= MIN_SIMILARITY);
  const t2 = performance.now();

  let answer: string;
  let usage = { promptTokens: 0, completionTokens: 0 };
  if (hits.length === 0) {
    answer = "No relevant passages found in the ingested documents.";
  } else {
    const context = hits
      .map((h, i) => `[${i + 1}] (${h.path}#${h.ordinal})\n${h.content}`)
      .join("\n\n---\n\n");
    const res = await chatAnswer(
      "Answer using ONLY the provided passages. Cite passages inline as [1], [2]. " +
        "If the passages do not contain the answer, say so plainly. Answer in the language of the question.",
      `Passages:\n\n${context}\n\nQuestion: ${question}`,
    );
    answer = res.text;
    usage = res.usage;
  }
  const t3 = performance.now();

  const trace: Trace = {
    embedMs: Math.round(t1 - t0),
    searchMs: Math.round(t2 - t1),
    chatMs: Math.round(t3 - t2),
    totalMs: Math.round(t3 - t0),
    hits: hits.length,
    topSimilarity: all[0]?.similarity ?? null,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUsd: costUsd(usage),
    model: CHAT_MODEL,
  };
  await pool.query(
    `INSERT INTO traces (question, embed_ms, search_ms, chat_ms, total_ms,
                         hits, top_similarity, prompt_tokens, completion_tokens,
                         cost_usd, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      question,
      trace.embedMs,
      trace.searchMs,
      trace.chatMs,
      trace.totalMs,
      trace.hits,
      trace.topSimilarity,
      trace.promptTokens,
      trace.completionTokens,
      trace.costUsd,
      trace.model,
    ],
  );

  return { answer, sources: hits, trace };
}

if (process.argv[1]?.endsWith("ask.ts")) {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('usage: npm run ask -- "your question"');
    process.exit(1);
  }
  const { answer, sources, trace } = await ask(question);
  console.log(`\n${answer}\n`);
  for (const [i, s] of sources.entries()) {
    console.log(`[${i + 1}] ${s.path}#${s.ordinal} (similarity ${s.similarity.toFixed(3)})`);
  }
  console.log(
    `\ntrace: total ${trace.totalMs}ms (embed ${trace.embedMs} | search ${trace.searchMs} | chat ${trace.chatMs}) · ` +
      `${trace.promptTokens}+${trace.completionTokens} tokens · $${trace.costUsd.toFixed(6)} · ${trace.model}`,
  );
  await pool.end();
}

// Usage: npm run ask -- "your question"
// Full RAG round trip: embed the question, retrieve the closest chunks,
// hand them to the chat model and print an answer with numbered sources.

import { pool } from "./db.ts";
import { chatAnswer } from "./embed.ts";
import { search, type Hit } from "./search.ts";

const MIN_SIMILARITY = 0.2;

export async function ask(question: string): Promise<{ answer: string; sources: Hit[] }> {
  const hits = (await search(question, 6)).filter(
    (h) => h.similarity >= MIN_SIMILARITY,
  );
  if (hits.length === 0) {
    return { answer: "No relevant passages found in the ingested documents.", sources: [] };
  }

  const context = hits
    .map((h, i) => `[${i + 1}] (${h.path}#${h.ordinal})\n${h.content}`)
    .join("\n\n---\n\n");

  const answer = await chatAnswer(
    "Answer using ONLY the provided passages. Cite passages inline as [1], [2]. " +
      "If the passages do not contain the answer, say so plainly. Answer in the language of the question.",
    `Passages:\n\n${context}\n\nQuestion: ${question}`,
  );

  return { answer, sources: hits };
}

if (process.argv[1]?.endsWith("ask.ts")) {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('usage: npm run ask -- "your question"');
    process.exit(1);
  }
  const { answer, sources } = await ask(question);
  console.log(`\n${answer}\n`);
  for (const [i, s] of sources.entries()) {
    console.log(`[${i + 1}] ${s.path}#${s.ordinal} (similarity ${s.similarity.toFixed(3)})`);
  }
  await pool.end();
}

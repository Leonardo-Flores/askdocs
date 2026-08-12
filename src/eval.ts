// Usage: npm run eval
// Runs the golden set in eval/golden.json against the ingested corpus and
// scores three things per case:
//
//   retrieval  did the expected document show up in the top-k? (recall@6)
//   contains   does the answer literally mention the expected facts?
//   judge      an LLM-as-judge verdict (structured output): is the answer
//              grounded in the passages, and does it actually answer?
//
// String checks catch regressions cheaply; the judge catches what strings
// cannot (paraphrase, hallucination, non-answers). Neither alone is enough.

import { readFile } from "node:fs/promises";
import { pool } from "./db.ts";
import { chatJSON } from "./embed.ts";
import { ask } from "./ask.ts";

interface GoldenCase {
  question: string;
  must_contain?: string[];
  source_hint?: string;
  expect_refusal?: boolean;
}

interface Verdict {
  grounded: boolean;
  answers_question: boolean;
  reason: string;
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    grounded: {
      type: "boolean",
      description: "Every claim in the answer is supported by the passages",
    },
    answers_question: {
      type: "boolean",
      description: "The answer actually addresses the question asked",
    },
    reason: { type: "string" },
  },
  required: ["grounded", "answers_question", "reason"],
  additionalProperties: false,
};

const cases: GoldenCase[] = JSON.parse(
  await readFile(new URL("../eval/golden.json", import.meta.url), "utf8"),
);

let retrievalPass = 0;
let containsPass = 0;
let judgePass = 0;
let totalCost = 0;
let judged = 0;

console.log(`running ${cases.length} golden cases\n`);

for (const c of cases) {
  const { answer, sources, trace } = await ask(c.question);
  totalCost += trace.costUsd;

  // refusal cases: the only right behavior is to say "not in the documents"
  if (c.expect_refusal) {
    const refused =
      sources.length === 0 ||
      /not|não|nao/i.test(answer.slice(0, 200));
    if (refused) {
      retrievalPass++; containsPass++; judgePass++; judged++;
      console.log(`PASS  (refused)              ${c.question}`);
    } else {
      judged++;
      console.log(`FAIL  (should have refused)  ${c.question}`);
    }
    continue;
  }

  const retrieval =
    !c.source_hint || sources.some((s) => s.path.includes(c.source_hint!));
  if (retrieval) retrievalPass++;

  const contains = (c.must_contain ?? []).every((m) =>
    answer.toLowerCase().includes(m.toLowerCase()),
  );
  if (contains) containsPass++;

  const context = sources
    .map((h, i) => `[${i + 1}] ${h.content}`)
    .join("\n\n");
  const { data: verdict, usage } = await chatJSON<Verdict>(
    "You are grading a RAG answer. Be strict: any claim not supported by the passages means grounded=false.",
    `Passages:\n${context}\n\nQuestion: ${c.question}\n\nAnswer: ${answer}`,
    "verdict",
    VERDICT_SCHEMA,
  );
  judged++;
  const judgeOk = verdict.grounded && verdict.answers_question;
  if (judgeOk) judgePass++;

  const flags = [
    retrieval ? "R+" : "R-",
    contains ? "C+" : "C-",
    judgeOk ? "J+" : "J-",
  ].join(" ");
  console.log(`${judgeOk && retrieval && contains ? "PASS" : "FAIL"}  ${flags}  ${c.question}`);
  if (!judgeOk) console.log(`      judge: ${verdict.reason}`);
}

const pct = (n: number) => `${Math.round((n / cases.length) * 100)}%`;
console.log(`\nretrieval recall@6:  ${retrievalPass}/${cases.length} (${pct(retrievalPass)})`);
console.log(`answer contains:     ${containsPass}/${cases.length} (${pct(containsPass)})`);
console.log(`judge approves:      ${judgePass}/${judged}`);
console.log(`eval run cost:       $${totalCost.toFixed(4)}`);

const failed = judged - judgePass;
await pool.end();
process.exit(failed > 0 ? 1 : 0);

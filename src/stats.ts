// Usage: npm run stats
// Reads the traces table and prints the numbers that matter: volume,
// latency (avg and p95), retrieval health and total spend.

import { pool } from "./db.ts";

const res = await pool.query(`
  SELECT count(*)::int                                            AS asks,
         round(avg(total_ms))::int                                AS avg_ms,
         round(percentile_cont(0.95) WITHIN GROUP (ORDER BY total_ms))::int AS p95_ms,
         round(avg(chat_ms))::int                                 AS avg_chat_ms,
         round(avg(top_similarity)::numeric, 3)                   AS avg_top_sim,
         count(*) FILTER (WHERE hits = 0)::int                    AS zero_hit_asks,
         sum(prompt_tokens)::int                                  AS prompt_tokens,
         sum(completion_tokens)::int                              AS completion_tokens,
         round(sum(cost_usd), 4)                                  AS total_cost_usd
  FROM traces
`);
const s = res.rows[0];

if (!s.asks) {
  console.log("no traces yet. Run some asks first.");
} else {
  console.log(`asks:            ${s.asks}`);
  console.log(`latency:         avg ${s.avg_ms}ms · p95 ${s.p95_ms}ms (chat avg ${s.avg_chat_ms}ms)`);
  console.log(`retrieval:       avg top similarity ${s.avg_top_sim} · ${s.zero_hit_asks} asks with zero hits`);
  console.log(`tokens:          ${s.prompt_tokens} in · ${s.completion_tokens} out`);
  console.log(`total cost:      $${s.total_cost_usd}`);
}
await pool.end();

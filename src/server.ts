// Tiny HTTP wrapper around ask(): POST /ask {"question": "..."},
// plus a one-page chat UI at / (public/index.html).
import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { ask } from "./ask.ts";

const app = new Hono();

const page = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
app.get("/", (c) => c.html(page));

app.get("/health", (c) => c.json({ ok: true }));

app.post("/ask", async (c) => {
  const body = await c.req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return c.json({ error: "body must be {\"question\": string}" }, 400);
  const result = await ask(question);
  return c.json(result);
});

const port = Number(process.env.PORT ?? 8787);
console.log(`askdocs listening on :${port}`);
serve({ fetch: app.fetch, port });

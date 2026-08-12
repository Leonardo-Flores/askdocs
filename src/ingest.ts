// Usage: npm run ingest -- <dir-or-file> [more paths...]
// Reads .md and .txt files, chunks them, embeds the chunks and stores
// everything in Postgres. Re-ingesting an unchanged file is a no-op (sha256).

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { chunkText } from "./chunk.ts";
import { pool, toVectorLiteral } from "./db.ts";
import { embedMany } from "./embed.ts";

const EXTENSIONS = new Set([".md", ".txt"]);

async function collectFiles(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const p of paths) {
    const s = await stat(p);
    if (s.isDirectory()) {
      const entries = await readdir(p, { recursive: true });
      for (const e of entries) {
        if (EXTENSIONS.has(extname(e))) files.push(join(p, e));
      }
    } else if (EXTENSIONS.has(extname(p))) {
      files.push(p);
    }
  }
  return files;
}

async function ingestFile(path: string): Promise<void> {
  const text = await readFile(path, "utf8");
  const sha = createHash("sha256").update(text).digest("hex");

  const existing = await pool.query(
    "SELECT id, sha256 FROM documents WHERE path = $1",
    [path],
  );
  if (existing.rows[0]?.sha256 === sha) {
    console.log(`= ${path} (unchanged)`);
    return;
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    console.log(`- ${path} (empty)`);
    return;
  }
  const embeddings = await embedMany(chunks.map((c) => c.content));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const doc = await client.query(
      `INSERT INTO documents (path, sha256) VALUES ($1, $2)
       ON CONFLICT (path) DO UPDATE SET sha256 = $2, ingested_at = now()
       RETURNING id`,
      [path, sha],
    );
    const docId = doc.rows[0].id;
    await client.query("DELETE FROM chunks WHERE document_id = $1", [docId]);
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        `INSERT INTO chunks (document_id, ordinal, content, embedding)
         VALUES ($1, $2, $3, $4::vector)`,
        [docId, chunks[i].ordinal, chunks[i].content, toVectorLiteral(embeddings[i])],
      );
    }
    await client.query("COMMIT");
    console.log(`+ ${path} (${chunks.length} chunks)`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: npm run ingest -- <dir-or-file> [...]");
  process.exit(1);
}

const files = await collectFiles(args);
console.log(`ingesting ${files.length} file(s)`);
for (const f of files) await ingestFile(f);
await pool.end();

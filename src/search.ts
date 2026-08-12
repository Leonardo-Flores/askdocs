import { pool, toVectorLiteral } from "./db.ts";
import { embedOne } from "./embed.ts";

export interface Hit {
  path: string;
  ordinal: number;
  content: string;
  similarity: number;
}

// Cosine distance (<=>) is what the HNSW index was built for; similarity is
// just 1 - distance, easier to reason about when tuning the cutoff.
export async function searchByEmbedding(
  embedding: number[],
  k = 5,
): Promise<Hit[]> {
  const res = await pool.query(
    `SELECT d.path, c.ordinal, c.content,
            1 - (c.embedding <=> $1::vector) AS similarity
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     ORDER BY c.embedding <=> $1::vector
     LIMIT $2`,
    [toVectorLiteral(embedding), k],
  );
  return res.rows;
}

export async function search(query: string, k = 5): Promise<Hit[]> {
  return searchByEmbedding(await embedOne(query), k);
}

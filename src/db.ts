import pg from "pg";

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://askdocs:askdocs@localhost:5433/askdocs",
});

// pgvector expects the literal '[1,2,3]' format for vector parameters.
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

import OpenAI from "openai";

const MODEL = "text-embedding-3-small";
const BATCH = 64;

const client = new OpenAI();

export async function embedMany(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await client.embeddings.create({ model: MODEL, input: batch });
    for (const item of res.data) out.push(item.embedding);
  }
  return out;
}

export async function embedOne(text: string): Promise<number[]> {
  const [e] = await embedMany([text]);
  return e;
}

export { client as openai };

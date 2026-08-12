// Embeddings + chat behind one switch: set GEMINI_API_KEY (free tier at
// aistudio.google.com/apikey) or OPENAI_API_KEY. Anthropic is chat-only
// (no embeddings endpoint), which is why it is not an option here.
// Dimensions are pinned to 1536 to match the pgvector schema either way.

import OpenAI from "openai";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const EMBED_BATCH = 64;

let _openai: OpenAI | null = null;
function openaiClient(): OpenAI {
  return (_openai ??= new OpenAI());
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    out.push(...(GEMINI_KEY ? await geminiEmbed(batch) : await openaiEmbed(batch)));
  }
  return out;
}

export async function embedOne(text: string): Promise<number[]> {
  const [e] = await embedMany([text]);
  return e;
}

async function openaiEmbed(batch: string[]): Promise<number[][]> {
  const res = await openaiClient().embeddings.create({
    model: "text-embedding-3-small",
    input: batch,
  });
  return res.data.map((d) => d.embedding);
}

async function geminiEmbed(batch: string[]): Promise<number[][]> {
  const model = "models/gemini-embedding-001";
  const res = await fetch(
    `${GEMINI_BASE}/${model}:batchEmbedContents?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model,
          content: { parts: [{ text }] },
          // Cosine distance is scale-invariant, so the non-normalized
          // vectors Gemini returns at 1536 dims are fine for our index.
          outputDimensionality: 1536,
        })),
      }),
    },
  );
  if (!res.ok) throw new Error(`gemini embeddings: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { embeddings: { values: number[] }[] };
  return data.embeddings.map((e) => e.values);
}

export async function chatAnswer(system: string, user: string): Promise<string> {
  if (GEMINI_KEY) {
    const model = process.env.ASKDOCS_MODEL ?? "gemini-2.5-flash";
    const res = await fetch(
      `${GEMINI_BASE}/models/${model}:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
        }),
      },
    );
    if (!res.ok) throw new Error(`gemini chat: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }

  const res = await openaiClient().chat.completions.create({
    model: process.env.ASKDOCS_MODEL ?? "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return res.choices[0].message.content ?? "";
}

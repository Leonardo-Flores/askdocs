// Embeddings + chat behind one switch: set GEMINI_API_KEY (free tier at
// aistudio.google.com/apikey) or OPENAI_API_KEY. Anthropic is chat-only
// (no embeddings endpoint), which is why it is not an option here.
// Dimensions are pinned to 1536 to match the pgvector schema either way.

import OpenAI from "openai";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const EMBED_BATCH = 64;

export const CHAT_MODEL =
  process.env.ASKDOCS_MODEL ?? (GEMINI_KEY ? "gemini-2.5-flash" : "gpt-4o-mini");

// USD per 1M tokens (input, output). Used for the cost column in traces.
// Gemini free tier is treated as zero; adjust if you move to paid.
const PRICES: Record<string, [number, number]> = {
  "gpt-4o-mini": [0.15, 0.6],
  "gemini-2.5-flash": [0, 0],
};

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export function costUsd(usage: ChatUsage, model = CHAT_MODEL): number {
  const [inPrice, outPrice] = PRICES[model] ?? [0, 0];
  return (
    (usage.promptTokens * inPrice + usage.completionTokens * outPrice) / 1_000_000
  );
}

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

export async function chatAnswer(
  system: string,
  user: string,
): Promise<{ text: string; usage: ChatUsage }> {
  if (GEMINI_KEY) {
    const data = await geminiGenerate(system, user);
    return { text: geminiText(data), usage: geminiUsage(data) };
  }
  const res = await openaiClient().chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return {
    text: res.choices[0].message.content ?? "",
    usage: {
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
    },
  };
}

// Structured output: the model is forced to return JSON matching `schema`.
// This is what makes LLM output usable as data instead of prose to regex.
export async function chatJSON<T>(
  system: string,
  user: string,
  schemaName: string,
  schema: Record<string, unknown>,
): Promise<{ data: T; usage: ChatUsage }> {
  if (GEMINI_KEY) {
    const data = await geminiGenerate(system, user, {
      responseMimeType: "application/json",
      responseSchema: schema,
    });
    return { data: JSON.parse(geminiText(data)) as T, usage: geminiUsage(data) };
  }
  const res = await openaiClient().chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema },
    },
  });
  return {
    data: JSON.parse(res.choices[0].message.content ?? "{}") as T,
    usage: {
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
    },
  };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

async function geminiGenerate(
  system: string,
  user: string,
  generationConfig?: Record<string, unknown>,
): Promise<GeminiResponse> {
  const res = await fetch(
    `${GEMINI_BASE}/models/${CHAT_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        ...(generationConfig ? { generationConfig } : {}),
      }),
    },
  );
  if (!res.ok) throw new Error(`gemini chat: ${res.status} ${await res.text()}`);
  return (await res.json()) as GeminiResponse;
}

function geminiText(data: GeminiResponse): string {
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

function geminiUsage(data: GeminiResponse): ChatUsage {
  return {
    promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
    completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

// Paragraph-aware chunking: split on blank lines, then pack paragraphs into
// chunks of at most `maxChars`, carrying `overlapChars` from the tail of the
// previous chunk so context is not lost at boundaries. A paragraph longer than
// maxChars is hard-split (rare in prose, common in code blocks).

export interface Chunk {
  ordinal: number;
  content: string;
}

export function chunkText(
  text: string,
  maxChars = 1200,
  overlapChars = 200,
): Chunk[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) {
      pieces.push(p);
      continue;
    }
    for (let i = 0; i < p.length; i += maxChars) {
      pieces.push(p.slice(i, i + maxChars));
    }
  }

  const chunks: Chunk[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > maxChars) {
      chunks.push({ ordinal: chunks.length, content: current });
      current = tail(current, overlapChars);
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current.trim()) {
    chunks.push({ ordinal: chunks.length, content: current });
  }
  return chunks;
}

// Take the last `n` chars of a chunk, but start at a word boundary so the
// overlap reads naturally.
function tail(text: string, n: number): string {
  if (n <= 0 || text.length <= n) return n <= 0 ? "" : text;
  const slice = text.slice(-n);
  const firstSpace = slice.indexOf(" ");
  return firstSpace === -1 ? slice : slice.slice(firstSpace + 1);
}

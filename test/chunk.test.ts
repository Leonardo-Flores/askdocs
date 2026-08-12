import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkText } from "../src/chunk.ts";

test("short text becomes a single chunk", () => {
  const chunks = chunkText("hello world");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].content, "hello world");
});

test("empty text produces no chunks", () => {
  assert.equal(chunkText("").length, 0);
  assert.equal(chunkText("\n\n\n").length, 0);
});

test("paragraphs pack together up to maxChars", () => {
  const text = "aaa\n\nbbb\n\nccc";
  const chunks = chunkText(text, 100, 0);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].content, "aaa\n\nbbb\n\nccc");
});

test("splits when maxChars is exceeded and keeps ordinals sequential", () => {
  const para = "x".repeat(400);
  const text = [para, para, para].join("\n\n");
  const chunks = chunkText(text, 500, 50);
  assert.ok(chunks.length >= 2);
  chunks.forEach((c, i) => assert.equal(c.ordinal, i));
  for (const c of chunks) assert.ok(c.content.length <= 500 + 50 + 2);
});

test("consecutive chunks share overlap", () => {
  const a = "alpha ".repeat(100).trim(); // ~600 chars
  const b = "beta ".repeat(100).trim();
  const chunks = chunkText(`${a}\n\n${b}`, 700, 100);
  assert.equal(chunks.length, 2);
  const tailOfFirst = chunks[0].content.slice(-30);
  assert.ok(chunks[1].content.includes(tailOfFirst.split(" ").at(-1)!));
});

test("a single paragraph longer than maxChars is hard-split", () => {
  const chunks = chunkText("z".repeat(3000), 1000, 0);
  assert.ok(chunks.length >= 3);
});

import crypto from "node:crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function* chunkText(
  text: string,
  size = 24,
  delayMs = 0,
): AsyncGenerator<string> {
  for (let start = 0; start < text.length; start += size) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    yield text.slice(start, start + size);
  }
}

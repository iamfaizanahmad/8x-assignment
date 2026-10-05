import "server-only";

/** Voyage AI (Anthropic's recommended embeddings provider). Claude itself has no embeddings endpoint. */
const MODEL = "voyage-3.5-lite";
export const EMBEDDING_DIMS = 1024;

// Voyage's free tier (no card on file) allows 10K tokens and 3 requests per minute, so batches stay well under that.
const BATCH_TOKENS = 8000;
const RATE_LIMIT_WAIT_MS = 21_000;
const approxTokens = (text: string) => Math.ceil(text.length / 3);

export class EmbeddingUnavailableError extends Error {}
class RateLimitedError extends EmbeddingUnavailableError {
  constructor() {
    super("Voyage rate limit reached");
  }
}

async function request(input: string[], inputType: "document" | "query"): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new EmbeddingUnavailableError("VOYAGE_API_KEY is not set");
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input, model: MODEL, input_type: inputType, output_dimension: EMBEDDING_DIMS }),
  });
  if (res.status === 429) throw new RateLimitedError();
  if (!res.ok) throw new EmbeddingUnavailableError(`Voyage ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json: { data: { embedding: number[]; index: number }[] } = await res.json();
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Embeds the question for vector search. Fails fast: Ask AI falls back to keyword retrieval instead of waiting. */
export async function embedQuery(text: string) {
  return (await request([text], "query"))[0];
}

/**
 * Embeds transcript chunks in token-bounded batches, waiting out rate limits until `deadline` (epoch ms).
 * Returns one vector per input, or null for inputs it ran out of time for, so callers can store a partial index.
 */
export async function embedDocuments(texts: string[], deadline = Infinity): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = texts.map(() => null);
  let i = 0;
  while (i < texts.length) {
    let end = i;
    let tokens = 0;
    while (end < texts.length && (end === i || tokens + approxTokens(texts[end]) <= BATCH_TOKENS)) tokens += approxTokens(texts[end++]);
    try {
      const vectors = await request(texts.slice(i, end), "document");
      vectors.forEach((v, j) => (out[i + j] = v));
      i = end;
    } catch (err) {
      if (!(err instanceof RateLimitedError) || Date.now() + RATE_LIMIT_WAIT_MS > deadline) {
        console.warn(`[embeddings] stopped after ${i}/${texts.length} chunks:`, err instanceof Error ? err.message : err);
        break;
      }
      await new Promise((r) => setTimeout(r, RATE_LIMIT_WAIT_MS));
    }
  }
  return out;
}

import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { db, meetings, speakers, transcriptChunks, transcriptSegments } from "@/db";
import { RAG_CANDIDATES, RAG_CHUNK_CHARS, RAG_TOP_K } from "@/lib/limits";
import { renderTranscript, type TranscriptLine } from "@/lib/pipeline/ai";
import { embedDocuments, embedQuery } from "./embeddings";

type Line = TranscriptLine & { endMs: number };

/**
 * Windows of whole transcript lines, ~RAG_CHUNK_CHARS each, overlapping by one line so an exchange that straddles
 * a boundary is retrievable from either side.
 */
export function chunkLines(lines: Line[], targetChars = RAG_CHUNK_CHARS) {
  const chunks: Line[][] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let chars = 0;
    while (end < lines.length && (end === start || chars < targetChars)) chars += lines[end++].text.length;
    chunks.push(lines.slice(start, end));
    if (end >= lines.length) break;
    // Overlap by the last line, unless that would make it a chunk of its own (one line longer than the target).
    start = end - 1 > start && lines[end - 1].text.length < targetChars ? end - 1 : end;
  }
  return chunks;
}

const INSERT_BATCH = 25; // 1024-dim vectors are ~10 KB each as SQL text; neon-http caps the request size.

/**
 * (Re)builds a meeting's retrieval index: chunk, prefix each chunk with its meeting (contextual chunk header),
 * embed, store. Chunks Voyage didn't get to before `deadline` are stored without a vector: keyword retrieval still
 * finds them, and `npm run index` fills the vectors in later.
 */
export async function indexMeeting(meetingId: string, { deadline = Infinity } = {}) {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting) return { chunks: 0, embedded: 0 };
  const rows = await db
    .select({
      startMs: transcriptSegments.startMs,
      endMs: transcriptSegments.endMs,
      text: transcriptSegments.text,
      label: speakers.label,
      displayName: speakers.displayName,
    })
    .from(transcriptSegments)
    .leftJoin(speakers, eq(transcriptSegments.speakerId, speakers.id))
    .where(eq(transcriptSegments.meetingId, meetingId))
    .orderBy(asc(transcriptSegments.startMs));
  const lines = rows.map((r) => ({ startMs: r.startMs, endMs: r.endMs, text: r.text, speaker: r.displayName || r.label || "Unknown" }));

  const header = `Meeting: ${meeting.title} (${meeting.startedAt.toISOString().slice(0, 10)})`;
  const chunks = chunkLines(lines).map((c) => ({
    startMs: c[0].startMs,
    endMs: Math.max(...c.map((l) => l.endMs)),
    content: `${header}\n${renderTranscript(c)}`,
  }));
  const vectors = await embedDocuments(
    chunks.map((c) => c.content),
    deadline,
  );

  await db.delete(transcriptChunks).where(eq(transcriptChunks.meetingId, meetingId));
  const values = chunks.map((c, i) => ({ meetingId, ...c, embedding: vectors[i] }));
  for (let i = 0; i < values.length; i += INSERT_BATCH) await db.insert(transcriptChunks).values(values.slice(i, i + INSERT_BATCH));
  return { chunks: chunks.length, embedded: vectors.filter(Boolean).length };
}

/** Never fails the caller: a meeting without an index is still usable, just not retrievable yet. */
export async function indexMeetingSafely(meetingId: string, budgetMs: number) {
  try {
    const { chunks, embedded } = await indexMeeting(meetingId, { deadline: Date.now() + budgetMs });
    if (embedded < chunks) console.warn(`[rag] meeting ${meetingId}: embedded ${embedded}/${chunks} chunks; run npm run index`);
  } catch (err) {
    console.error(`[rag] indexing meeting ${meetingId} failed`, err);
  }
}

export type RetrievedChunk = { id: number; meetingId: string; startMs: number; endMs: number; score: number };
export type RetrievalMode = "hybrid" | "keyword";

// Reciprocal Rank Fusion: rank-based, so cosine distances and ts_rank scores never have to be calibrated.
const RRF_K = 60;

/**
 * Hybrid retrieval over every ready meeting: pgvector cosine search (meaning) + Postgres full-text search (exact
 * names, numbers, jargon), fused with RRF. If the query can't be embedded it degrades to keyword-only.
 */
export async function retrieve(query: string): Promise<{ chunks: RetrievedChunk[]; mode: RetrievalMode }> {
  const queryVector = await embedQuery(query).catch((err) => {
    console.warn("[rag] query embedding unavailable, keyword retrieval only:", err instanceof Error ? err.message : err);
    return null;
  });

  const ready = eq(meetings.status, "ready");
  const cols = { id: transcriptChunks.id, meetingId: transcriptChunks.meetingId, startMs: transcriptChunks.startMs, endMs: transcriptChunks.endMs };
  // Questions are prose, so match ANY meaningful word (websearch_to_tsquery would require all of them); ts_rank orders.
  const tsq = sql`replace(plainto_tsquery('english', ${query})::text, ' & ', ' | ')::tsquery`;

  const [semantic, keyword] = await Promise.all([
    queryVector
      ? db
          .select(cols)
          .from(transcriptChunks)
          .innerJoin(meetings, eq(transcriptChunks.meetingId, meetings.id))
          .where(and(ready, isNotNull(transcriptChunks.embedding)))
          .orderBy(sql`${transcriptChunks.embedding} <=> ${JSON.stringify(queryVector)}::vector`)
          .limit(RAG_CANDIDATES)
      : Promise.resolve([]),
    db
      .select(cols)
      .from(transcriptChunks)
      .innerJoin(meetings, eq(transcriptChunks.meetingId, meetings.id))
      .where(and(ready, sql`${transcriptChunks.tsv} @@ ${tsq}`))
      .orderBy(sql`ts_rank_cd(${transcriptChunks.tsv}, ${tsq}) desc`)
      .limit(RAG_CANDIDATES),
  ]);

  const fused = new Map<number, RetrievedChunk>();
  for (const list of [semantic, keyword]) {
    list.forEach((c, rank) => {
      const prev = fused.get(c.id);
      fused.set(c.id, { ...c, score: (prev?.score ?? 0) + 1 / (RRF_K + rank + 1) });
    });
  }
  return {
    chunks: [...fused.values()].sort((a, b) => b.score - a.score).slice(0, RAG_TOP_K),
    mode: queryVector ? "hybrid" : "keyword",
  };
}

/**
 * The retrieved passages as the model sees them, grouped by meeting in time order. Overlapping chunks merge into one
 * excerpt, and lines are re-read from transcript_segments so speaker renames and diarization fixes apply.
 */
export async function renderExcerpts(chunks: RetrievedChunk[]) {
  const byMeeting = new Map<string, { startMs: number; endMs: number }[]>();
  for (const c of [...chunks].sort((a, b) => a.startMs - b.startMs)) {
    const ranges = byMeeting.get(c.meetingId) ?? [];
    const last = ranges.at(-1);
    if (last && c.startMs <= last.endMs) last.endMs = Math.max(last.endMs, c.endMs);
    else ranges.push({ startMs: c.startMs, endMs: c.endMs });
    byMeeting.set(c.meetingId, ranges);
  }
  if (byMeeting.size === 0) return new Map<string, string[]>();

  const rows = await db
    .select({
      meetingId: transcriptSegments.meetingId,
      startMs: transcriptSegments.startMs,
      text: transcriptSegments.text,
      label: speakers.label,
      displayName: speakers.displayName,
    })
    .from(transcriptSegments)
    .leftJoin(speakers, eq(transcriptSegments.speakerId, speakers.id))
    .where(
      and(
        inArray(transcriptSegments.meetingId, [...byMeeting.keys()]),
        or(
          ...[...byMeeting].flatMap(([meetingId, ranges]) =>
            ranges.map((r) =>
              and(eq(transcriptSegments.meetingId, meetingId), gte(transcriptSegments.startMs, r.startMs), lt(transcriptSegments.startMs, r.endMs)),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(transcriptSegments.startMs));

  const out = new Map<string, string[]>();
  for (const [meetingId, ranges] of byMeeting) {
    out.set(
      meetingId,
      ranges
        .map((r) =>
          renderTranscript(
            rows
              .filter((l) => l.meetingId === meetingId && l.startMs >= r.startMs && l.startMs < r.endMs)
              .map((l) => ({ startMs: l.startMs, text: l.text, speaker: l.displayName || l.label || "Unknown" })),
          ),
        )
        .filter(Boolean),
    );
  }
  return out;
}

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, meetings, speakers, summaries } from "@/db";
import { loadTranscriptText } from "@/lib/pipeline";
import { renderExcerpts, retrieve } from "@/lib/rag";
import { formatMs } from "@/lib/time";

const client = new Anthropic();
const model = () => process.env.LLM_MODEL || "claude-haiku-4-5";

export type AskTurn = { question: string; answer: string };

const RULES = `Answer questions about recorded meetings using only the material provided.
- Be direct and specific: names, numbers, decisions, dates. Lead with the answer; keep it short unless asked for detail.
- When asked what someone said, quote or closely paraphrase them, and say who they were talking to if the transcript shows it.
- If the material doesn't contain the answer, say so plainly. Never guess or invent.
- Speakers may appear as "Speaker N" when their name is unknown; use the names shown.
- Formatting: plain sentences, short "- " bullet lists when listing several things, **bold** sparingly. No headings, no tables.`;

const MEETING_CITES = `- Cite the moment behind each claim with its timestamp in double brackets, copied from the transcript, e.g. [[12:34]].`;
const LIBRARY_CITES = `- You get a catalog of every meeting (with overviews) and transcript excerpts retrieved for this question. The excerpts are not complete transcripts: if they don't cover the question, say what you couldn't find rather than filling the gap.
- Cite the moment behind each claim as [[MEETING_ID@TIMESTAMP]], e.g. [[aB3xY9kLmN@12:34]], using the meeting id attribute and a timestamp copied from that transcript. When citing a meeting in general rather than a moment, use [[MEETING_ID@0:00]].
- Mention which meeting (by title and date) each point comes from.`;

const attr = (v: string) => v.replace(/"/g, "'");

function dateLabel(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

async function speakerLine(meetingId: string) {
  const rows = await db.select().from(speakers).where(eq(speakers.meetingId, meetingId)).orderBy(desc(speakers.talkTimeS));
  return rows.map((s) => `${s.displayName || s.label} (${Math.round(s.talkTimeS / 60)} min talking)`).join(", ");
}

/** One meeting: header + the full transcript. Stable text so repeated questions hit the prompt cache. */
export async function meetingContext(meetingId: string) {
  const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!m || m.status !== "ready") return null;
  const transcript = await loadTranscriptText(meetingId);
  if (!transcript.trim()) return null;
  const invitees = m.attendees.length ? `\nCalendar invitees: ${m.attendees.join(", ")}` : "";
  return `<meeting title="${attr(m.title)}" date="${dateLabel(m.startedAt)}" duration="${formatMs(m.durationS * 1000)}">
Speakers: ${await speakerLine(meetingId)}${invitees}
<transcript>
${transcript}
</transcript>
</meeting>`;
}

/**
 * Library-wide questions (RAG). Two parts:
 * - a catalog of every ready meeting (title, date, speakers, overview), so "which meetings…" questions work and the
 *   model knows what exists. Changes only when meetings do, so it sits in the cached prompt block;
 * - the transcript excerpts hybrid retrieval ranked most relevant to this question.
 */
export async function libraryContext(question: string, history: AskTurn[]) {
  const rows = await db.select().from(meetings).where(eq(meetings.status, "ready")).orderBy(desc(meetings.startedAt)).limit(100);
  if (rows.length === 0) return null;
  const ids = rows.map((m) => m.id);

  // A follow-up ("what about her deadline?") only makes sense with the question before it.
  const retrievalQuery = [history.at(-1)?.question, question].filter(Boolean).join("\n");
  const [summaryRows, { chunks, mode }] = await Promise.all([
    db.select().from(summaries).where(and(inArray(summaries.meetingId, ids), eq(summaries.template, "general"))),
    retrieve(retrievalQuery),
  ]);
  const excerpts = await renderExcerpts(chunks);

  const catalog: string[] = [];
  for (const m of rows) {
    const overview = summaryRows.find((s) => s.meetingId === m.id)?.content.overview ?? "n/a";
    catalog.push(`<meeting id="${m.id}" title="${attr(m.title)}" date="${dateLabel(m.startedAt)}" duration="${formatMs(m.durationS * 1000)}">
Speakers: ${await speakerLine(m.id)}
Overview: ${overview}
</meeting>`);
  }

  const passages = rows
    .filter((m) => excerpts.has(m.id))
    .flatMap((m) =>
      excerpts.get(m.id)!.map((text) => `<excerpt meeting_id="${m.id}" meeting_title="${attr(m.title)}">\n${text}\n</excerpt>`),
    );

  return {
    context: `<meetings>\n${catalog.join("\n\n")}\n</meetings>`,
    retrieved: passages.length ? `<excerpts>\n${passages.join("\n\n")}\n</excerpts>` : "<excerpts>\n(no matching passages)\n</excerpts>",
    mode,
  };
}

export function askCacheKey(scope: string, context: string, question: string, history: AskTurn[]) {
  const normalized = question.trim().toLowerCase().replace(/\s+/g, " ").replace(/[?.!]+$/, "");
  return createHash("sha256")
    .update(JSON.stringify([scope, createHash("sha256").update(context).digest("hex"), normalized, history]))
    .digest("hex");
}

/**
 * Streams the answer text. The stable context (a meeting's transcript, or the library catalog) sits in a cached system
 * block so follow-ups are cheap; per-question retrieved excerpts come after it, outside the cached prefix.
 */
export function streamAnswer(opts: { scope: "meeting" | "library"; context: string; retrieved?: string; question: string; history: AskTurn[] }) {
  const messages: Anthropic.MessageParam[] = [];
  for (const turn of opts.history.slice(-3)) {
    messages.push({ role: "user", content: turn.question }, { role: "assistant", content: turn.answer });
  }
  messages.push({ role: "user", content: opts.question });

  return client.messages.stream({
    model: model(),
    max_tokens: 2000,
    system: [
      { type: "text", text: `${RULES}\n${opts.scope === "meeting" ? MEETING_CITES : LIBRARY_CITES}` },
      { type: "text", text: opts.context, cache_control: { type: "ephemeral" } },
      ...(opts.retrieved ? [{ type: "text" as const, text: opts.retrieved }] : []),
    ],
    messages,
  });
}

/** Appended to a stream when generation fails part-way, so the client can show an error. */
export const ASK_ERROR_MARKER = "<<ASK_ERROR>>";

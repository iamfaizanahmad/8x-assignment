import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { actionItems, db, meetings, speakers, summaries } from "@/db";
import { ASK_LIBRARY_TRANSCRIPT_CHARS } from "@/lib/limits";
import { loadTranscriptText } from "@/lib/pipeline";
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
const LIBRARY_CITES = `- Cite the moment behind each claim as [[MEETING_ID@TIMESTAMP]], e.g. [[aB3xY9kLmN@12:34]], using the meeting id attribute and a timestamp copied from that transcript. When citing a meeting in general rather than a moment, use [[MEETING_ID@0:00]].
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
 * Every ready meeting, newest first. Whole transcripts while they fit the budget (best answers for a demo-sized
 * library); older meetings beyond it contribute their summary and action items instead.
 */
export async function libraryContext() {
  const rows = await db.select().from(meetings).where(eq(meetings.status, "ready")).orderBy(desc(meetings.startedAt)).limit(100);
  if (rows.length === 0) return null;
  const ids = rows.map((m) => m.id);
  const [summaryRows, actionRows] = await Promise.all([
    db.select().from(summaries).where(and(inArray(summaries.meetingId, ids), eq(summaries.template, "general"))),
    db.select().from(actionItems).where(inArray(actionItems.meetingId, ids)).orderBy(asc(actionItems.timestampMs)),
  ]);

  let budget = ASK_LIBRARY_TRANSCRIPT_CHARS;
  const parts: string[] = [];
  for (const m of rows) {
    const header = `<meeting id="${m.id}" title="${attr(m.title)}" date="${dateLabel(m.startedAt)}" duration="${formatMs(m.durationS * 1000)}">
Speakers: ${await speakerLine(m.id)}`;
    const transcript = await loadTranscriptText(m.id);
    if (transcript && transcript.length <= budget) {
      budget -= transcript.length;
      parts.push(`${header}\n<transcript>\n${transcript}\n</transcript>\n</meeting>`);
      continue;
    }
    const summary = summaryRows.find((s) => s.meetingId === m.id)?.content;
    const bullets = summary?.sections
      .flatMap((sec) => sec.bullets.map((b) => `- ${sec.heading}: ${b.text}${b.timestampMs != null ? ` [${formatMs(b.timestampMs)}]` : ""}`))
      .join("\n");
    const actions = actionRows
      .filter((a) => a.meetingId === m.id)
      .map((a) => `- ${a.owner ? `${a.owner}: ` : ""}${a.text}${a.timestampMs != null ? ` [${formatMs(a.timestampMs)}]` : ""}`)
      .join("\n");
    parts.push(
      `${header}\n(Transcript omitted for length; summary only.)\nOverview: ${summary?.overview ?? "n/a"}\n${bullets ?? ""}\nAction items:\n${actions || "- none"}\n</meeting>`,
    );
  }
  return parts.join("\n\n");
}

export function askCacheKey(scope: string, context: string, question: string, history: AskTurn[]) {
  const normalized = question.trim().toLowerCase().replace(/\s+/g, " ").replace(/[?.!]+$/, "");
  return createHash("sha256")
    .update(JSON.stringify([scope, createHash("sha256").update(context).digest("hex"), normalized, history]))
    .digest("hex");
}

/** Streams the answer text. The context sits in a cached system block, so follow-ups on the same scope are cheap. */
export function streamAnswer(opts: { scope: "meeting" | "library"; context: string; question: string; history: AskTurn[] }) {
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
    ],
    messages,
  });
}

/** Appended to a stream when generation fails part-way, so the client can show an error. */
export const ASK_ERROR_MARKER = "<<ASK_ERROR>>";

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Chapter, SummaryContent, TemplateId } from "@/db/schema";
import { formatMs, parseTimestamp } from "@/lib/time";
import { TEMPLATES } from "./templates";

const client = new Anthropic();
const model = () => process.env.LLM_MODEL || "claude-haiku-4-5";

export type TranscriptLine = { startMs: number; speaker: string; text: string };

export function renderTranscript(lines: TranscriptLine[]) {
  return lines.map((l) => `[${formatMs(l.startMs)}] ${l.speaker}: ${l.text}`).join("\n");
}

const SYSTEM = `You are the note-taker for a recorded meeting. You receive a diarized transcript where each line is "[timestamp] Speaker: text".
Rules:
- Be concrete and specific: names, numbers, decisions, dates. No filler like "the team discussed various topics".
- Every bullet cites the timestamp (copied exactly from the transcript line) where the point was made.
- Refer to people by name if the transcript reveals it; otherwise use the speaker label.
- Never invent anything that is not in the transcript.`;

const bulletSchema = {
  type: "object",
  properties: { text: { type: "string" }, timestamp: { type: "string", description: "e.g. 12:34" } },
  required: ["text", "timestamp"],
} as const;

const summarySchema = {
  type: "object",
  properties: {
    overview: { type: "string", description: "2-3 sentence overview of the meeting" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: { heading: { type: "string" }, bullets: { type: "array", items: bulletSchema } },
        required: ["heading", "bullets"],
      },
    },
  },
  required: ["overview", "sections"],
} as const;

type RawSummary = { overview: string; sections: { heading: string; bullets: { text: string; timestamp?: string }[] }[] };

function toSummary(raw: RawSummary): SummaryContent {
  return {
    overview: raw.overview ?? "",
    sections: (raw.sections ?? []).map((s) => ({
      heading: s.heading,
      bullets: (s.bullets ?? []).map((b) => ({ text: b.text, timestampMs: parseTimestamp(b.timestamp) })),
    })),
  };
}

async function callTool<T>(name: string, description: string, schema: object, prompt: string, system = SYSTEM): Promise<T> {
  const res = await client.messages.create({
    model: model(),
    max_tokens: 16000,
    system,
    tools: [{ name, description, input_schema: schema as Anthropic.Tool.InputSchema }],
    tool_choice: { type: "tool", name },
    messages: [{ role: "user", content: prompt }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error(`Claude returned no ${name} output (stop: ${res.stop_reason})`);
  return block.input as T;
}

/** Calendar invitees help the model put names to "Speaker N" when the conversation makes it clear who is who. */
function attendeeHint(attendees: string[]) {
  return attendees.length ? `Calendar invitees (may not all have spoken): ${attendees.join(", ")}\n\n` : "";
}

export type MeetingAnalysis = {
  title: string;
  chapters: Chapter[];
  summary: SummaryContent;
  actionItems: ExtractedActionItem[];
};

export type ExtractedActionItem = {
  text: string;
  /** A roster label ("Speaker 2"), or undefined when nobody on the call clearly owns it. */
  ownerLabel?: string;
  timestampMs?: number;
  dueDate?: string;
  duePhrase?: string;
};

export type AnalysisContext = {
  attendees?: string[];
  /** Everyone diarized in the recording, with their current names if known. */
  speakers: { label: string; name: string | null }[];
  /** Only when the meeting's date is known (calendar-attached); otherwise relative deadlines can't be resolved. */
  meetingDate?: Date;
};

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Keep a due date only when it can be trusted: a relative phrase needs a known meeting date to anchor it,
 * and the date must land on/after the meeting and within a year. Otherwise there's no chip rather than a wrong one.
 */
export function checkDueDate(dueDate: string | undefined, phrase: string | undefined, meetingDate: Date | undefined) {
  if (!dueDate || !phrase?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return {};
  const due = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(due.getTime()) || isoDay(due) !== dueDate) return {};
  if (meetingDate) {
    const start = new Date(`${isoDay(meetingDate)}T00:00:00Z`).getTime();
    if (due.getTime() < start || due.getTime() > start + 366 * DAY_MS) return {};
  } else if (!/\b(19|20)\d{2}\b/.test(phrase)) {
    return {};
  }
  return { dueDate, duePhrase: phrase.trim().slice(0, 120) };
}

function rosterHint(ctx: AnalysisContext) {
  const roster = ctx.speakers.map((s) => (s.name && s.name !== s.label ? `${s.label} (${s.name})` : s.label)).join(", ");
  const date = ctx.meetingDate
    ? `Meeting date: ${ctx.meetingDate.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })} ${isoDay(ctx.meetingDate)}`
    : "Meeting date: unknown";
  return `Speakers in this recording: ${roster}\n${date}\n\n`;
}

/** One call per meeting: title + chapters + General summary + action items. */
export async function analyzeMeeting(transcript: string, ctx: AnalysisContext): Promise<MeetingAnalysis> {
  const labels = ctx.speakers.map((s) => s.label);
  const raw = await callTool<{
    title: string;
    chapters: { title: string; timestamp: string }[];
    summary: RawSummary;
    action_items: { text: string; owner_speaker?: string; timestamp?: string; due_date?: string; due_phrase?: string }[];
  }>(
    "record_meeting_notes",
    "Record the notes for this meeting.",
    {
      type: "object",
      properties: {
        title: { type: "string", description: "Short specific meeting title, max 8 words" },
        chapters: {
          type: "array",
          description: "Chronological topic chapters. ~1 per 3-8 minutes of meeting; 2-12 total.",
          items: {
            type: "object",
            properties: { title: { type: "string" }, timestamp: { type: "string" } },
            required: ["title", "timestamp"],
          },
        },
        summary: { ...summarySchema, description: TEMPLATES.general.instructions },
        action_items: {
          type: "array",
          description: "Concrete commitments someone made or was assigned. Empty if none.",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "Imperative, e.g. 'Send pricing deck to Acme'" },
              owner_speaker: {
                type: "string",
                enum: [...labels, "unassigned"],
                description:
                  "The speaker who committed to it or was clearly assigned it, as their label from the speaker list. " +
                  "'unassigned' if it belongs to a group, an organisation, someone who isn't a speaker, or it's unclear. Never guess.",
              },
              timestamp: { type: "string", description: "Timestamp of the line where the commitment is made, copied exactly" },
              due_phrase: {
                type: "string",
                description: "Only if a deadline is stated: the exact words, e.g. 'before Friday', 'by 3 October 2026'. Omit otherwise.",
              },
              due_date: {
                type: "string",
                description:
                  "YYYY-MM-DD for due_phrase, resolved against the meeting date. Omit if there is no deadline, " +
                  "or if the meeting date is unknown and the phrase doesn't state the year.",
              },
            },
            required: ["text", "owner_speaker", "timestamp"],
          },
        },
      },
      required: ["title", "chapters", "summary", "action_items"],
    },
    `${rosterHint(ctx)}${attendeeHint(ctx.attendees ?? [])}<transcript>\n${transcript}\n</transcript>`,
  );
  return {
    title: raw.title,
    chapters: (raw.chapters ?? [])
      .map((c) => ({ title: c.title, startMs: parseTimestamp(c.timestamp) ?? 0 }))
      .sort((a, b) => a.startMs - b.startMs),
    summary: toSummary(raw.summary),
    actionItems: (raw.action_items ?? [])
      .filter((a) => a.text?.trim())
      .map((a) => ({
        text: a.text.trim(),
        ownerLabel: a.owner_speaker && labels.includes(a.owner_speaker) ? a.owner_speaker : undefined,
        timestampMs: parseTimestamp(a.timestamp),
        ...checkDueDate(a.due_date, a.due_phrase, ctx.meetingDate),
      })),
  };
}

export async function summarizeWithTemplate(transcript: string, template: TemplateId, attendees: string[] = []): Promise<SummaryContent> {
  const t = TEMPLATES[template];
  const raw = await callTool<RawSummary>(
    "record_summary",
    `Record a "${t.name}" meeting summary.`,
    summarySchema,
    `${attendeeHint(attendees)}<transcript>\n${transcript}\n</transcript>\n\nWrite a "${t.name}" summary. ${t.instructions}`,
  );
  return toSummary(raw);
}

export type SpeakerNameSuggestion = {
  label: string;
  name: string;
  confidence: "high" | "medium";
  evidence: string;
  timestampMs?: number;
};

const SPEAKER_ID_SYSTEM = `You identify who is who in a diarized meeting transcript, where speakers are labelled "Speaker N".
Name a speaker only with direct evidence in the transcript:
- they introduce themselves ("I'm Priya from finance", "my name is…");
- someone addresses a person by name and that speaker is the one who replies next ("Over to you, Councillor Codd." then Speaker 4 answers);
- a chair or host calls on someone by name and that speaker immediately responds;
- invitee names can confirm a name heard in the transcript, but are never evidence on their own.
Titles and roles are fine as part of the name when that's how people are addressed ("Councillor Codd", "Dr Patel"). Spell names as they appear in the transcript.
Diarization is imperfect: short replies can be misattributed, so prefer evidence where the named person then speaks at length.
Confidence:
- "high": the speaker introduces themselves by name, OR they are addressed by name and reply in the very next line.
- "medium": anything less direct (named earlier in a list, a reply that isn't the next line, a name inferred from a role).
Each piece of evidence must support one speaker only; never reuse the same quote for two speakers.
Evidence is a verbatim quote without timestamps; put the key line's timestamp in the timestamp field.
Skip any speaker you can't name with evidence. Never guess from topic, tone or talk time.`;

/** Proposes real names for "Speaker N" labels, each backed by a quote. Nothing is applied until a person accepts it. */
export async function suggestSpeakerNames(transcriptByLabel: string, labels: string[], attendees: string[] = []) {
  const raw = await callTool<{
    speakers: { label: string; name: string; confidence: string; evidence: string; timestamp?: string }[];
  }>(
    "record_speaker_names",
    "Record the speakers you can identify by name, with evidence.",
    {
      type: "object",
      properties: {
        speakers: {
          type: "array",
          description: "Only speakers identified with evidence. Omit the rest.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", enum: labels },
              name: { type: "string", description: "How the person is named in the meeting, e.g. 'Councillor Codd' or 'Priya Shah'" },
              confidence: { type: "string", enum: ["high", "medium"] },
              evidence: { type: "string", description: "Short quote(s) from the transcript that establish the name, max 200 characters" },
              timestamp: { type: "string", description: "Timestamp of the key evidence line, copied from the transcript" },
            },
            required: ["label", "name", "confidence", "evidence"],
          },
        },
      },
      required: ["speakers"],
    },
    `${attendeeHint(attendees)}<transcript>\n${transcriptByLabel}\n</transcript>`,
    SPEAKER_ID_SYSTEM,
  );
  const seen = new Set<string>();
  return (raw.speakers ?? [])
    .filter((s) => labels.includes(s.label) && s.name?.trim() && !seen.has(s.label) && seen.add(s.label))
    .map<SpeakerNameSuggestion>((s) => {
      // Models sometimes inline "[12:34]" in the quote instead of using the field; recover it and tidy the quote.
      const inline = s.evidence.match(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/)?.[1];
      return {
        label: s.label,
        name: s.name.trim(),
        confidence: s.confidence === "high" ? "high" : "medium",
        evidence: s.evidence.replace(/\s*\[\d{1,2}:\d{2}(?::\d{2})?\]/g, "").trim().slice(0, 240),
        timestampMs: parseTimestamp(s.timestamp) ?? parseTimestamp(inline),
      };
    });
}

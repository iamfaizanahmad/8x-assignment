import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { actionItems, db, meetings, speakers, summaries, transcriptSegments, type TemplateId } from "@/db";
import { MAX_UPLOAD_DURATION_S } from "@/lib/limits";
import { objectExists, signDownload } from "@/lib/storage";
import { analyzeMeeting, renderTranscript, summarizeWithTemplate } from "./ai";
import { transcribeUrl } from "./deepgram";

async function setStatus(id: string, status: typeof meetings.$inferSelect.status, error: string | null = null) {
  await db.update(meetings).set({ status, error, statusUpdatedAt: new Date() }).where(eq(meetings.id, id));
}

/** Transcript as the model sees it, with renamed speakers applied. */
export async function loadTranscriptText(meetingId: string) {
  const rows = await db
    .select({
      startMs: transcriptSegments.startMs,
      text: transcriptSegments.text,
      label: speakers.label,
      displayName: speakers.displayName,
    })
    .from(transcriptSegments)
    .leftJoin(speakers, eq(transcriptSegments.speakerId, speakers.id))
    .where(eq(transcriptSegments.meetingId, meetingId))
    .orderBy(asc(transcriptSegments.startMs));
  return renderTranscript(rows.map((r) => ({ startMs: r.startMs, text: r.text, speaker: r.displayName || r.label || "Unknown" })));
}

/** Upload -> Deepgram -> one Claude call -> DB. Idempotent: clears previous derived rows first. */
export async function processMeeting(id: string) {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting?.mediaKey) throw new Error("Meeting has no media");

  try {
    await setStatus(id, "transcribing");
    if (!(await objectExists(meeting.mediaKey)))
      throw new Error("The recording file isn't in storage. If it was still uploading, wait for it to finish and retry; otherwise upload it again.");
    const { durationS, segments } = await transcribeUrl(await signDownload(meeting.mediaKey, 60 * 60));
    if (segments.length === 0) throw new Error("No speech detected in this recording");
    // Backstop only: the upload API already rejects long files using the duration the browser reads before uploading.
    if (meeting.source === "upload" && durationS > MAX_UPLOAD_DURATION_S)
      throw new Error(`Recording is ${Math.round(durationS / 60)} min; the demo limit is ${MAX_UPLOAD_DURATION_S / 60} min`);

    await db.delete(transcriptSegments).where(eq(transcriptSegments.meetingId, id));
    await db.delete(speakers).where(eq(speakers.meetingId, id));
    await db.delete(summaries).where(eq(summaries.meetingId, id));
    await db.delete(actionItems).where(eq(actionItems.meetingId, id));

    const talk = new Map<number, number>();
    for (const s of segments) talk.set(s.speaker, (talk.get(s.speaker) ?? 0) + (s.endMs - s.startMs));
    const speakerRows = await db
      .insert(speakers)
      .values(
        [...talk.keys()].sort((a, b) => a - b).map((n) => ({
          meetingId: id,
          label: `Speaker ${n + 1}`,
          talkTimeS: Math.round((talk.get(n) ?? 0) / 1000),
        })),
      )
      .returning();
    const speakerId = new Map(speakerRows.map((r) => [Number(r.label.split(" ")[1]) - 1, r.id]));

    // neon-http has a request size limit; insert in chunks for hour-long calls.
    for (let i = 0; i < segments.length; i += 200) {
      await db.insert(transcriptSegments).values(
        segments.slice(i, i + 200).map((s) => ({
          meetingId: id,
          speakerId: speakerId.get(s.speaker),
          startMs: s.startMs,
          endMs: s.endMs,
          text: s.text,
        })),
      );
    }
    await db.update(meetings).set({ durationS }).where(eq(meetings.id, id));

    await setStatus(id, "summarizing");
    const analysis = await analyzeMeeting(await loadTranscriptText(id), meeting.attendees);
    await db.insert(summaries).values({ meetingId: id, template: "general", content: analysis.summary });
    if (analysis.actionItems.length)
      await db.insert(actionItems).values(analysis.actionItems.map((a) => ({ meetingId: id, ...a })));
    await db
      .update(meetings)
      // A calendar event already has the title people know the meeting by.
      .set({
        title: meeting.calendarEventId ? meeting.title : analysis.title || meeting.title,
        chapters: analysis.chapters,
        status: "ready",
        error: null,
      })
      .where(eq(meetings.id, id));
  } catch (err) {
    console.error(`[pipeline] meeting ${id} failed`, err);
    await setStatus(id, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export class SummaryUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

/** Cached per (meeting, template): generated once, read from the DB forever after. */
export async function getOrCreateSummary(meetingId: string, template: TemplateId) {
  const findExisting = async () =>
    (await db.select().from(summaries).where(and(eq(summaries.meetingId, meetingId), eq(summaries.template, template))))[0];

  const existing = await findExisting();
  if (existing) return existing;

  // Validate before paying for a Claude call: the id must be a real, fully processed meeting with a transcript.
  const [meeting] = await db
    .select({ status: meetings.status, attendees: meetings.attendees })
    .from(meetings)
    .where(eq(meetings.id, meetingId));
  if (!meeting) throw new SummaryUnavailableError("Meeting not found", 404);
  if (meeting.status !== "ready") throw new SummaryUnavailableError("This meeting is still processing", 409);
  const transcript = await loadTranscriptText(meetingId);
  if (!transcript.trim()) throw new SummaryUnavailableError("This meeting has no transcript to summarize", 409);

  const content = await summarizeWithTemplate(transcript, template, meeting.attendees);
  // Two viewers can race to the same template; the unique index keeps one row and both get it back.
  await db.insert(summaries).values({ meetingId, template, content }).onConflictDoNothing();
  return (await findExisting())!;
}

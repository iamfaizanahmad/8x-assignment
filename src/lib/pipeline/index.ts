import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { actionItems, db, meetings, speakers, summaries, transcriptSegments, type TemplateId } from "@/db";
import { signDownload } from "@/lib/storage";
import { analyzeMeeting, renderTranscript, summarizeWithTemplate } from "./ai";
import { transcribeUrl } from "./deepgram";

export const MAX_UPLOAD_DURATION_S = 20 * 60;

async function setStatus(id: string, status: typeof meetings.$inferSelect.status, error: string | null = null) {
  await db.update(meetings).set({ status, error }).where(eq(meetings.id, id));
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
    const { durationS, segments } = await transcribeUrl(await signDownload(meeting.mediaKey, 60 * 60));
    if (segments.length === 0) throw new Error("No speech detected in this recording");
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
    const analysis = await analyzeMeeting(await loadTranscriptText(id));
    await db.insert(summaries).values({ meetingId: id, template: "general", content: analysis.summary });
    if (analysis.actionItems.length)
      await db.insert(actionItems).values(analysis.actionItems.map((a) => ({ meetingId: id, ...a })));
    await db
      .update(meetings)
      .set({ title: analysis.title || meeting.title, chapters: analysis.chapters, status: "ready", error: null })
      .where(eq(meetings.id, id));
  } catch (err) {
    console.error(`[pipeline] meeting ${id} failed`, err);
    await setStatus(id, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Cached per (meeting, template): generated once, read from the DB forever after. */
export async function getOrCreateSummary(meetingId: string, template: TemplateId) {
  const [existing] = await db
    .select()
    .from(summaries)
    .where(and(eq(summaries.meetingId, meetingId), eq(summaries.template, template)));
  if (existing) return existing;
  const content = await summarizeWithTemplate(await loadTranscriptText(meetingId), template);
  const [row] = await db.insert(summaries).values({ meetingId, template, content }).returning();
  return row;
}

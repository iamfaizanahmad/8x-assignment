import { createHash } from "crypto";
import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { askLog, db, meetings, speakers, transcriptSegments } from "@/db";
import { rejectIfSample } from "@/lib/guards";
import { ASK_PER_HOUR_GLOBAL, ASK_PER_HOUR_PER_VISITOR } from "@/lib/limits";
import { renderTranscript, suggestSpeakerNames, type SpeakerNameSuggestion } from "@/lib/pipeline/ai";
import { visitorHash } from "@/lib/visitor";

export const maxDuration = 120;

/** Bump when the prompt changes so stored suggestions from the old prompt aren't replayed. */
const PROMPT_VERSION = 2;

/** Suggest real names for "Speaker N" labels. Results are stored against the transcript, so repeat clicks are free. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blocked = await rejectIfSample(id);
  if (blocked) return blocked;

  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting || meeting.status !== "ready") return NextResponse.json({ error: "This meeting is still processing." }, { status: 409 });

  const speakerRows = await db.select().from(speakers).where(eq(speakers.meetingId, id));
  const rows = await db
    .select({ startMs: transcriptSegments.startMs, text: transcriptSegments.text, label: speakers.label })
    .from(transcriptSegments)
    .leftJoin(speakers, eq(transcriptSegments.speakerId, speakers.id))
    .where(eq(transcriptSegments.meetingId, id))
    .orderBy(asc(transcriptSegments.startMs));
  if (rows.length === 0) return NextResponse.json({ error: "This meeting has no transcript." }, { status: 409 });

  // Labels, not display names: the model maps "Speaker N" to a name, and existing renames don't bias it.
  const transcript = renderTranscript(rows.map((r) => ({ startMs: r.startMs, speaker: r.label ?? "Unknown", text: r.text })));
  const labels = speakerRows.map((s) => s.label);
  const cacheKey = createHash("sha256").update(JSON.stringify(["suggest-speakers", PROMPT_VERSION, id, transcript, meeting.attendees])).digest("hex");

  const [cached] = await db
    .select({ answer: askLog.answer })
    .from(askLog)
    .where(and(eq(askLog.cacheKey, cacheKey), isNotNull(askLog.answer)))
    .orderBy(desc(askLog.createdAt))
    .limit(1);
  let suggestions: SpeakerNameSuggestion[];
  if (cached?.answer) {
    suggestions = JSON.parse(cached.answer);
  } else {
    const visitor = visitorHash(req);
    const lastHour = gt(askLog.createdAt, sql`now() - interval '1 hour'`);
    const [[{ mine }], [{ total }]] = await Promise.all([
      db.select({ mine: sql<number>`count(*)::int` }).from(askLog).where(and(lastHour, eq(askLog.visitorHash, visitor))),
      db.select({ total: sql<number>`count(*)::int` }).from(askLog).where(lastHour),
    ]);
    if (mine >= ASK_PER_HOUR_PER_VISITOR || total >= ASK_PER_HOUR_GLOBAL)
      return NextResponse.json({ error: "AI request limit reached for this hour. Try again later." }, { status: 429 });

    try {
      suggestions = await suggestSpeakerNames(transcript, labels, meeting.attendees);
    } catch (err) {
      console.error("[suggest-speakers]", err);
      return NextResponse.json({ error: "Couldn't suggest names right now. Try again." }, { status: 500 });
    }
    await db.insert(askLog).values({
      visitorHash: visitor,
      meetingId: id,
      cacheKey,
      question: "[suggest speaker names]",
      answer: JSON.stringify(suggestions),
    });
  }

  const byLabel = new Map(speakerRows.map((s) => [s.label, s]));
  return NextResponse.json({
    suggestions: suggestions
      .map((s) => ({ ...s, speakerId: byLabel.get(s.label)?.id }))
      // Drop suggestions a person has already applied.
      .filter((s) => s.speakerId && byLabel.get(s.label)?.displayName !== s.name),
  });
}

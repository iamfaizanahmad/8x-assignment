import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, transcriptSegments } from "@/db";
import { rejectIfSample } from "@/lib/guards";

function splitSentences(text: string) {
  return text.split(/(?<=[.?!])\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Diarization sometimes glues two people's words into one line ("…anything for Fathom? No.").
 * Split it into sentences so each can be reassigned. Timings are apportioned by text length.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ segId: string }> }) {
  const { segId } = await params;
  const [seg] = await db.select().from(transcriptSegments).where(eq(transcriptSegments.id, Number(segId)));
  if (!seg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const blocked = await rejectIfSample(seg.meetingId);
  if (blocked) return blocked;

  const parts = splitSentences(seg.text);
  if (parts.length < 2) return NextResponse.json({ error: "This line is a single sentence" }, { status: 400 });

  const total = parts.reduce((n, p) => n + p.length, 0);
  const span = seg.endMs - seg.startMs;
  let cursor = seg.startMs;
  const rows = parts.map((text, i) => {
    const startMs = cursor;
    const endMs = i === parts.length - 1 ? seg.endMs : Math.round(cursor + (span * text.length) / total);
    cursor = endMs;
    return { meetingId: seg.meetingId, speakerId: seg.speakerId, startMs, endMs, text };
  });

  const inserted = await db.insert(transcriptSegments).values(rows).returning({
    id: transcriptSegments.id,
    speakerId: transcriptSegments.speakerId,
    startMs: transcriptSegments.startMs,
    endMs: transcriptSegments.endMs,
    text: transcriptSegments.text,
  });
  await db.delete(transcriptSegments).where(eq(transcriptSegments.id, seg.id));
  return NextResponse.json({ removedId: seg.id, segments: inserted });
}

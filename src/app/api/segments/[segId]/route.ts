import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, speakers, transcriptSegments } from "@/db";
import { rejectIfSample } from "@/lib/guards";

const body = z.union([z.object({ speakerId: z.number().int() }), z.object({ newSpeaker: z.literal(true) })]);

/** Reassign a transcript line to another speaker (or a brand-new one), then recompute talk time for the meeting. */
export async function PATCH(req: Request, { params }: { params: Promise<{ segId: string }> }) {
  const { segId } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const [segment] = await db.select().from(transcriptSegments).where(eq(transcriptSegments.id, Number(segId)));
  if (!segment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const meetingId = segment.meetingId;
  const blocked = await rejectIfSample(meetingId);
  if (blocked) return blocked;
  const existing = await db.select().from(speakers).where(eq(speakers.meetingId, meetingId));

  let targetId: number;
  if ("newSpeaker" in parsed.data) {
    const next = Math.max(0, ...existing.map((s) => Number(s.label.replace(/\D/g, "")) || 0)) + 1;
    const [created] = await db.insert(speakers).values({ meetingId, label: `Speaker ${next}` }).returning();
    targetId = created.id;
  } else {
    const target = existing.find((s) => s.id === (parsed.data as { speakerId: number }).speakerId);
    if (!target) return NextResponse.json({ error: "Speaker is not in this meeting" }, { status: 400 });
    targetId = target.id;
  }

  await db.update(transcriptSegments).set({ speakerId: targetId }).where(eq(transcriptSegments.id, segment.id));

  // Talk time is derived from segments, so recompute it for the whole meeting.
  await db
    .update(speakers)
    .set({
      talkTimeS: sql`coalesce((select round(sum(${transcriptSegments.endMs} - ${transcriptSegments.startMs}) / 1000.0)::int
        from ${transcriptSegments} where ${transcriptSegments.speakerId} = ${speakers.id}), 0)`,
    })
    .where(eq(speakers.meetingId, meetingId));
  // A speaker left with no lines was a diarization artefact; drop it unless someone named it.
  await db
    .delete(speakers)
    .where(
      and(
        eq(speakers.meetingId, meetingId),
        sql`${speakers.displayName} is null`,
        sql`not exists (select 1 from ${transcriptSegments} where ${transcriptSegments.speakerId} = ${speakers.id})`,
      ),
    );

  const updated = await db.select().from(speakers).where(eq(speakers.meetingId, meetingId));
  return NextResponse.json({ segmentId: segment.id, speakerId: targetId, speakers: updated });
}

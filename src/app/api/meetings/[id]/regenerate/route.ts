import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, meetings, summaries } from "@/db";
import { rejectIfSample } from "@/lib/guards";
import { analyzeMeeting } from "@/lib/pipeline/ai";
import { analysisContext, loadTranscriptText, replaceActionItems } from "@/lib/pipeline";

export const maxDuration = 120;

/** Re-run notes after speaker fixes: one Claude call; other templates regenerate lazily when opened. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blocked = await rejectIfSample(id);
  if (blocked) return blocked;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (meeting.status !== "ready") return NextResponse.json({ error: "Meeting is still processing" }, { status: 409 });

  try {
    const analysis = await analyzeMeeting(await loadTranscriptText(id), await analysisContext(meeting));
    await db.delete(summaries).where(eq(summaries.meetingId, id));
    await db.insert(summaries).values({ meetingId: id, template: "general", content: analysis.summary });
    // Keeps ticked items ticked when they come back from the new extraction.
    await replaceActionItems(id, analysis.actionItems);
    await db.update(meetings).set({ chapters: analysis.chapters }).where(eq(meetings.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[regenerate]", err);
    return NextResponse.json({ error: "Could not regenerate notes. Try again." }, { status: 500 });
  }
}

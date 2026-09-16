import { eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { db, meetings } from "@/db";
import { STALE_PROCESSING_MS } from "@/lib/limits";
import { processMeeting } from "@/lib/pipeline";

export const maxDuration = 300;

/** Called by the browser once the S3 upload finishes (or from the Retry button). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (meeting.source === "seed") return NextResponse.json({ error: "Seed meetings are pre-processed" }, { status: 400 });
  const running = meeting.status === "transcribing" || meeting.status === "summarizing";
  // A run that outlived the function timeout is dead; let Retry start a fresh one.
  if (running && Date.now() - meeting.statusUpdatedAt.getTime() < STALE_PROCESSING_MS) return NextResponse.json({ status: meeting.status });
  if (meeting.status === "ready") return NextResponse.json({ status: "ready" });

  await db.update(meetings).set({ status: "transcribing", error: null, statusUpdatedAt: new Date() }).where(eq(meetings.id, id));
  after(() => processMeeting(id).catch(() => {}));
  return NextResponse.json({ status: "transcribing" });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [meeting] = await db
    .select({ status: meetings.status, error: meetings.error, statusUpdatedAt: meetings.statusUpdatedAt })
    .from(meetings)
    .where(eq(meetings.id, id));
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(meeting);
}

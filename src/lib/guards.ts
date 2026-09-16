import "server-only";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, meetings } from "@/db";

/**
 * The public demo has no accounts, so seeded showcase meetings are read-only apart from additive actions
 * (new highlights, share links, ticking action items). Returns a 403 response when the meeting is a seed.
 */
export async function rejectIfSample(meetingId: string) {
  const [m] = await db.select({ source: meetings.source }).from(meetings).where(eq(meetings.id, meetingId));
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (m.source === "seed")
    return NextResponse.json({ error: "Sample meetings are read-only on the public demo. Upload your own to edit." }, { status: 403 });
  return null;
}

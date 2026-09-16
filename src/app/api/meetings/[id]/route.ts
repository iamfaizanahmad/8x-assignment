import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, meetings } from "@/db";
import { deleteObject } from "@/lib/storage";

/** Deletes the meeting and (via FK cascade) its transcript, notes, highlights and share links, plus the recording. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The public demo has no accounts: keep the seeded showcase meetings safe from visitors.
  if (meeting.source === "seed")
    return NextResponse.json({ error: "Sample meetings can't be deleted on the public demo." }, { status: 403 });

  await db.delete(meetings).where(eq(meetings.id, id));
  const mediaDeleted = meeting.mediaKey ? await deleteObject(meeting.mediaKey) : true;
  return NextResponse.json({ ok: true, mediaDeleted });
}

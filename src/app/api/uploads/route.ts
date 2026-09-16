import { and, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, meetings } from "@/db";
import { CalendarAuthError, getEvent } from "@/lib/calendar/google";
import { getConnection } from "@/lib/calendar/session";
import { signUpload } from "@/lib/storage";

const UPLOADS_PER_HOUR = 10;
const MAX_BYTES = 500 * 1024 * 1024;

const body = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().regex(/^(audio|video)\//, "Only audio or video files are supported"),
  size: z.number().int().positive().max(MAX_BYTES, "File is larger than 500 MB"),
  calendarEventId: z.string().max(1024).optional(),
});

export async function POST(req: Request) {
  if (process.env.UPLOADS_ENABLED !== "true")
    return NextResponse.json({ error: "Uploads are disabled in this demo." }, { status: 403 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const { filename, contentType, calendarEventId } = parsed.data;

  // Global cap: serverless has no shared memory, so count recent uploads in Postgres.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(meetings)
    .where(and(eq(meetings.source, "upload"), gt(meetings.createdAt, sql`now() - interval '1 hour'`)));
  if (count >= UPLOADS_PER_HOUR)
    return NextResponse.json({ error: "Upload limit reached for this hour. Try again later." }, { status: 429 });

  const id = nanoid(10);
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "bin";
  const mediaKey = `meetings/${id}/recording.${ext}`;
  let title = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled meeting";
  let startedAt: Date | undefined;
  let attendees: string[] = [];

  // Filing against a calendar event: look it up with this browser's own connection, never trust client-sent details.
  if (calendarEventId) {
    const conn = await getConnection();
    if (!conn) return NextResponse.json({ error: "Connect your calendar first." }, { status: 401 });
    try {
      const event = await getEvent(conn, calendarEventId);
      if (!event) return NextResponse.json({ error: "That calendar event can't be recorded." }, { status: 400 });
      title = event.title;
      startedAt = new Date(event.start);
      attendees = event.attendees.map((a) => a.name);
    } catch (err) {
      const msg = err instanceof CalendarAuthError ? err.message : "Couldn't load that calendar event.";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  await db.insert(meetings).values({
    id,
    title,
    mediaKey,
    mediaType: contentType,
    source: "upload",
    calendarEventId,
    attendees,
    ...(startedAt ? { startedAt } : {}),
  });
  return NextResponse.json({ id, uploadUrl: await signUpload(mediaKey, contentType) });
}

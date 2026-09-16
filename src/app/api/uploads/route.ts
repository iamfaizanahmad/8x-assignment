import { createHash } from "crypto";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, meetings } from "@/db";
import { CalendarAuthError, getEvent } from "@/lib/calendar/google";
import { getConnection } from "@/lib/calendar/session";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_DURATION_S,
  STALE_UPLOAD_MS,
  UPLOADS_PER_HOUR_GLOBAL,
  UPLOADS_PER_HOUR_PER_VISITOR,
} from "@/lib/limits";
import { signUpload } from "@/lib/storage";


const body = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().regex(/^(audio|video)\//, "Only audio or video files are supported"),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES, "File is larger than 2 GB"),
  /** Read by the browser from the file's metadata before uploading; null if it couldn't be read. */
  durationS: z.number().nonnegative().nullable().optional(),
  calendarEventId: z.string().max(1024).optional(),
});

export async function POST(req: Request) {
  if (process.env.UPLOADS_ENABLED !== "true")
    return NextResponse.json({ error: "Uploads are disabled in this demo." }, { status: 403 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const { filename, contentType, calendarEventId, durationS } = parsed.data;

  // Reject long recordings before anything is uploaded or sent to Deepgram (which bills per audio minute).
  if (durationS != null && durationS > MAX_UPLOAD_DURATION_S)
    return NextResponse.json(
      { error: `This recording is ${Math.round(durationS / 60)} minutes. The public demo accepts up to ${MAX_UPLOAD_DURATION_S / 60}.` },
      { status: 400 },
    );

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const uploaderHash = createHash("sha256").update(`${process.env.TOKEN_ENCRYPTION_KEY}:${ip}`).digest("hex").slice(0, 32);

  // Serverless has no shared memory, so rate limits count recent uploads in Postgres.
  // Uploads abandoned before the file arrived don't count against anyone.
  const recent = and(
    eq(meetings.source, "upload"),
    gt(meetings.createdAt, sql`now() - interval '1 hour'`),
    or(sql`${meetings.status} <> 'uploaded'`, gt(meetings.createdAt, new Date(Date.now() - STALE_UPLOAD_MS))),
  );
  const [[{ total }], [{ mine }]] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(meetings).where(recent),
    db.select({ mine: sql<number>`count(*)::int` }).from(meetings).where(and(recent, eq(meetings.uploaderHash, uploaderHash))),
  ]);
  if (mine >= UPLOADS_PER_HOUR_PER_VISITOR)
    return NextResponse.json({ error: `You can upload ${UPLOADS_PER_HOUR_PER_VISITOR} recordings per hour on the demo. Try again later.` }, { status: 429 });
  if (total >= UPLOADS_PER_HOUR_GLOBAL)
    return NextResponse.json({ error: "The demo's hourly upload limit is reached. Try again later." }, { status: 429 });

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
    uploaderHash,
    ...(startedAt ? { startedAt } : {}),
  });
  return NextResponse.json({ id, uploadUrl: await signUpload(mediaKey, contentType, 60 * 60) });
}

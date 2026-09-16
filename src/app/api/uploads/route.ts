import { and, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, meetings } from "@/db";
import { signUpload } from "@/lib/storage";

const UPLOADS_PER_HOUR = 10;
const MAX_BYTES = 500 * 1024 * 1024;

const body = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().regex(/^(audio|video)\//, "Only audio or video files are supported"),
  size: z.number().int().positive().max(MAX_BYTES, "File is larger than 500 MB"),
});

export async function POST(req: Request) {
  if (process.env.UPLOADS_ENABLED !== "true")
    return NextResponse.json({ error: "Uploads are disabled in this demo." }, { status: 403 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const { filename, contentType } = parsed.data;

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
  const title = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled meeting";

  await db.insert(meetings).values({ id, title, mediaKey, mediaType: contentType, source: "upload" });
  return NextResponse.json({ id, uploadUrl: await signUpload(mediaKey, contentType) });
}

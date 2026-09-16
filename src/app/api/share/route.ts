import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, meetings, shareLinks } from "@/db";

const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("meeting"), meetingId: z.string() }),
  z.object({ kind: z.literal("clip"), meetingId: z.string(), startMs: z.number().int().min(0), endMs: z.number().int().min(1) }),
]);

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid share request" }, { status: 400 });
  const input = parsed.data;

  const [meeting] = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, input.meetingId));
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Reuse the meeting-level link so "Share" is idempotent.
  if (input.kind === "meeting") {
    const [existing] = await db
      .select()
      .from(shareLinks)
      .where(and(eq(shareLinks.meetingId, input.meetingId), eq(shareLinks.kind, "meeting"), isNull(shareLinks.startMs)));
    if (existing) return NextResponse.json({ slug: existing.slug });
  }

  const slug = nanoid(12);
  await db.insert(shareLinks).values({
    slug,
    meetingId: input.meetingId,
    kind: input.kind,
    startMs: input.kind === "clip" ? input.startMs : null,
    endMs: input.kind === "clip" ? input.endMs : null,
  });
  return NextResponse.json({ slug });
}

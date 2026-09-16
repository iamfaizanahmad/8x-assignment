import { NextResponse } from "next/server";
import { z } from "zod";
import { db, highlights } from "@/db";

const body = z
  .object({ startMs: z.number().int().min(0), endMs: z.number().int().min(0), note: z.string().max(500).optional() })
  .refine((b) => b.endMs > b.startMs && b.endMs - b.startMs <= 10 * 60_000, "Clips must be between 1s and 10 minutes");

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const [row] = await db.insert(highlights).values({ meetingId: id, ...parsed.data }).returning();
  return NextResponse.json(row);
}

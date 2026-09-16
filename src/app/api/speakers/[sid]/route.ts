import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, speakers } from "@/db";

export async function PATCH(req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const parsed = z.object({ displayName: z.string().trim().max(60) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  const [row] = await db
    .update(speakers)
    .set({ displayName: parsed.data.displayName || null })
    .where(eq(speakers.id, Number(sid)))
    .returning();
  return row ? NextResponse.json(row) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

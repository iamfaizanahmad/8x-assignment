import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, highlights } from "@/db";

export async function PATCH(req: Request, { params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  const parsed = z.object({ note: z.string().max(500) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid note" }, { status: 400 });
  const [row] = await db.update(highlights).set(parsed.data).where(eq(highlights.id, Number(hid))).returning();
  return row ? NextResponse.json(row) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  await db.delete(highlights).where(eq(highlights.id, Number(hid)));
  return NextResponse.json({ ok: true });
}

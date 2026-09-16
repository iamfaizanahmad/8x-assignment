import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actionItems, db } from "@/db";

export async function PATCH(req: Request, { params }: { params: Promise<{ aid: string }> }) {
  const { aid } = await params;
  const parsed = z.object({ done: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const [row] = await db.update(actionItems).set(parsed.data).where(eq(actionItems.id, Number(aid))).returning();
  return row ? NextResponse.json(row) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

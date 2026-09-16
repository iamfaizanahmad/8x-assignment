import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { calendarConnections, calendarEventOverrides, db } from "@/db";
import { getConnection } from "@/lib/calendar/session";

export async function PUT(req: Request) {
  const conn = await getConnection();
  if (!conn) return NextResponse.json({ error: "No calendar connected" }, { status: 401 });
  const parsed = z.object({ rule: z.enum(["all", "hosted", "none"]) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid rule" }, { status: 400 });
  // Changing the rule resets per-meeting overrides, so the list matches what the user just picked.
  await db.delete(calendarEventOverrides).where(eq(calendarEventOverrides.connectionId, conn.id));
  await db.update(calendarConnections).set({ autoJoinRule: parsed.data.rule }).where(eq(calendarConnections.id, conn.id));
  return NextResponse.json({ ok: true });
}

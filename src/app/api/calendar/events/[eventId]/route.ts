import { NextResponse } from "next/server";
import { z } from "zod";
import { calendarEventOverrides, db } from "@/db";
import { getConnection } from "@/lib/calendar/session";

export async function PUT(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const conn = await getConnection();
  if (!conn) return NextResponse.json({ error: "No calendar connected" }, { status: 401 });
  const { eventId } = await params;
  const parsed = z.object({ record: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  await db
    .insert(calendarEventOverrides)
    .values({ connectionId: conn.id, eventId, record: parsed.data.record })
    .onConflictDoUpdate({
      target: [calendarEventOverrides.connectionId, calendarEventOverrides.eventId],
      set: { record: parsed.data.record },
    });
  return NextResponse.json({ ok: true });
}

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { calendarConnections, db } from "@/db";
import { revoke } from "@/lib/calendar/google";
import { getConnection } from "@/lib/calendar/session";

export async function POST() {
  const conn = await getConnection();
  if (conn) {
    await revoke(conn);
    await db.delete(calendarConnections).where(eq(calendarConnections.id, conn.id));
  }
  return NextResponse.json({ ok: true });
}

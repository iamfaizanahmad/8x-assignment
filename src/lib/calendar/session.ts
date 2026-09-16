import "server-only";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { calendarConnections, db } from "@/db";

export const SESSION_COOKIE = "minutes_sid";

export const OAUTH_STATE_COOKIE = "minutes_oauth_state";

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge,
});

export const newSessionId = () => randomBytes(24).toString("base64url");

/** Anonymous per-browser id, only issued when someone connects a calendar (the demo has no accounts). */
export async function getSessionId() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function getConnection() {
  const sid = await getSessionId();
  if (!sid) return null;
  const [row] = await db.select().from(calendarConnections).where(eq(calendarConnections.sessionId, sid));
  return row ?? null;
}

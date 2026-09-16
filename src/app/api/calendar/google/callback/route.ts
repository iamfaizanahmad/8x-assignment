import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { calendarConnections, db } from "@/db";
import { exchangeCode } from "@/lib/calendar/google";
import { OAUTH_STATE_COOKIE, SESSION_COOKIE } from "@/lib/calendar/session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => {
    const res = NextResponse.redirect(`${url.origin}/calendar?${q}`);
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  };

  if (url.searchParams.get("error")) return back("error=denied");
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  const state = jar.get(OAUTH_STATE_COOKIE)?.value;
  const code = url.searchParams.get("code");
  if (!sid || !state || state !== url.searchParams.get("state") || !code) return back("error=state");

  try {
    const t = await exchangeCode(code, url.origin);
    await db
      .insert(calendarConnections)
      .values({ sessionId: sid, email: t.email, accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt })
      .onConflictDoUpdate({
        target: calendarConnections.sessionId,
        set: {
          email: t.email,
          accessToken: t.accessToken,
          expiresAt: t.expiresAt,
          ...(t.refreshToken ? { refreshToken: t.refreshToken } : {}),
        },
      });
    return back("connected=1");
  } catch (err) {
    console.error("[calendar] OAuth callback failed", err);
    return back(err instanceof Error && err.message.includes("not granted") ? "error=scope" : "error=exchange");
  }
}

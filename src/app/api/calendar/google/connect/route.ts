import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { authUrl } from "@/lib/calendar/google";
import { cookieOptions, getSessionId, newSessionId, OAUTH_STATE_COOKIE, SESSION_COOKIE } from "@/lib/calendar/session";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    return NextResponse.redirect(`${origin}/calendar?error=not_configured`);

  const state = randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(authUrl(origin, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, cookieOptions(10 * 60));
  if (!(await getSessionId())) res.cookies.set(SESSION_COOKIE, newSessionId(), cookieOptions(60 * 60 * 24 * 180));
  return res;
}

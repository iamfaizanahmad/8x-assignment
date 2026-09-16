import "server-only";
import { eq } from "drizzle-orm";
import { calendarConnections, db } from "@/db";
import { decrypt, encrypt } from "./crypto";

export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events.readonly"];

type Connection = typeof calendarConnections.$inferSelect;

export type Platform = "Zoom" | "Google Meet" | "Microsoft Teams";
export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees: { name: string; email: string; self: boolean }[];
  isHost: boolean;
  platform: Platform | null;
  meetingUrl: string | null;
  htmlLink: string | null;
};

export function redirectUri(origin: string) {
  return `${origin}/api/calendar/google/callback`;
}

export function authUrl(origin: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...body,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${json.error_description ?? json.error ?? res.status}`);
  return json as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string; scope: string };
}

export async function exchangeCode(code: string, origin: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
  if (!t.scope.includes("calendar.events.readonly")) throw new Error("Calendar access was not granted");
  // The id_token comes straight from Google's token endpoint over TLS, so reading its payload is safe here.
  const payload = t.id_token ? JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()) : {};
  return {
    email: String(payload.email ?? "Google account"),
    accessToken: encrypt(t.access_token),
    refreshToken: t.refresh_token ? encrypt(t.refresh_token) : null,
    expiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000),
  };
}

async function accessToken(conn: Connection) {
  if (conn.expiresAt.getTime() > Date.now()) return decrypt(conn.accessToken);
  if (!conn.refreshToken) throw new CalendarAuthError();
  try {
    const t = await tokenRequest({ refresh_token: decrypt(conn.refreshToken), grant_type: "refresh_token" });
    await db
      .update(calendarConnections)
      .set({ accessToken: encrypt(t.access_token), expiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000) })
      .where(eq(calendarConnections.id, conn.id));
    return t.access_token;
  } catch {
    throw new CalendarAuthError();
  }
}

export class CalendarAuthError extends Error {
  constructor() {
    super("Google Calendar access expired or was revoked. Reconnect to continue.");
  }
}

export async function revoke(conn: Connection) {
  const token = conn.refreshToken ? decrypt(conn.refreshToken) : decrypt(conn.accessToken);
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
}

const LINK_PATTERNS: [Platform, RegExp][] = [
  ["Zoom", /https:\/\/[\w.-]*zoom\.us\/(?:j|my|w)\/[^\s"<>)]+/i],
  ["Microsoft Teams", /https:\/\/teams\.(?:microsoft|live)\.com\/[^\s"<>)]+/i],
  ["Google Meet", /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i],
];

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }[];
  organizer?: { self?: boolean };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  location?: string;
  description?: string;
  htmlLink?: string;
};

/** Find the video link wherever Google or the invite put it: conference data, Meet link, location, description. */
function detectMeeting(e: GoogleEvent): { platform: Platform | null; url: string | null } {
  const candidates = [
    e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri,
    e.hangoutLink,
    e.location,
    e.description,
  ].filter(Boolean) as string[];
  for (const text of candidates)
    for (const [platform, re] of LINK_PATTERNS) {
      const m = text.match(re);
      if (m) return { platform, url: m[0] };
    }
  return { platform: null, url: null };
}

function mapEvent(e: GoogleEvent): CalendarEvent | null {
  // All-day events and cancelled/declined events are never meetings to record.
  if (e.status === "cancelled" || !e.start?.dateTime || !e.end?.dateTime) return null;
  if (e.attendees?.find((a) => a.self)?.responseStatus === "declined") return null;
  const { platform, url } = detectMeeting(e);
  const attendees = (e.attendees ?? [])
    .filter((a) => !a.resource && a.email)
    .map((a) => ({ name: a.displayName || a.email!.split("@")[0], email: a.email!, self: !!a.self }));
  return {
    id: e.id,
    title: e.summary?.trim() || "(No title)",
    start: e.start.dateTime,
    end: e.end.dateTime,
    attendees,
    isHost: e.organizer?.self ?? false,
    platform,
    meetingUrl: url,
    htmlLink: e.htmlLink ?? null,
  };
}

async function googleGet(conn: Connection, path: string, params?: URLSearchParams) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}${params ? `?${params}` : ""}`, {
    headers: { Authorization: `Bearer ${await accessToken(conn)}` },
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new CalendarAuthError();
  if (!res.ok) throw new Error(`Google Calendar ${res.status}`);
  return res.json();
}

export async function listEvents(conn: Connection, { pastDays = 7, futureDays = 14 } = {}) {
  const params = new URLSearchParams({
    timeMin: new Date(Date.now() - pastDays * 86_400_000).toISOString(),
    timeMax: new Date(Date.now() + futureDays * 86_400_000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const json = await googleGet(conn, "/calendars/primary/events", params);
  return ((json.items ?? []) as GoogleEvent[]).map(mapEvent).filter((e): e is CalendarEvent => e !== null);
}

export async function getEvent(conn: Connection, eventId: string) {
  return mapEvent((await googleGet(conn, `/calendars/primary/events/${encodeURIComponent(eventId)}`)) as GoogleEvent);
}

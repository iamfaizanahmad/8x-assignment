import { eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { calendarEventOverrides, db, meetings } from "@/db";
import { CalendarAuthError, listEvents, type CalendarEvent } from "@/lib/calendar/google";
import { getConnection } from "@/lib/calendar/session";
import { CalendarView } from "./calendar-view";

export const metadata: Metadata = { title: "Calendar — Minutes" };
export const dynamic = "force-dynamic";

const NOTICES: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "Google Calendar connected." },
  denied: { tone: "error", text: "Google sign-in was cancelled." },
  scope: { tone: "error", text: "Calendar access wasn't granted. Tick the calendar checkbox on Google's consent screen and try again." },
  state: { tone: "error", text: "That sign-in link expired. Please try connecting again." },
  exchange: { tone: "error", text: "Google didn't accept the sign-in. Please try again." },
  not_configured: { tone: "error", text: "Google Calendar isn't configured on this deployment yet." },
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const sp = await searchParams;
  const notice = sp.connected ? NOTICES.connected : sp.error ? (NOTICES[sp.error] ?? NOTICES.exchange) : null;
  const conn = await getConnection();
  const uploadsEnabled = process.env.UPLOADS_ENABLED === "true";

  if (!conn) return <CalendarView mode="demo" notice={notice} uploadsEnabled={uploadsEnabled} />;

  let events: CalendarEvent[] = [];
  let authError = false;
  try {
    events = await listEvents(conn);
  } catch (err) {
    if (!(err instanceof CalendarAuthError)) throw err;
    authError = true;
  }

  const ids = events.map((e) => e.id);
  const [overrideRows, linkedRows] = ids.length
    ? await Promise.all([
        db.select().from(calendarEventOverrides).where(eq(calendarEventOverrides.connectionId, conn.id)),
        db
          .select({ id: meetings.id, eventId: meetings.calendarEventId, status: meetings.status })
          .from(meetings)
          .where(inArray(meetings.calendarEventId, ids)),
      ])
    : [[], []];

  return (
    <CalendarView
      mode="connected"
      notice={notice}
      uploadsEnabled={uploadsEnabled}
      email={conn.email}
      authError={authError}
      events={events}
      rule={conn.autoJoinRule}
      overrides={Object.fromEntries(overrideRows.map((o) => [o.eventId, o.record]))}
      linked={Object.fromEntries(linkedRows.map((m) => [m.eventId!, m.id]))}
    />
  );
}

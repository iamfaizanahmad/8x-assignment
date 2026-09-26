import "server-only";
import { cache } from "react";
import { asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { actionItems, db, highlights, meetings, shareLinks, speakers, summaries, transcriptSegments } from "@/db";
import { signDownload } from "@/lib/storage";

type MeetingRow = typeof meetings.$inferSelect;

/** Pages render in the browser with no login: never ship invitee names, calendar ids or uploader hashes. */
function publicMeeting(m: MeetingRow): Omit<MeetingRow, "attendees" | "calendarEventId" | "uploaderHash"> {
  const rest: Partial<MeetingRow> = { ...m };
  delete rest.attendees;
  delete rest.calendarEventId;
  delete rest.uploaderHash;
  return rest as Omit<MeetingRow, "attendees" | "calendarEventId" | "uploaderHash">;
}

export async function listMeetings() {
  const rows = await db.select().from(meetings).orderBy(desc(meetings.startedAt));
  const ids = rows.map((m) => m.id);
  const [speakerRows, actionRows] = ids.length
    ? await Promise.all([
        db.select().from(speakers).where(inArray(speakers.meetingId, ids)),
        db.select({ meetingId: actionItems.meetingId }).from(actionItems).where(inArray(actionItems.meetingId, ids)),
      ])
    : [[], []];
  return rows.map((m) => ({
    ...publicMeeting(m),
    speakers: speakerRows.filter((s) => s.meetingId === m.id).sort((a, b) => b.talkTimeS - a.talkTimeS),
    actionItemCount: actionRows.filter((a) => a.meetingId === m.id).length,
  }));
}
export type MeetingListItem = Awaited<ReturnType<typeof listMeetings>>[number];

export const getMeeting = cache(async (id: string) => {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting) return null;
  const [speakerRows, segments, summaryRows, actions, highlightRows, mediaUrl] = await Promise.all([
    db.select().from(speakers).where(eq(speakers.meetingId, id)).orderBy(desc(speakers.talkTimeS)),
    db
      .select({
        id: transcriptSegments.id,
        speakerId: transcriptSegments.speakerId,
        startMs: transcriptSegments.startMs,
        endMs: transcriptSegments.endMs,
        text: transcriptSegments.text,
      })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, id))
      .orderBy(asc(transcriptSegments.startMs)),
    db.select().from(summaries).where(eq(summaries.meetingId, id)),
    db.select().from(actionItems).where(eq(actionItems.meetingId, id)).orderBy(asc(actionItems.timestampMs)),
    db.select().from(highlights).where(eq(highlights.meetingId, id)).orderBy(asc(highlights.startMs)),
    meeting.mediaKey ? signDownload(meeting.mediaKey) : Promise.resolve(null),
  ]);
  return {
    meeting: publicMeeting(meeting),
    mediaUrl,
    speakers: speakerRows,
    segments,
    summaries: summaryRows,
    actionItems: actions,
    highlights: highlightRows,
  };
});
export type MeetingDetail = NonNullable<Awaited<ReturnType<typeof getMeeting>>>;

export const getShare = cache(async (slug: string) => {
  const [link] = await db.select().from(shareLinks).where(eq(shareLinks.slug, slug));
  if (!link) return null;
  const data = await getMeeting(link.meetingId);
  if (!data || data.meeting.status !== "ready") return null;
  return { link, data };
});

export type SearchHit = {
  meetingId: string;
  meetingTitle: string;
  startedAt: Date;
  startMs: number;
  speaker: string | null;
  snippet: string;
};

/** Full-text search across every transcript line, best matches first. Snippets wrap hits in <b>. */
export async function searchTranscripts(q: string): Promise<{ hits: SearchHit[]; titleMatches: { id: string; title: string; startedAt: Date }[] }> {
  const query = q.trim().slice(0, 200);
  if (!query) return { hits: [], titleMatches: [] };
  const tsq = sql`websearch_to_tsquery('english', ${query})`;
  const [hits, titleMatches] = await Promise.all([
    db
      .select({
        meetingId: meetings.id,
        meetingTitle: meetings.title,
        startedAt: meetings.startedAt,
        startMs: transcriptSegments.startMs,
        speaker: sql<string | null>`coalesce(${speakers.displayName}, ${speakers.label})`,
        snippet: sql<string>`ts_headline('english', ${transcriptSegments.text}, ${tsq}, 'StartSel=<b>,StopSel=</b>,MaxWords=35,MinWords=15,MaxFragments=1')`,
      })
      .from(transcriptSegments)
      .innerJoin(meetings, eq(transcriptSegments.meetingId, meetings.id))
      .leftJoin(speakers, eq(transcriptSegments.speakerId, speakers.id))
      .where(sql`${transcriptSegments.tsv} @@ ${tsq}`)
      .orderBy(sql`ts_rank(${transcriptSegments.tsv}, ${tsq}) desc`, desc(meetings.startedAt))
      .limit(60),
    db
      .select({ id: meetings.id, title: meetings.title, startedAt: meetings.startedAt })
      .from(meetings)
      .where(ilike(meetings.title, `%${query.replace(/[%_\\]/g, "\\$&")}%`))
      .orderBy(desc(meetings.startedAt))
      .limit(10),
  ]);
  return { hits, titleMatches };
}

export type OpenItemsStatus = "pending" | "done";

const ownerSpeaker = alias(speakers, "owner_speaker");
const quoteSpeaker = alias(speakers, "quote_speaker");

/**
 * Every action item across all meetings for one tab, grouped by who owns it. One SQL statement: the item,
 * its meeting, its owner's *current* speaker record (so renames regroup), and the transcript line it came from.
 */
export async function listOpenItems(status: OpenItemsStatus) {
  const done = status === "done";
  // Tab counts ride along as a one-row derived table, so an empty tab still knows the other tab's count.
  const counts = db
    .select({
      pending: sql<number>`(count(*) filter (where not ${actionItems.done}))::int`.as("pending_count"),
      done: sql<number>`(count(*) filter (where ${actionItems.done}))::int`.as("done_count"),
    })
    .from(actionItems)
    .as("counts");
  const rows = await db
    .select({
      pendingCount: counts.pending,
      doneCount: counts.done,
      id: actionItems.id,
      text: actionItems.text,
      done: actionItems.done,
      completedAt: actionItems.completedAt,
      dueDate: actionItems.dueDate,
      duePhrase: actionItems.duePhrase,
      meetingId: meetings.id,
      meetingTitle: meetings.title,
      meetingStartedAt: meetings.startedAt,
      ownerId: ownerSpeaker.id,
      ownerLabel: ownerSpeaker.label,
      ownerName: ownerSpeaker.displayName,
      quoteText: transcriptSegments.text,
      quoteStartMs: transcriptSegments.startMs,
      quoteSpeakerId: quoteSpeaker.id,
      quoteSpeakerLabel: quoteSpeaker.label,
      quoteSpeakerName: quoteSpeaker.displayName,
    })
    .from(counts)
    .leftJoin(actionItems, eq(actionItems.done, done))
    .leftJoin(meetings, eq(actionItems.meetingId, meetings.id))
    .leftJoin(ownerSpeaker, eq(actionItems.ownerSpeakerId, ownerSpeaker.id))
    .leftJoin(transcriptSegments, eq(actionItems.segmentId, transcriptSegments.id))
    .leftJoin(quoteSpeaker, eq(transcriptSegments.speakerId, quoteSpeaker.id))
    .orderBy(
      ...(done
        ? [sql`${actionItems.completedAt} desc nulls last`, desc(meetings.startedAt)]
        : [sql`${actionItems.dueDate} asc nulls last`, desc(meetings.startedAt)]),
      sql`coalesce(${transcriptSegments.startMs}, ${actionItems.timestampMs}) asc nulls last`,
      asc(actionItems.id),
    );

  const items = rows.flatMap((r) =>
    r.id != null && r.meetingId != null ? [{ ...r, id: r.id, text: r.text!, done: r.done!, meetingId: r.meetingId, meetingTitle: r.meetingTitle!, meetingStartedAt: r.meetingStartedAt! }] : [],
  );
  type Row = (typeof items)[number];
  const item = (r: Row) => ({
    id: r.id,
    text: r.text,
    done: r.done,
    completedAt: r.completedAt,
    dueDate: r.dueDate,
    duePhrase: r.duePhrase,
    meeting: { id: r.meetingId, title: r.meetingTitle, startedAt: r.meetingStartedAt },
    quote:
      r.quoteText != null && r.quoteStartMs != null
        ? {
            text: r.quoteText,
            startMs: r.quoteStartMs,
            speaker: r.quoteSpeakerId != null ? { id: r.quoteSpeakerId, label: r.quoteSpeakerLabel!, displayName: r.quoteSpeakerName } : null,
          }
        : null,
  });

  // Named speakers are the same person across meetings; an unnamed "Speaker 2" only means something within its meeting.
  const groups = new Map<
    string,
    {
      key: string;
      name: string;
      speaker: { id: number; label: string; displayName: string | null } | null;
      meeting: { id: string; title: string } | null;
      items: ReturnType<typeof item>[];
    }
  >();
  for (const r of items) {
    const name = r.ownerName?.trim();
    const key = r.ownerId == null ? "unassigned" : name ? `name:${name.toLowerCase()}` : `speaker:${r.ownerId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name: r.ownerId == null ? "Unassigned" : name || r.ownerLabel!,
        speaker: r.ownerId == null ? null : { id: r.ownerId, label: r.ownerLabel!, displayName: name || null },
        meeting: r.ownerId != null && !name ? { id: r.meetingId, title: r.meetingTitle } : null,
        items: [],
      };
      groups.set(key, g);
    }
    g.items.push(item(r));
  }

  return {
    status,
    counts: { pending: rows[0]?.pendingCount ?? 0, done: rows[0]?.doneCount ?? 0 },
    groups: [...groups.values()].sort(
      (a, b) => Number(a.key === "unassigned") - Number(b.key === "unassigned") || b.items.length - a.items.length,
    ),
  };
}
export type OpenItems = Awaited<ReturnType<typeof listOpenItems>>;
export type OpenItemGroup = OpenItems["groups"][number];
export type OpenItem = OpenItemGroup["items"][number];

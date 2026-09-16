import "server-only";
import { asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { actionItems, db, highlights, meetings, shareLinks, speakers, summaries, transcriptSegments } from "@/db";
import { signDownload } from "@/lib/storage";

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
    ...m,
    speakers: speakerRows.filter((s) => s.meetingId === m.id).sort((a, b) => b.talkTimeS - a.talkTimeS),
    actionItemCount: actionRows.filter((a) => a.meetingId === m.id).length,
  }));
}
export type MeetingListItem = Awaited<ReturnType<typeof listMeetings>>[number];

export async function getMeeting(id: string) {
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
    meeting,
    mediaUrl,
    speakers: speakerRows,
    segments,
    summaries: summaryRows,
    actionItems: actions,
    highlights: highlightRows,
  };
}
export type MeetingDetail = NonNullable<Awaited<ReturnType<typeof getMeeting>>>;

export async function getShare(slug: string) {
  const [link] = await db.select().from(shareLinks).where(eq(shareLinks.slug, slug));
  if (!link) return null;
  const data = await getMeeting(link.meetingId);
  if (!data || data.meeting.status !== "ready") return null;
  return { link, data };
}

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

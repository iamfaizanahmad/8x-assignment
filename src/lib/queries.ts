import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { actionItems, db, highlights, meetings, speakers, summaries, transcriptSegments } from "@/db";
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

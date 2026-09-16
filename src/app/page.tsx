import { CheckSquare, Clock, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { DeleteMeetingButton } from "@/components/delete-meeting";
import { SpeakerAvatars } from "@/components/speaker-avatars";
import { UploadButton } from "@/components/upload-dialog";
import { listMeetings, type MeetingListItem } from "@/lib/queries";
import { formatDuration } from "@/lib/ui";
import { LocalTime } from "@/components/local-time";

export const dynamic = "force-dynamic";

const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

function dayLabel(d: Date) {
  const today = new Date();
  const diff = Math.floor((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: diff > 300 ? "numeric" : undefined });
}

function StatusPill({ m }: { m: MeetingListItem }) {
  if (m.status === "ready") return null;
  if (m.status === "failed")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
        <TriangleAlert className="size-3" /> Failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
      <Loader2 className="size-3 animate-spin" /> {m.status === "summarizing" ? "Summarizing" : "Transcribing"}
    </span>
  );
}

export default async function MeetingsPage() {
  const meetings = await listMeetings();
  const groups = new Map<string, MeetingListItem[]>();
  for (const m of meetings) {
    const key = dayLabel(m.startedAt);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {meetings.length} recorded · transcripts, summaries and action items for every call
          </p>
        </div>
        <UploadButton enabled={process.env.UPLOADS_ENABLED === "true"} />
      </div>

      {meetings.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500">
          No meetings yet. Upload a recording to get started.
        </div>
      )}

      <div className="space-y-8">
        {[...groups].map(([day, items]) => (
          <section key={day}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{day}</h2>
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              {items.map((m) => (
                <li key={m.id}>
                  <Link href={`/meetings/${m.id}`} className="group flex items-center gap-4 px-4 py-3.5 transition hover:bg-zinc-50">
                    <div className="w-14 shrink-0 text-xs tabular-nums text-zinc-500">
                      <LocalTime date={m.startedAt} options={TIME} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{m.title}</span>
                        <StatusPill m={m} />
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                        {m.durationS > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3" /> {formatDuration(m.durationS)}
                          </span>
                        )}
                        {m.speakers.length > 0 && <span>{m.speakers.length} speakers</span>}
                        {m.actionItemCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <CheckSquare className="size-3" /> {m.actionItemCount} action items
                          </span>
                        )}
                      </div>
                    </div>
                    <SpeakerAvatars speakers={m.speakers} />
                    {m.source !== "seed" && <DeleteMeetingButton meeting={m} />}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

"use client";

import { CheckSquare, Clock, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DeleteMeetingButton } from "@/components/delete-meeting";
import { SpeakerAvatars } from "@/components/speaker-avatars";
import type { MeetingListItem } from "@/lib/queries";
import { formatDuration } from "@/lib/ui";

const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/** Calendar-day label in the viewer's timezone (the server runs in UTC). */
function dayLabel(d: Date) {
  const diff = Math.round((new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
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
  if (m.status === "uploaded")
    return <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">Waiting to process</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
      <Loader2 className="size-3 animate-spin" /> {m.status === "summarizing" ? "Summarizing" : "Transcribing"}
    </span>
  );
}

/** Grouping and times depend on the viewer's timezone, so this renders after mount. */
export function MeetingList({ meetings }: { meetings: MeetingListItem[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted)
    return (
      <div className="space-y-2" aria-hidden>
        {meetings.slice(0, 6).map((m) => (
          <div key={m.id} className="h-[68px] animate-pulse rounded-xl border border-zinc-200 bg-white" />
        ))}
      </div>
    );

  const groups = new Map<string, MeetingListItem[]>();
  for (const m of meetings) {
    const key = dayLabel(new Date(m.startedAt));
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  return (
      <div className="space-y-8">
        {[...groups].map(([day, items]) => (
          <section key={day}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{day}</h2>
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              {items.map((m) => (
                <li key={m.id}>
                  <Link href={`/meetings/${m.id}`} className="group flex items-center gap-4 px-4 py-3.5 transition hover:bg-zinc-50">
                    <div className="w-14 shrink-0 text-xs tabular-nums text-zinc-500">
                      {new Date(m.startedAt).toLocaleTimeString("en-US", TIME)}
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
  );
}

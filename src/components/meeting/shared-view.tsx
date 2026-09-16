"use client";

import clsx from "clsx";
import { AudioLines, Calendar, Clock, Scissors } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { SummaryContent, TemplateId } from "@/db/schema";
import type { MeetingDetail } from "@/lib/queries";
import { formatMs } from "@/lib/time";
import { formatDuration } from "@/lib/ui";
import { LocalTime } from "@/components/local-time";

const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
import { ActionItemsPanel } from "./action-items-panel";
import { MediaPlayer } from "./media-player";
import { SpeakersPanel } from "./speakers-panel";
import { SummaryPanel } from "./summary-panel";
import { Timeline } from "./timeline";
import { TranscriptPanel } from "./transcript-panel";
import { usePlayer } from "./use-player";

type Tab = "summary" | "transcript" | "actions";

/** Public, read-only view for people who were not on the call. Clips are locked to their time range. */
export function SharedView({ data, clip }: { data: MeetingDetail; clip?: { startMs: number; endMs: number } }) {
  const { meeting } = data;
  const player = usePlayer({ clip });
  const [tab, setTab] = useState<Tab>(clip ? "transcript" : "summary");
  const durationMs = player.durationMs || meeting.durationS * 1000;

  const summaries = useMemo(
    () => Object.fromEntries(data.summaries.filter((s) => s.template === "general").map((s) => [s.template, s.content])) as Partial<
      Record<TemplateId, SummaryContent>
    >,
    [data.summaries],
  );
  // Clips only reveal what was said inside the range.
  const seek = (ms: number) => player.seek(clip ? Math.min(clip.endMs - 500, Math.max(clip.startMs, ms)) : ms);

  const tabs: { id: Tab; label: string }[] = clip
    ? [{ id: "transcript", label: "Transcript" }]
    : [
        { id: "summary", label: "Summary" },
        { id: "transcript", label: "Transcript" },
        { id: "actions", label: "Action items" },
      ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-brand-600 text-white">
              <AudioLines className="size-4" />
            </span>
            Minutes
          </Link>
          <span className="text-xs text-zinc-500">Shared with you · view only</span>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
        <div className="mb-5">
          {clip && (
            <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              <Scissors className="size-3" /> Clip · {formatMs(clip.startMs)}–{formatMs(clip.endMs)} ({formatDuration(Math.round((clip.endMs - clip.startMs) / 1000))})
            </span>
          )}
          <h1 className="text-xl font-semibold tracking-tight">{meeting.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3.5" />
              <LocalTime date={meeting.startedAt} options={DATE_TIME} />
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" /> {formatDuration(meeting.durationS)}
            </span>
            <span>{data.speakers.length} speakers</span>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(380px,520px)]">
          <div className="space-y-4">
            <MediaPlayer player={player} src={data.mediaUrl} mediaType={meeting.mediaType} title={meeting.title} />
            {!clip && (
              <>
                <Timeline
                  durationMs={durationMs}
                  currentMs={player.currentMs}
                  chapters={meeting.chapters}
                  highlights={[]}
                  speakers={data.speakers}
                  segments={data.segments}
                  onSeek={seek}
                />
                <SpeakersPanel speakers={data.speakers} readOnly />
              </>
            )}
            {clip && (
              <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
                This clip plays {formatMs(clip.startMs)}–{formatMs(clip.endMs)} of the recording and stops at the end.
              </p>
            )}
          </div>

          <div className="flex h-[calc(100vh-7rem)] min-h-[480px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white lg:sticky lg:top-5">
            <div className="flex shrink-0 gap-1 border-b border-zinc-100 px-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx("relative px-3 py-3 text-sm", tab === t.id ? "font-medium text-zinc-900" : "text-zinc-500 hover:text-zinc-800")}
                >
                  {t.label}
                  {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-600" />}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {tab === "summary" && (
                <SummaryPanel meetingId={meeting.id} title={meeting.title} initial={summaries} chapters={meeting.chapters} onSeek={seek} readOnly />
              )}
              {tab === "transcript" && (
                <TranscriptPanel segments={data.segments} speakers={data.speakers} currentMs={player.currentMs} onSeek={seek} bounds={clip} />
              )}
              {tab === "actions" && <ActionItemsPanel items={data.actionItems} onSeek={seek} readOnly />}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

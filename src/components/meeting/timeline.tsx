"use client";

import clsx from "clsx";
import type { Chapter, Highlight, Speaker } from "./types";
import { formatMs } from "@/lib/time";
import { speakerColor, speakerName } from "@/lib/ui";
import { speakerIndex } from "@/components/speaker-avatars";

const NAME_COL_PX = 88;

type Seg = { speakerId: number | null; startMs: number; endMs: number };

/** Fathom-style scrubber: chapters on top, one activity lane per speaker, highlights marked. */
export function Timeline({
  durationMs,
  currentMs,
  chapters,
  highlights,
  speakers,
  segments,
  onSeek,
}: {
  durationMs: number;
  currentMs: number;
  chapters: Chapter[];
  highlights: Highlight[];
  speakers: Speaker[];
  segments: Seg[];
  onSeek: (ms: number) => void;
}) {
  if (!durationMs) return null;
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / durationMs) * 100))}%`;
  const activeChapter = [...chapters].reverse().find((c) => c.startMs <= currentMs);

  // Everything is laid out in a track that excludes the right-hand name column, so x maps 1:1 to time.
  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const trackWidth = r.width - NAME_COL_PX;
    const x = Math.min(trackWidth, Math.max(0, e.clientX - r.left));
    onSeek((x / trackWidth) * durationMs);
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between text-xs">
        <span className="truncate font-medium text-zinc-700">{activeChapter?.title ?? "Timeline"}</span>
        <span className="shrink-0 tabular-nums text-zinc-500">
          {formatMs(currentMs)} / {formatMs(durationMs)}
        </span>
      </div>

      <div className="relative cursor-pointer" style={{ paddingRight: NAME_COL_PX }} onClick={seekFromEvent}>
        {/* chapters */}
        <div className="relative mb-2 flex h-2 gap-0.5">
          {chapters.map((c, i) => {
            const end = chapters[i + 1]?.startMs ?? durationMs;
            return (
              <div
                key={i}
                title={`${formatMs(c.startMs)} · ${c.title}`}
                className={clsx("absolute h-full rounded-full", activeChapter === c ? "bg-brand-500" : "bg-zinc-200 hover:bg-zinc-300")}
                style={{ left: pct(c.startMs), width: `calc(${pct(end - c.startMs)} - 2px)` }}
              />
            );
          })}
        </div>

        {/* speaker lanes */}
        <div className="space-y-1">
          {speakers.map((s) => (
            <div key={s.id} className="relative flex items-center">
              <div className="relative h-2 flex-1 rounded-full bg-zinc-100">
                {segments
                  .filter((seg) => seg.speakerId === s.id)
                  .map((seg, i) => (
                    <div
                      key={i}
                      className={clsx("absolute h-full rounded-full opacity-80", speakerColor(speakerIndex(s)).bg)}
                      style={{ left: pct(seg.startMs), width: `max(2px, ${pct(seg.endMs - seg.startMs)})` }}
                    />
                  ))}
              </div>
              <span
                className="absolute truncate pl-2 text-[11px] leading-none text-zinc-500"
                style={{ left: "100%", width: NAME_COL_PX }}
              >
                {speakerName(s)}
              </span>
            </div>
          ))}
        </div>

        {/* highlights + playhead span only the lane area, not the name column */}
        <div className="pointer-events-none absolute inset-y-0 left-0" style={{ right: NAME_COL_PX }}>
          {highlights.map((h) => (
            <div
              key={h.id}
              className="absolute -top-1 bottom-0 rounded bg-amber-300/40 ring-1 ring-amber-400"
              style={{ left: pct(h.startMs), width: `max(3px, ${pct(h.endMs - h.startMs)})` }}
            />
          ))}
          <div className="absolute -top-1.5 -bottom-1 w-0.5 rounded bg-zinc-900" style={{ left: pct(currentMs) }} />
        </div>
      </div>
    </div>
  );
}

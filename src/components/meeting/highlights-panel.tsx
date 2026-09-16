"use client";

import { Share2, Star, Trash2 } from "lucide-react";
import { formatMs } from "@/lib/time";
import type { Highlight, Segment } from "./types";

export function HighlightsPanel({
  highlights,
  segments,
  onSeek,
  onShare,
  onDelete,
  onNote,
}: {
  highlights: Highlight[];
  segments: Segment[];
  onSeek: (ms: number) => void;
  onShare: (h: Highlight) => void;
  onDelete: (h: Highlight) => void;
  onNote: (h: Highlight, note: string) => void;
}) {
  if (highlights.length === 0)
    return (
      <div className="p-8 text-center text-sm text-zinc-500">
        <Star className="mx-auto mb-2 size-6 text-zinc-300" />
        No highlights yet. Press <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 text-xs">H</kbd> while
        playing, or hover a transcript line and click the star.
      </div>
    );

  return (
    <ul className="scroll-thin h-full space-y-3 overflow-y-auto p-5">
      {highlights.map((h) => {
        const quote = segments
          .filter((s) => s.endMs > h.startMs && s.startMs < h.endMs)
          .map((s) => s.text)
          .join(" ");
        return (
          <li key={h.id} className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => onSeek(h.startMs)}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium tabular-nums text-amber-800 hover:bg-amber-200"
              >
                <Star className="size-3 fill-current" />
                {formatMs(h.startMs)}–{formatMs(h.endMs)}
              </button>
              <button
                onClick={() => onShare(h)}
                className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
              >
                <Share2 className="size-3.5" /> Share clip
              </button>
              <button onClick={() => onDelete(h)} className="rounded-md p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <input
              defaultValue={h.note ?? ""}
              placeholder="Add a note…"
              onBlur={(e) => e.target.value !== (h.note ?? "") && onNote(h, e.target.value)}
              className="mt-2 w-full rounded-md px-1 py-0.5 text-sm font-medium outline-none placeholder:font-normal placeholder:text-zinc-400 focus:bg-zinc-50"
            />
            {quote && <p className="mt-1 line-clamp-3 px-1 text-sm text-zinc-600">“{quote}”</p>}
          </li>
        );
      })}
    </ul>
  );
}

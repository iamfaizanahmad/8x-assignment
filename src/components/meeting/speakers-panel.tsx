"use client";

import clsx from "clsx";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { SpeakerAvatar, speakerIndex } from "@/components/speaker-avatars";
import { formatDuration, speakerColor, speakerName } from "@/lib/ui";
import type { Speaker } from "./types";

/** Talk-time breakdown + inline rename. Diarization only gives "Speaker N", so naming people matters on big calls. */
export function SpeakersPanel({
  speakers,
  onRename,
  readOnly = false,
}: {
  speakers: Speaker[];
  onRename?: (s: Speaker, name: string) => void;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const total = speakers.reduce((a, s) => a + s.talkTimeS, 0) || 1;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Speakers</h3>
        <span className="text-xs text-zinc-500">talk time</span>
      </div>
      <ul className="space-y-2.5">
        {speakers.map((s) => {
          const pct = Math.round((s.talkTimeS / total) * 100);
          return (
            <li key={s.id} className="flex items-center gap-3">
              <SpeakerAvatar speaker={s} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  {editing === s.id ? (
                    <input
                      autoFocus
                      defaultValue={s.displayName ?? ""}
                      placeholder={s.label}
                      onBlur={(e) => {
                        setEditing(null);
                        if (e.target.value.trim() !== (s.displayName ?? "")) onRename?.(s, e.target.value.trim());
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="w-full rounded border border-brand-500 px-1.5 py-0.5 text-sm outline-none"
                    />
                  ) : (
                    <button
                      disabled={readOnly}
                      onClick={() => setEditing(s.id)}
                      className="group inline-flex min-w-0 items-center gap-1.5 font-medium"
                      title={readOnly ? undefined : "Rename speaker"}
                    >
                      <span className="truncate">{speakerName(s)}</span>
                      {!readOnly && <Pencil className="size-3 shrink-0 text-zinc-300 group-hover:text-zinc-500" />}
                    </button>
                  )}
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-zinc-500">
                    {pct}% · {formatDuration(s.talkTimeS)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                  <div className={clsx("h-full rounded-full", speakerColor(speakerIndex(s)).bg)} style={{ width: `${pct}%` }} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

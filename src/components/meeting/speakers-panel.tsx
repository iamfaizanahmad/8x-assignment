"use client";

import clsx from "clsx";
import { Check, Loader2, Pencil, Play, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { SpeakerAvatar, speakerIndex } from "@/components/speaker-avatars";
import { formatMs } from "@/lib/time";
import { formatDuration, speakerColor, speakerName } from "@/lib/ui";
import type { Speaker } from "./types";

type Suggestion = {
  speakerId: number;
  label: string;
  name: string;
  confidence: "high" | "medium";
  evidence: string;
  timestampMs?: number;
};

/** Talk-time breakdown + inline rename. Diarization only gives "Speaker N", so naming people matters on big calls. */
export function SpeakersPanel({
  speakers,
  onRename,
  readOnly = false,
  meetingId,
  onSeek,
}: {
  speakers: Speaker[];
  onRename?: (s: Speaker, name: string) => Promise<void> | void;
  readOnly?: boolean;
  /** Enables "Suggest names" (Claude reads the transcript for introductions and people addressed by name). */
  meetingId?: string;
  onSeek?: (ms: number) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = speakers.reduce((a, s) => a + s.talkTimeS, 0) || 1;
  const canSuggest = !readOnly && !!meetingId && !!onRename;

  async function suggest() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/suggest-speakers`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuggestions(data.suggestions);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't suggest names.");
    } finally {
      setLoading(false);
    }
  }

  async function accept(list: Suggestion[]) {
    for (const sug of list) {
      const speaker = speakers.find((s) => s.id === sug.speakerId);
      if (speaker) await onRename?.(speaker, sug.name);
    }
    const accepted = new Set(list.map((l) => l.speakerId));
    setSuggestions((all) => all?.filter((s) => !accepted.has(s.speakerId)) ?? null);
  }

  const pending = suggestions ?? [];
  const bySpeaker = new Map(pending.map((s) => [s.speakerId, s]));
  // Two labels with the same suggested name usually mean diarization split one person in two.
  const nameCounts = new Map<string, number>();
  for (const s of pending) nameCounts.set(s.name.toLowerCase(), (nameCounts.get(s.name.toLowerCase()) ?? 0) + 1);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Speakers</h3>
        {canSuggest ? (
          <button
            onClick={suggest}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-60"
            title="Claude looks for introductions and people being addressed by name"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {loading ? "Reading transcript…" : "Suggest names"}
          </button>
        ) : (
          <span className="text-xs text-zinc-500">talk time</span>
        )}
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{error}</p>}
      {suggestions && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
          <Sparkles className="size-3.5 shrink-0" />
          <span className="flex-1">
            {pending.length === 0
              ? "No more names found in the transcript. Rename the rest by clicking a name."
              : `${pending.length} name${pending.length === 1 ? "" : "s"} found. Check the evidence before accepting.`}
          </span>
          {pending.length > 1 && (
            <button onClick={() => accept(pending)} className="shrink-0 rounded-md bg-brand-600 px-2 py-1 font-medium text-white hover:bg-brand-700">
              Accept all
            </button>
          )}
          <button onClick={() => setSuggestions(null)} className="shrink-0 rounded p-0.5 hover:bg-brand-100" aria-label="Dismiss suggestions">
            <X className="size-3.5" />
          </button>
        </div>
      )}
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
                {bySpeaker.has(s.id) && <SuggestionRow sug={bySpeaker.get(s.id)!} duplicate={(nameCounts.get(bySpeaker.get(s.id)!.name.toLowerCase()) ?? 0) > 1} onSeek={onSeek} onAccept={(sug) => accept([sug])} onDismiss={(sug) => setSuggestions((all) => all?.filter((x) => x.speakerId !== sug.speakerId) ?? null)} />}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SuggestionRow({
  sug,
  duplicate,
  onSeek,
  onAccept,
  onDismiss,
}: {
  sug: Suggestion;
  duplicate: boolean;
  onSeek?: (ms: number) => void;
  onAccept: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-brand-100 bg-brand-50/50 p-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">Suggested:</span>
        <span className="truncate font-semibold text-zinc-900">{sug.name}</span>
        <span
          className={clsx(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
            sug.confidence === "high" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
          )}
        >
          {sug.confidence}
        </span>
        <button onClick={() => onAccept(sug)} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-600 px-2 py-0.5 font-medium text-white hover:bg-brand-700">
          <Check className="size-3" /> Accept
        </button>
        <button onClick={() => onDismiss(sug)} className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Dismiss">
          <X className="size-3.5" />
        </button>
      </div>
      <p className="mt-1 text-zinc-600">
        “{sug.evidence}”
        {sug.timestampMs != null && onSeek && (
          <button onClick={() => onSeek(sug.timestampMs!)} className="ml-1 inline-flex items-center gap-0.5 font-medium tabular-nums text-brand-700 hover:underline">
            <Play className="size-2.5 fill-current" /> {formatMs(sug.timestampMs)}
          </button>
        )}
      </p>
      {duplicate && (
        <p className="mt-1 text-amber-700">Also suggested for another speaker: likely one person split in two. Move their lines in the transcript.</p>
      )}
    </div>
  );
}

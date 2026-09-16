"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { Check, ChevronDown, Scissors, Search, Share2, Star, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SpeakerAvatar, speakerIndex } from "@/components/speaker-avatars";
import { formatMs } from "@/lib/time";
import { speakerColor, speakerName } from "@/lib/ui";
import type { Segment, Speaker } from "./types";

function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="rounded bg-amber-200 px-0.5">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

export function TranscriptPanel({
  segments,
  speakers,
  currentMs,
  onSeek,
  onHighlight,
  onReassign,
  onSplit,
  onRange,
  bounds,
}: {
  segments: Segment[];
  speakers: Speaker[];
  currentMs: number;
  onSeek: (ms: number) => void;
  onHighlight?: (seg: Segment) => void;
  /** Fix diarization: move a line to another speaker, or to a new one. */
  onReassign?: (seg: Segment, target: number | "new") => Promise<void>;
  onSplit?: (seg: Segment) => Promise<void>;
  /** Selecting transcript text offers to highlight or share exactly that stretch of the call. */
  onRange?: (startMs: number, endMs: number, action: "highlight" | "share") => void;
  bounds?: { startMs: number; endMs: number };
}) {
  const [speakerFilter, setSpeakerFilter] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [selection, setSelection] = useState<{ startMs: number; endMs: number; top: number; left: number } | null>(null);
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    if (menuFor === null) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as HTMLElement).closest("[data-speaker-menu]")) setMenuFor(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menuFor]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrollAt = useRef(0);
  const byId = useMemo(() => new Map(speakers.map((s) => [s.id, s])), [speakers]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return segments.filter(
      (s) =>
        (!bounds || (s.endMs > bounds.startMs && s.startMs < bounds.endMs)) &&
        (speakerFilter === null || s.speakerId === speakerFilter) &&
        (!q || s.text.toLowerCase().includes(q)),
    );
  }, [segments, speakerFilter, query, bounds]);

  const activeIdx = useMemo(() => {
    let lo = 0, hi = visible.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (visible[mid].startMs <= currentMs + 150) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }, [visible, currentMs]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 88,
    overscan: 8,
  });

  // Map a text selection onto the transcript lines it touches (rows carry data-seg-id).
  useEffect(() => {
    if (!onRange) return;
    const update = () => {
      const sel = window.getSelection();
      const root = scrollRef.current;
      if (!sel || sel.isCollapsed || !sel.toString().trim() || !root) return setSelection(null);
      const rowOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-seg-id]");
      const a = rowOf(sel.anchorNode);
      const b = rowOf(sel.focusNode);
      if (!a || !b || !root.contains(a) || !root.contains(b)) return setSelection(null);
      const ids = new Set([Number(a.dataset.segId), Number(b.dataset.segId)]);
      const touched = segments.filter((s) => ids.has(s.id));
      if (touched.length === 0) return setSelection(null);
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setSelection({
        startMs: Math.min(...touched.map((s) => s.startMs)),
        endMs: Math.max(...touched.map((s) => s.endMs)),
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [onRange, segments]);

  // Follow the playhead unless the user scrolled in the last 4 seconds.
  useEffect(() => {
    if (!follow || activeIdx < 0 || Date.now() - userScrollAt.current < 4000) return;
    virtualizer.scrollToIndex(activeIdx, { align: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, follow]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-zinc-100 p-3">
        <label className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm focus-within:border-brand-500">
          <Search className="size-4 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcript"
            className="w-full bg-transparent outline-none placeholder:text-zinc-400"
          />
          {query && (
            <>
              <span className="shrink-0 text-xs text-zinc-500">{visible.length} matches</span>
              <button onClick={() => setQuery("")} className="text-zinc-400 hover:text-zinc-700">
                <X className="size-4" />
              </button>
            </>
          )}
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setSpeakerFilter(null)}
            className={clsx(
              "rounded-full border px-2.5 py-0.5 text-xs",
              speakerFilter === null ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50",
            )}
          >
            Everyone
          </button>
          {speakers.map((s) => (
            <button
              key={s.id}
              onClick={() => setSpeakerFilter(speakerFilter === s.id ? null : s.id)}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
                speakerFilter === s.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50",
              )}
            >
              <span className={clsx("size-2 rounded-full", speakerColor(speakerIndex(s)).bg)} />
              {speakerName(s)}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-500">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-brand-600" />
            Follow playback
          </label>
        </div>
      </div>

      <div
        ref={scrollRef}
        onWheel={() => {
          userScrollAt.current = Date.now();
          setSelection(null);
        }}
        onTouchMove={() => (userScrollAt.current = Date.now())}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto"
      >
        {visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">No transcript lines match.</p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize() }} className="relative">
            {virtualizer.getVirtualItems().map((row) => {
              const seg = visible[row.index];
              const speaker = seg.speakerId ? byId.get(seg.speakerId) : undefined;
              const active = row.index === activeIdx;
              return (
                <div
                  key={seg.id}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  className="absolute inset-x-0"
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <div
                    data-seg-id={seg.id}
                    onClick={() => {
                      // Finishing a text selection also fires click; don't jump the player then.
                      if (window.getSelection()?.toString().trim()) return;
                      onSeek(seg.startMs);
                    }}
                    className={clsx(
                      "group flex cursor-pointer gap-3 border-l-2 px-4 py-2.5 transition",
                      active ? "border-brand-500 bg-brand-50/70" : "border-transparent hover:bg-zinc-50",
                    )}
                  >
                    {speaker ? <SpeakerAvatar speaker={speaker} /> : <span className="size-6" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs">
                        {onReassign ? (
                          <span className="relative" data-speaker-menu onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setMenuFor(menuFor === seg.id ? null : seg.id)}
                              title="Wrong speaker? Change it"
                              className={clsx(
                                "inline-flex items-center gap-0.5 rounded px-1 -mx-1 font-medium hover:bg-zinc-100",
                                speaker && speakerColor(speakerIndex(speaker)).text,
                              )}
                            >
                              {speaker ? speakerName(speaker) : "Unknown"}
                              <ChevronDown className="size-3 opacity-0 transition group-hover:opacity-60" />
                            </button>
                            {menuFor === seg.id && (
                              <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-52 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 text-sm shadow-lg">
                                <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Who said this?</p>
                                {speakers.map((s) => (
                                  <button
                                    key={s.id}
                                    disabled={saving === seg.id}
                                    onClick={async () => {
                                      setMenuFor(null);
                                      if (s.id === seg.speakerId) return;
                                      setSaving(seg.id);
                                      await onReassign(seg, s.id).finally(() => setSaving(null));
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
                                  >
                                    <span className={clsx("size-2 shrink-0 rounded-full", speakerColor(speakerIndex(s)).bg)} />
                                    <span className="flex-1 truncate">{speakerName(s)}</span>
                                    {s.id === seg.speakerId && <Check className="size-3.5 text-brand-600" />}
                                  </button>
                                ))}
                                <button
                                  onClick={async () => {
                                    setMenuFor(null);
                                    setSaving(seg.id);
                                    await onReassign(seg, "new").finally(() => setSaving(null));
                                  }}
                                  className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-zinc-100 px-2.5 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
                                >
                                  <UserPlus className="size-3.5 text-zinc-400" /> New speaker
                                </button>
                                {onSplit && /[.?!]\s+\S/.test(seg.text) && (
                                  <button
                                    onClick={async () => {
                                      setMenuFor(null);
                                      setSaving(seg.id);
                                      await onSplit(seg).finally(() => setSaving(null));
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
                                    title="Two people in one line? Split it, then fix each part"
                                  >
                                    <Scissors className="size-3.5 text-zinc-400" /> Split into sentences
                                  </button>
                                )}
                              </div>
                            )}
                          </span>
                        ) : (
                          <span className={clsx("font-medium", speaker && speakerColor(speakerIndex(speaker)).text)}>
                            {speaker ? speakerName(speaker) : "Unknown"}
                          </span>
                        )}
                        <span className="tabular-nums text-zinc-400">{formatMs(seg.startMs)}</span>
                        {onHighlight && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onHighlight(seg);
                            }}
                            title="Save this line as a highlight"
                            className={clsx(
                              "ml-auto inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 transition hover:bg-amber-100",
                              // Visible on hover, on the line that's playing, and always on touch screens.
                              active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100",
                            )}
                          >
                            <Star className="size-3" /> Highlight
                          </button>
                        )}
                      </div>
                      <p className={clsx("mt-0.5 text-sm leading-relaxed", active ? "text-zinc-900" : "text-zinc-700", saving === seg.id && "opacity-50")}>
                        <Highlighted text={seg.text} query={query.trim()} />
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {onRange && selection && (
        <div
          className="fixed z-40 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-lg bg-zinc-900 p-1 text-xs text-white shadow-lg"
          style={{ top: selection.top - 8, left: selection.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="px-2 tabular-nums text-zinc-400">
            {formatMs(selection.startMs)}–{formatMs(selection.endMs)}
          </span>
          <button
            onClick={() => {
              onRange(selection.startMs, selection.endMs, "highlight");
              window.getSelection()?.removeAllRanges();
              setSelection(null);
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/15"
          >
            <Star className="size-3.5 text-amber-400" /> Highlight
          </button>
          <button
            onClick={() => {
              onRange(selection.startMs, selection.endMs, "share");
              window.getSelection()?.removeAllRanges();
              setSelection(null);
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/15"
          >
            <Share2 className="size-3.5" /> Share clip
          </button>
        </div>
      )}
    </div>
  );
}

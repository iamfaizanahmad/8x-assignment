"use client";

import clsx from "clsx";
import { ArrowLeft, Calendar, Clock, Loader2, RotateCw, Share2, Star, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SummaryContent, TemplateId } from "@/db/schema";
import type { MeetingDetail } from "@/lib/queries";
import { formatMs } from "@/lib/time";
import { formatDuration } from "@/lib/ui";
import { LocalTime } from "@/components/local-time";

const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
import { ActionItemsPanel } from "./action-items-panel";
import { HighlightsPanel } from "./highlights-panel";
import { MediaPlayer } from "./media-player";
import { ShareDialog, type ShareTarget } from "./share-dialog";
import { SpeakersPanel } from "./speakers-panel";
import { SummaryPanel } from "./summary-panel";
import { Timeline } from "./timeline";
import { TranscriptPanel } from "./transcript-panel";
import type { Highlight, Segment, Speaker } from "./types";
import { usePlayer } from "./use-player";

type Tab = "summary" | "transcript" | "actions" | "highlights";

const CLIP_BEFORE_MS = 15_000;
const CLIP_AFTER_MS = 5_000;

function Processing({ meetingId, status, error }: { meetingId: string; status: string; error: string | null }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (status === "failed") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/meetings/${meetingId}/process`).then((r) => r.json()).catch(() => null);
      if (r && r.status !== status) router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [meetingId, status, router]);

  const steps = [
    { key: "uploaded", label: "Uploaded" },
    { key: "transcribing", label: "Transcribing & identifying speakers" },
    { key: "summarizing", label: "Writing summary, chapters & action items" },
  ];
  const current = steps.findIndex((s) => s.key === status);

  if (status === "failed")
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <div className="flex items-center gap-2 font-medium text-red-800">
          <TriangleAlert className="size-4" /> Processing failed
        </div>
        <p className="mt-1 text-sm text-red-700">{error ?? "Something went wrong."}</p>
        <button
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            await fetch(`/api/meetings/${meetingId}/process`, { method: "POST" });
            router.refresh();
          }}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-red-800 shadow-sm ring-1 ring-red-200 hover:bg-red-100"
        >
          <RotateCw className={clsx("size-4", retrying && "animate-spin")} /> Retry
        </button>
      </div>
    );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <p className="mb-4 text-sm text-zinc-600">Processing your recording. This usually takes under a minute.</p>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3 text-sm">
            {i < current ? (
              <span className="grid size-5 place-items-center rounded-full bg-emerald-500 text-[10px] text-white">✓</span>
            ) : i === current ? (
              <Loader2 className="size-5 animate-spin text-brand-600" />
            ) : (
              <span className="size-5 rounded-full border-2 border-zinc-200" />
            )}
            <span className={i <= current ? "text-zinc-900" : "text-zinc-400"}>{s.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function MeetingView({ data, initialMs }: { data: MeetingDetail; initialMs?: number }) {
  const { meeting } = data;
  const player = usePlayer({ initialMs });
  const [tab, setTab] = useState<Tab>(initialMs ? "transcript" : "summary");
  const [speakers, setSpeakers] = useState<Speaker[]>(data.speakers);
  const [highlights, setHighlights] = useState<Highlight[]>(data.highlights);
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => setSpeakers(data.speakers), [data.speakers]);

  const durationMs = player.durationMs || meeting.durationS * 1000;
  const initialSummaries = useMemo(
    () => Object.fromEntries(data.summaries.map((s) => [s.template, s.content])) as Partial<Record<TemplateId, SummaryContent>>,
    [data.summaries],
  );

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const addHighlight = useCallback(
    async (startMs: number, endMs: number) => {
      const res = await fetch(`/api/meetings/${meeting.id}/highlights`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startMs: Math.max(0, Math.round(startMs)), endMs: Math.round(endMs) }),
      });
      if (!res.ok) return flash("Could not save highlight");
      const row: Highlight = await res.json();
      setHighlights((h) => [...h, row].sort((a, b) => a.startMs - b.startMs));
      flash(`Highlighted ${formatMs(row.startMs)}–${formatMs(row.endMs)}`);
    },
    [meeting.id],
  );

  const highlightNow = useCallback(() => {
    const t = player.currentMs;
    addHighlight(t - CLIP_BEFORE_MS, Math.min(durationMs || t + CLIP_AFTER_MS, t + CLIP_AFTER_MS));
  }, [player.currentMs, durationMs, addHighlight]);

  // Keyboard: space = play/pause, H = highlight, ←/→ = ±5s. Refs keep one listener for the page's lifetime.
  const keyState = useRef({ player, highlightNow });
  keyState.current = { player, highlightNow };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, [contenteditable], video, audio") || e.metaKey || e.ctrlKey) return;
      const { player: p, highlightNow: hl } = keyState.current;
      if (e.key === " ") { e.preventDefault(); p.toggle(); }
      else if (e.key === "h" || e.key === "H") hl();
      else if (e.key === "ArrowRight") p.seek(p.currentMs + 5000, false);
      else if (e.key === "ArrowLeft") p.seek(p.currentMs - 5000, false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function rename(s: Speaker, name: string) {
    setSpeakers((all) => all.map((x) => (x.id === s.id ? { ...x, displayName: name || null } : x)));
    await fetch(`/api/speakers/${s.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: name }),
    });
  }

  const ready = meeting.status === "ready";
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "summary", label: "Summary" },
    { id: "transcript", label: "Transcript" },
    { id: "actions", label: "Action items", count: data.actionItems.length },
    { id: "highlights", label: "Highlights", count: highlights.length },
  ];

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <Link href="/" className="mt-1 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" title="All meetings">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{meeting.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3.5" />
              <LocalTime date={meeting.startedAt} options={DATE_TIME} />
            </span>
            {meeting.durationS > 0 && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" /> {formatDuration(meeting.durationS)}
              </span>
            )}
            {speakers.length > 0 && <span>{speakers.length} speakers</span>}
          </div>
        </div>
        {ready && (
          <div className="flex items-center gap-2">
            <button
              onClick={highlightNow}
              title="Highlight the last 15 seconds (H)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50"
            >
              <Star className="size-4 text-amber-500" /> Highlight
              <kbd className="hidden rounded border border-zinc-200 px-1 text-[10px] text-zinc-400 sm:inline">H</kbd>
            </button>
            <button
              onClick={() => setShare({ kind: "meeting" })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              <Share2 className="size-4" /> Share
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(380px,520px)]">
        <div className="space-y-4">
          <MediaPlayer player={player} src={data.mediaUrl} mediaType={meeting.mediaType} title={meeting.title} />
          {ready ? (
            <>
              <Timeline
                durationMs={durationMs}
                currentMs={player.currentMs}
                chapters={meeting.chapters}
                highlights={highlights}
                speakers={speakers}
                segments={data.segments}
                onSeek={(ms) => player.seek(ms)}
              />
              <SpeakersPanel speakers={speakers} onRename={rename} />
            </>
          ) : (
            <Processing meetingId={meeting.id} status={meeting.status} error={meeting.error} />
          )}
        </div>

        {ready && (
          <div className="flex h-[calc(100vh-7rem)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white lg:sticky lg:top-[4.5rem]">
            <div className="flex shrink-0 gap-1 border-b border-zinc-100 px-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx(
                    "relative px-3 py-3 text-sm transition",
                    tab === t.id ? "font-medium text-zinc-900" : "text-zinc-500 hover:text-zinc-800",
                  )}
                >
                  {t.label}
                  {t.count ? <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 text-xs text-zinc-600">{t.count}</span> : null}
                  {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-600" />}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {tab === "summary" && (
                <SummaryPanel
                  meetingId={meeting.id}
                  title={meeting.title}
                  initial={initialSummaries}
                  chapters={meeting.chapters}
                  onSeek={(ms) => player.seek(ms)}
                />
              )}
              {tab === "transcript" && (
                <TranscriptPanel
                  segments={data.segments}
                  speakers={speakers}
                  currentMs={player.currentMs}
                  onSeek={(ms) => player.seek(ms)}
                  onHighlight={(seg: Segment) => addHighlight(seg.startMs, seg.endMs)}
                />
              )}
              {tab === "actions" && <ActionItemsPanel items={data.actionItems} onSeek={(ms) => player.seek(ms)} />}
              {tab === "highlights" && (
                <HighlightsPanel
                  highlights={highlights}
                  segments={data.segments}
                  onSeek={(ms) => player.seek(ms)}
                  onShare={(h) => setShare({ kind: "clip", startMs: h.startMs, endMs: h.endMs })}
                  onDelete={async (h) => {
                    setHighlights((all) => all.filter((x) => x.id !== h.id));
                    await fetch(`/api/highlights/${h.id}`, { method: "DELETE" });
                  }}
                  onNote={async (h, note) => {
                    setHighlights((all) => all.map((x) => (x.id === h.id ? { ...x, note } : x)));
                    await fetch(`/api/highlights/${h.id}`, {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ note }),
                    });
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {share && <ShareDialog meetingId={meeting.id} target={share} onClose={() => setShare(null)} />}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}

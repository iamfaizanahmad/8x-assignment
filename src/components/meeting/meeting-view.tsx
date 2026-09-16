"use client";

import clsx from "clsx";
import { ArrowLeft, Calendar, Clock, Loader2, RotateCw, Share2, Sparkles, Star, Trash2, TriangleAlert } from "lucide-react";
import { AskPanel } from "@/components/ask-panel";
import { DeleteMeetingDialog } from "@/components/delete-meeting";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STALE_PROCESSING_MS, STALE_UPLOAD_MS } from "@/lib/limits";
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

type Tab = "summary" | "ask" | "transcript" | "actions" | "highlights";

const CLIP_BEFORE_MS = 15_000;
const CLIP_AFTER_MS = 5_000;

function Processing({
  meetingId,
  status,
  error,
  statusUpdatedAt,
}: {
  meetingId: string;
  status: string;
  error: string | null;
  statusUpdatedAt: Date;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status === "failed") return;
    const t = setInterval(async () => {
      setNow(Date.now());
      const r = await fetch(`/api/meetings/${meetingId}/process`).then((r) => r.json()).catch(() => null);
      if (r && (r.status !== status || new Date(r.statusUpdatedAt).getTime() !== new Date(statusUpdatedAt).getTime())) router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [meetingId, status, statusUpdatedAt, router]);

  const age = now - new Date(statusUpdatedAt).getTime();
  const stuck = (status === "uploaded" && age > STALE_UPLOAD_MS) || (status !== "uploaded" && status !== "failed" && age > STALE_PROCESSING_MS);

  const [retryNote, setRetryNote] = useState<string | null>(null);
  const retry = async () => {
    setRetrying(true);
    setRetryNote(null);
    const res = await fetch(`/api/meetings/${meetingId}/process`, { method: "POST" }).catch(() => null);
    setRetrying(false);
    if (res?.status === 409) return setRetryNote("The file hasn't finished uploading yet. Check again once the upload completes.");
    router.refresh();
  };

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
          onClick={retry}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-red-800 shadow-sm ring-1 ring-red-200 hover:bg-red-100"
        >
          <RotateCw className={clsx("size-4", retrying && "animate-spin")} /> Retry
        </button>
      </div>
    );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <p className="mb-4 text-sm text-zinc-600">Processing your recording. This usually takes under a minute.</p>
      {stuck && (
        <div className="mb-4 flex items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <TriangleAlert className="size-4 shrink-0" />
          <span className="flex-1">
            {status === "uploaded"
              ? retryNote ??
                "Waiting for the recording to finish uploading. Large files can take a while; keep the uploading tab open. If the upload was interrupted, check again below."
              : "This is taking longer than it should."}
          </span>
          <button
            disabled={retrying}
            onClick={retry}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white px-2.5 py-1 font-medium shadow-sm ring-1 ring-amber-200 hover:bg-amber-100"
          >
            <RotateCw className={clsx("size-3.5", retrying && "animate-spin")} /> {status === "uploaded" ? "Check again" : "Retry"}
          </button>
        </div>
      )}
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
  const router = useRouter();
  const [speakers, setSpeakers] = useState<Speaker[]>(data.speakers);
  const [segments, setSegments] = useState<Segment[]>(data.segments);
  const [speakersEdited, setSpeakersEdited] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [notesVersion, setNotesVersion] = useState(0);
  const [highlights, setHighlights] = useState<Highlight[]>(data.highlights);
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => setSpeakers(data.speakers), [data.speakers]);
  useEffect(() => setSegments(data.segments), [data.segments]);
  // Panels keep their own state; remount them when fresh notes arrive from the server.
  useEffect(() => setNotesVersion((v) => v + 1), [data.summaries, data.actionItems]);

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
    const res = await fetch(`/api/speakers/${s.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: name }),
    });
    if (!res.ok) {
      setSpeakers((all) => all.map((x) => (x.id === s.id ? { ...x, displayName: s.displayName } : x)));
      return flash("Could not rename speaker");
    }
    // Notes were written with the old name; offer to refresh them.
    setSpeakersEdited(true);
  }

  async function reassign(seg: Segment, target: number | "new") {
    const res = await fetch(`/api/segments/${seg.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(target === "new" ? { newSpeaker: true } : { speakerId: target }),
    });
    if (!res.ok) return flash("Could not change speaker");
    const r: { segmentId: number; speakerId: number; speakers: Speaker[] } = await res.json();
    setSegments((all) => all.map((s) => (s.id === r.segmentId ? { ...s, speakerId: r.speakerId } : s)));
    setSpeakers([...r.speakers].sort((a, b) => b.talkTimeS - a.talkTimeS));
    setSpeakersEdited(true);
  }

  async function split(seg: Segment) {
    const res = await fetch(`/api/segments/${seg.id}/split`, { method: "POST" });
    if (!res.ok) return flash("Could not split this line");
    const r: { removedId: number; segments: Segment[] } = await res.json();
    setSegments((all) => [...all.filter((s) => s.id !== r.removedId), ...r.segments].sort((a, b) => a.startMs - b.startMs));
    flash(`Split into ${r.segments.length} lines — now set who said each`);
  }

  async function regenerate() {
    setRegenerating(true);
    const res = await fetch(`/api/meetings/${meeting.id}/regenerate`, { method: "POST" });
    setRegenerating(false);
    if (!res.ok) return flash("Could not regenerate notes");
    setSpeakersEdited(false);
    router.refresh();
    flash("Notes updated with the corrected speakers");
  }

  const ready = meeting.status === "ready";
  // Seeded showcase meetings stay intact for every reviewer: highlight and share, but no structural edits.
  const isSample = meeting.source === "seed";
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "summary", label: "Summary" },
    { id: "ask", label: "Ask AI" },
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
        <div className="flex items-center gap-2">
          {meeting.source !== "seed" && (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete meeting"
              aria-label="Delete meeting"
              className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          {ready && (
            <>
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
            </>
          )}
        </div>
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
                segments={segments}
                onSeek={(ms) => player.seek(ms)}
              />
              <SpeakersPanel speakers={speakers} onRename={rename} readOnly={isSample} />
              {isSample && (
                <p className="px-1 text-xs text-zinc-500">
                  Sample meeting: speaker edits are disabled on the public demo so every visitor sees the same data. Highlights and sharing
                  work.
                </p>
              )}
            </>
          ) : (
            <Processing meetingId={meeting.id} status={meeting.status} error={meeting.error} statusUpdatedAt={meeting.statusUpdatedAt} />
          )}
        </div>

        {ready && (
          <div className="flex h-[calc(100vh-7rem)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white lg:sticky lg:top-[4.5rem]">
            <div className="scroll-thin flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-100 px-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx(
                    "relative shrink-0 whitespace-nowrap px-3 py-3 text-sm transition",
                    tab === t.id ? "font-medium text-zinc-900" : "text-zinc-500 hover:text-zinc-800",
                  )}
                >
                  {t.id === "ask" && <Sparkles className="mr-1 inline size-3.5 -translate-y-px text-brand-600" />}
                  {t.label}
                  {t.count ? <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 text-xs text-zinc-600">{t.count}</span> : null}
                  {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-600" />}
                </button>
              ))}
            </div>
            {speakersEdited && (
              <div className="flex shrink-0 items-center gap-3 border-b border-brand-100 bg-brand-50 px-4 py-2 text-xs text-brand-800">
                <span className="flex-1">Speakers changed. Summary and action items still use the old attribution.</span>
                <button
                  onClick={regenerate}
                  disabled={regenerating}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand-600 px-2.5 py-1 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {regenerating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {regenerating ? "Updating…" : "Update notes"}
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1" key={notesVersion}>
              {/* Kept mounted so the conversation survives switching tabs. */}
              <div className={clsx("h-full", tab !== "ask" && "hidden")}>
                <AskPanel scope="meeting" meetingId={meeting.id} onSeek={(ms) => player.seek(ms)} />
              </div>
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
                  segments={segments}
                  speakers={speakers}
                  currentMs={player.currentMs}
                  onSeek={(ms) => player.seek(ms)}
                  onHighlight={(seg: Segment) => addHighlight(seg.startMs, seg.endMs)}
                  onRange={(startMs, endMs, action) => {
                    if (endMs - startMs > 10 * 60_000) return flash("Clips can be up to 10 minutes — select less text");
                    if (action === "highlight") addHighlight(startMs, endMs);
                    else setShare({ kind: "clip", startMs, endMs });
                  }}
                  onReassign={isSample ? undefined : reassign}
                  onSplit={isSample ? undefined : split}
                />
              )}
              {tab === "actions" && <ActionItemsPanel items={data.actionItems} onSeek={(ms) => player.seek(ms)} />}
              {tab === "highlights" && (
                <HighlightsPanel
                  highlights={highlights}
                  segments={segments}
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

      {confirmDelete && <DeleteMeetingDialog meeting={meeting} afterDelete="home" onClose={() => setConfirmDelete(false)} />}
      {share && <ShareDialog meetingId={meeting.id} target={share} onClose={() => setShare(null)} />}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}

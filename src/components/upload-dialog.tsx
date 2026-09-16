"use client";

import clsx from "clsx";
import { FileAudio, Loader2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { MAX_UPLOAD_DURATION_S } from "@/lib/limits";

type Phase = { kind: "idle" } | { kind: "uploading"; progress: number; name: string } | { kind: "error"; message: string };

function putWithProgress(url: string, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
    xhr.send(file);
  });
}

/** Duration from the file's own metadata, before uploading anything. Null when the browser can't decode the format. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = setTimeout(() => done(null), 8000);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(el.duration) ? el.duration : null);
    };
    el.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    el.src = url;
  });
}

export function UploadButton({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
      >
        <Upload className="size-4" /> Upload recording
      </button>
      {open && <UploadDialog enabled={enabled} onClose={() => setOpen(false)} />}
    </>
  );
}

export function UploadDialog({
  enabled,
  onClose,
  event,
}: {
  enabled: boolean;
  onClose: () => void;
  /** When set, the meeting is filed against this calendar event (title, time, attendees come from Google). */
  event?: { id: string; title: string };
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  async function start(file: File) {
    if (!/^(audio|video)\//.test(file.type)) return setPhase({ kind: "error", message: "Please choose an audio or video file." });
    setPhase({ kind: "uploading", progress: 0, name: file.name });
    let meetingId: string | null = null;
    try {
      const durationS = await readDuration(file);
      if (durationS != null && durationS > MAX_UPLOAD_DURATION_S)
        throw new Error(`This recording is ${Math.round(durationS / 60)} minutes. The demo accepts up to ${MAX_UPLOAD_DURATION_S / 60}.`);

      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size, durationS, calendarEventId: event?.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start upload");
      meetingId = data.id;

      try {
        await putWithProgress(data.uploadUrl, file, (p) => setPhase({ kind: "uploading", progress: p, name: file.name }));
      } catch (err) {
        // The file never arrived: remove the empty meeting instead of leaving it stuck in the list.
        await fetch(`/api/meetings/${data.id}`, { method: "DELETE" }).catch(() => {});
        meetingId = null;
        throw err;
      }

      // Even if starting processing fails, the meeting page shows its state and offers Retry.
      await fetch(`/api/meetings/${data.id}/process`, { method: "POST" }).catch(() => {});
      router.push(`/meetings/${data.id}`);
    } catch (err) {
      if (meetingId) router.push(`/meetings/${meetingId}`);
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "Upload failed" });
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{event ? "Attach recording" : "Upload a recording"}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {event ? (
                <>
                  Notes will be filed under <span className="font-medium text-zinc-800">{event.title}</span>.
                </>
              ) : (
                "Stands in for the meeting bot: drop a Zoom, Meet or Teams recording and get the transcript, summary and action items."
              )}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-5" />
          </button>
        </div>

        {!enabled ? (
          <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            Uploads are paused on this public demo to keep costs in check. Explore the seeded meetings instead.
          </p>
        ) : phase.kind === "uploading" ? (
          <div className="rounded-xl border border-zinc-200 p-4">
            <div className="flex items-center gap-3 text-sm">
              <FileAudio className="size-5 text-brand-600" />
              <span className="truncate font-medium">{phase.name}</span>
              <Loader2 className="ml-auto size-4 animate-spin text-zinc-400" />
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              {phase.progress < 1 ? `Uploading… ${Math.round(phase.progress * 100)}%` : "Starting transcription…"}
            </p>
          </div>
        ) : (
          <>
            <button
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files[0];
                if (f) start(f);
              }}
              className={clsx(
                "flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-sm transition",
                dragging ? "border-brand-500 bg-brand-50" : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
              )}
            >
              <Upload className="size-6 text-zinc-400" />
              <span className="font-medium">Drop a file or click to browse</span>
              <span className="text-xs text-zinc-500">MP4, MOV, WebM, MP3, M4A, WAV · up to 90 minutes, 2 GB</span>
            </button>
            {phase.kind === "error" && <p className="mt-3 text-sm text-red-600">{phase.message}</p>}
            <input
              ref={input}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) start(f);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

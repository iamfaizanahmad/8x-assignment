"use client";

import { Check, Copy, Link2, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatMs } from "@/lib/time";

export type ShareTarget = { kind: "meeting" } | { kind: "clip"; startMs: number; endMs: number };

export function ShareDialog({ meetingId, target, onClose }: { meetingId: string; target: ShareTarget; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meetingId, ...target }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setUrl(`${window.location.origin}/share/${data.slug}`);
      })
      .catch((e) => setError(e.message || "Could not create link"));
  }, [meetingId, target]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{target.kind === "clip" ? "Share clip" : "Share meeting"}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {target.kind === "clip"
                ? `Anyone with the link can watch ${formatMs(target.startMs)}–${formatMs(target.endMs)} and read that part of the transcript. No sign-in needed.`
                : "Anyone with the link can watch the recording, read the summary and the transcript. No sign-in needed."}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-5" />
          </button>
        </div>
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : !url ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" /> Creating link…
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <Link2 className="size-4 shrink-0 text-zinc-400" />
              <span className="truncate">{url}</span>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(url);
                setCopied(true);
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

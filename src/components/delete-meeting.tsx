"use client";

import { Loader2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteMeetingDialog({
  meeting,
  onClose,
  afterDelete = "refresh",
}: {
  meeting: { id: string; title: string };
  onClose: () => void;
  afterDelete?: "refresh" | "home";
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
    if (!res.ok) {
      setDeleting(false);
      setError((await res.json().catch(() => null))?.error ?? "Could not delete this meeting.");
      return;
    }
    onClose();
    if (afterDelete === "home") router.push("/");
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-900/40 p-4" onClick={() => !deleting && onClose()}>
      <div
        role="alertdialog"
        aria-labelledby="delete-title"
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !deleting && onClose()}
      >
        <div className="flex items-start justify-between gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-red-50">
            <Trash2 className="size-5 text-red-600" />
          </span>
          <button onClick={onClose} disabled={deleting} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-5" />
          </button>
        </div>
        <h2 id="delete-title" className="mt-4 text-lg font-semibold">
          Delete this meeting?
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          <span className="font-medium text-zinc-900">{meeting.title}</span> will be permanently deleted with its recording, transcript, notes,
          highlights and every share link. This can&apos;t be undone.
        </p>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={deleting}
            autoFocus
            className="rounded-lg border border-zinc-200 px-3.5 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {deleting && <Loader2 className="size-4 animate-spin" />} Delete meeting
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small trash button for list rows; sits inside a <Link>, so it must not navigate. */
export function DeleteMeetingButton({ meeting }: { meeting: { id: string; title: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        title="Delete meeting"
        aria-label={`Delete ${meeting.title}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="rounded-md p-1.5 text-zinc-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="size-4" />
      </button>
      {open && <DeleteMeetingDialog meeting={meeting} onClose={() => setOpen(false)} />}
    </>
  );
}

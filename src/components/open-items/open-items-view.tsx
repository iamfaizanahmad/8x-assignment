"use client";

import clsx from "clsx";
import { CalendarClock, ChevronDown, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LocalTime } from "@/components/local-time";
import { SpeakerAvatar } from "@/components/speaker-avatars";
import type { OpenItem, OpenItemGroup, OpenItems } from "@/lib/queries";
import { formatMs } from "@/lib/time";
import { plural, speakerName } from "@/lib/ui";

const MEETING_DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

export function OpenItemsView({ data }: { data: OpenItems }) {
  const pendingTab = data.status === "pending";
  // Optimistic ticks: id -> done. Rows stay where they are (struck through) so a mis-click can be undone in place.
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const isDone = (it: OpenItem) => overrides[it.id] ?? it.done;
  const moved = data.groups.flatMap((g) => g.items).filter((it) => isDone(it) !== it.done).length;
  const counts = pendingTab
    ? { pending: data.counts.pending - moved, done: data.counts.done + moved }
    : { pending: data.counts.pending + moved, done: data.counts.done - moved };
  const people = data.groups.filter((g) => g.speaker).length;

  async function toggle(it: OpenItem) {
    const next = !isDone(it);
    setOverrides((o) => ({ ...o, [it.id]: next }));
    setErrors((e) => {
      const rest = { ...e };
      delete rest[it.id];
      return rest;
    });
    const res = await fetch(`/api/action-items/${it.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ done: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setOverrides((o) => ({ ...o, [it.id]: !next }));
      setErrors((e) => ({ ...e, [it.id]: "Couldn't save that. Try again." }));
    }
  }

  return (
    <>
      <nav aria-label="Action item status" className="mb-6 flex gap-1 border-b border-zinc-200">
        {(["pending", "done"] as const).map((s) => (
          <Link
            key={s}
            href={s === "pending" ? "/open-items" : "/open-items?status=done"}
            aria-current={data.status === s ? "page" : undefined}
            className={clsx(
              "relative px-3 py-2.5 text-sm transition",
              data.status === s ? "font-medium text-zinc-900" : "text-zinc-500 hover:text-zinc-800",
            )}
          >
            {s === "pending" ? "Pending" : "Done"}
            <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 text-xs text-zinc-600">{counts[s]}</span>
            {data.status === s && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-600" />}
          </Link>
        ))}
      </nav>

      {data.groups.length === 0 ? (
        <EmptyState pendingTab={pendingTab} anyDone={data.counts.done > 0} />
      ) : (
        <>
          <p className="mb-4 text-xs text-zinc-500">
            {pendingTab
              ? `${plural(counts.pending, "open item")} · ${plural(people, "person", "people")}`
              : `${plural(counts.done, "completed item")} · most recently completed first`}
          </p>
          <div className="space-y-6">
            {data.groups.map((g) => (
              <Group
                key={g.key}
                group={g}
                pendingTab={pendingTab}
                isDone={isDone}
                errors={errors}
                expandedId={expandedId}
                onExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
                onToggle={toggle}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Group({
  group,
  pendingTab,
  isDone,
  errors,
  expandedId,
  onExpand,
  onToggle,
}: {
  group: OpenItemGroup;
  pendingTab: boolean;
  isDone: (it: OpenItem) => boolean;
  errors: Record<number, string>;
  expandedId: number | null;
  onExpand: (id: number) => void;
  onToggle: (it: OpenItem) => void;
}) {
  const remaining = group.items.filter((it) => isDone(it) !== pendingTab).length;
  const headingId = `group-${group.key}`;
  return (
    <section aria-labelledby={headingId}>
      <div className="mb-2 flex items-center gap-2.5">
        {group.speaker ? (
          <SpeakerAvatar speaker={group.speaker} size="md" />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-600" aria-hidden>
            ?
          </span>
        )}
        <h2 id={headingId} className="text-sm font-semibold">
          {group.name}
          {group.meeting && <span className="font-normal text-zinc-500"> · in {group.meeting.title}</span>}
        </h2>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
          {remaining} {pendingTab ? "open" : "done"}
        </span>
      </div>
      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {group.items.map((it) => (
          <Row
            key={it.id}
            item={it}
            done={isDone(it)}
            pendingTab={pendingTab}
            error={errors[it.id]}
            expanded={expandedId === it.id}
            onExpand={() => onExpand(it.id)}
            onToggle={() => onToggle(it)}
          />
        ))}
      </ul>
    </section>
  );
}

function Row({
  item,
  done,
  pendingTab,
  error,
  expanded,
  onExpand,
  onToggle,
}: {
  item: OpenItem;
  done: boolean;
  pendingTab: boolean;
  error?: string;
  expanded: boolean;
  onExpand: () => void;
  onToggle: () => void;
}) {
  const quoteId = `quote-${item.id}`;
  const momentHref = item.quote ? `/meetings/${item.meeting.id}?t=${item.quote.startMs}` : null;
  return (
    <li className={clsx("px-4 py-3 transition", expanded && "bg-zinc-50/70")}>
      <div className="flex items-start gap-3">
        <label className="mt-0.5 flex shrink-0 cursor-pointer">
          <input type="checkbox" checked={done} onChange={onToggle} className="size-4 cursor-pointer accent-brand-600" />
          <span className="sr-only">
            {done ? "Mark as not done" : "Mark as done"}: {item.text}
          </span>
        </label>

        <div className="min-w-0 flex-1">
          {item.quote ? (
            <button
              type="button"
              onClick={onExpand}
              aria-expanded={expanded}
              aria-controls={quoteId}
              className="group flex w-full items-start gap-1.5 text-left"
            >
              <span className={clsx("flex-1 text-sm leading-relaxed", done ? "text-zinc-400 line-through" : "text-zinc-800")}>
                {item.text}
              </span>
              <ChevronDown
                aria-hidden
                className={clsx("mt-1 size-3.5 shrink-0 text-zinc-400 transition group-hover:text-zinc-600", expanded && "rotate-180")}
              />
            </button>
          ) : (
            <p className={clsx("text-sm leading-relaxed", done ? "text-zinc-400 line-through" : "text-zinc-800")}>{item.text}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-500">
            {pendingTab && item.dueDate && !done && <DueChip dueDate={item.dueDate} phrase={item.duePhrase} />}
            {momentHref && item.quote && (
              <Link
                href={momentHref}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-600 transition hover:bg-brand-100 hover:text-brand-700"
              >
                <Play className="size-2.5 fill-current" aria-hidden />
                {formatMs(item.quote.startMs)}
                <span className="sr-only"> in {item.meeting.title}</span>
              </Link>
            )}
            <span className="min-w-0">
              <Link href={`/meetings/${item.meeting.id}`} className="font-medium text-zinc-600 hover:text-brand-700 hover:underline">
                {item.meeting.title}
              </Link>
              <span aria-hidden> · </span>
              <LocalTime date={item.meeting.startedAt} options={MEETING_DATE} />
            </span>
          </div>

          {error && (
            <p role="alert" className="mt-1.5 text-xs text-red-600">
              {error}
            </p>
          )}

          {item.quote && (
            <div id={quoteId} hidden={!expanded} className="mt-3 rounded-lg border border-zinc-200 bg-white p-3">
              <div className="mb-1.5 flex items-center gap-2 text-xs">
                {item.quote.speaker && <SpeakerAvatar speaker={item.quote.speaker} />}
                <span className="font-medium text-zinc-800">{item.quote.speaker ? speakerName(item.quote.speaker) : "Unknown speaker"}</span>
                {momentHref && (
                  <Link href={momentHref} className="tabular-nums text-zinc-500 hover:text-brand-700 hover:underline">
                    {formatMs(item.quote.startMs)}
                  </Link>
                )}
              </div>
              <blockquote className="text-sm leading-relaxed text-zinc-700">“{item.quote.text}”</blockquote>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** Overdue is judged against the viewer's own calendar day, so it's decided after mount. */
function DueChip({ dueDate, phrase }: { dueDate: string; phrase: string | null }) {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const d = new Date();
    setToday(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }, []);
  const overdue = today != null && dueDate < today;
  const label = new Date(`${dueDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <span
      title={phrase ? `“${phrase}”` : undefined}
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        overdue ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800",
      )}
    >
      <CalendarClock className="size-3" aria-hidden />
      {overdue ? `Overdue · ${label}` : `Due ${label}`}
    </span>
  );
}

function EmptyState({ pendingTab, anyDone }: { pendingTab: boolean; anyDone: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500">
      {pendingTab ? (
        <>
          <p>{anyDone ? "Nothing open. Every action item is done." : "Nothing open. No action items have come out of your meetings yet."}</p>
          <Link href="/meetings" className="mt-3 inline-block font-medium text-brand-600 hover:underline">
            Go to Meetings
          </Link>
        </>
      ) : (
        <p>Nothing completed yet. Items you tick off will show up here.</p>
      )}
    </div>
  );
}

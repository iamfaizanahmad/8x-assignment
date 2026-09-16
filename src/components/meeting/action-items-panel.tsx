"use client";

import clsx from "clsx";
import { useState } from "react";
import type { ActionItem } from "./types";
import { TimestampChip } from "./timestamp-chip";

export function ActionItemsPanel({
  items: initial,
  onSeek,
  readOnly = false,
}: {
  items: ActionItem[];
  onSeek: (ms: number) => void;
  readOnly?: boolean;
}) {
  const [items, setItems] = useState(initial);
  if (items.length === 0) return <p className="p-6 text-center text-sm text-zinc-500">No action items were detected in this meeting.</p>;

  // Group by owner so an 8-person call reads as "who owes what".
  const groups = new Map<string, ActionItem[]>();
  for (const it of items) groups.set(it.owner || "Unassigned", [...(groups.get(it.owner || "Unassigned") ?? []), it]);
  const done = items.filter((i) => i.done).length;

  async function toggle(item: ActionItem) {
    setItems((all) => all.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    const res = await fetch(`/api/action-items/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ done: !item.done }),
    });
    if (!res.ok) setItems((all) => all.map((i) => (i.id === item.id ? { ...i, done: item.done } : i)));
  }

  return (
    <div className="scroll-thin h-full space-y-6 overflow-y-auto p-5">
      <p className="text-xs text-zinc-500">
        {done} of {items.length} done · grouped by owner
      </p>
      {[...groups].map(([owner, list]) => (
        <section key={owner}>
          <h3 className="mb-2 text-sm font-semibold">
            {owner} <span className="font-normal text-zinc-400">· {list.length}</span>
          </h3>
          <ul className="space-y-1">
            {list.map((it) => (
              <li key={it.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-zinc-50">
                <input
                  type="checkbox"
                  checked={it.done}
                  disabled={readOnly}
                  onChange={() => toggle(it)}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-brand-600 disabled:cursor-default"
                />
                <span className={clsx("flex-1 text-sm leading-relaxed", it.done ? "text-zinc-400 line-through" : "text-zinc-800")}>
                  {it.text}
                </span>
                <TimestampChip ms={it.timestampMs} onSeek={onSeek} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

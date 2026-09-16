"use client";

import clsx from "clsx";
import { Bot, CalendarCheck, Info, Video } from "lucide-react";
import { useEffect, useState } from "react";

type Platform = "Zoom" | "Google Meet" | "Microsoft Teams" | null;
type Rule = "all" | "hosted" | "none";
type Event = { id: string; title: string; start: Date; minutes: number; attendees: number; platform: Platform; host: boolean; external: boolean };

// Mock upcoming schedule, built relative to "now" so the page always looks current.
function buildEvents(): Event[] {
  const base = new Date();
  base.setMinutes(0, 0, 0);
  const at = (dayOffset: number, hour: number, min = 0) => {
    const d = new Date(base);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, min);
    return d;
  };
  const raw: Omit<Event, "id">[] = [
    { title: "Engineering standup", start: at(0, 9, 30), minutes: 15, attendees: 6, platform: "Google Meet", host: false, external: false },
    { title: "Acme Corp — pricing follow-up", start: at(0, 11), minutes: 30, attendees: 4, platform: "Zoom", host: true, external: true },
    { title: "Lunch", start: at(0, 13), minutes: 60, attendees: 1, platform: null, host: true, external: false },
    { title: "1:1 with Priya", start: at(0, 15), minutes: 30, attendees: 2, platform: "Google Meet", host: true, external: false },
    { title: "Engineering standup", start: at(1, 9, 30), minutes: 15, attendees: 6, platform: "Google Meet", host: false, external: false },
    { title: "Q4 roadmap review", start: at(1, 14), minutes: 60, attendees: 8, platform: "Microsoft Teams", host: false, external: false },
    { title: "Candidate interview — Senior PM", start: at(1, 16), minutes: 45, attendees: 3, platform: "Zoom", host: true, external: true },
    { title: "Engineering standup", start: at(2, 9, 30), minutes: 15, attendees: 6, platform: "Google Meet", host: false, external: false },
    { title: "Globex discovery call", start: at(2, 12), minutes: 45, attendees: 5, platform: "Zoom", host: true, external: true },
    { title: "Design critique", start: at(2, 15, 30), minutes: 45, attendees: 7, platform: "Google Meet", host: false, external: false },
  ];
  return raw.map((e, i) => ({ ...e, id: `evt-${i}` })).filter((e) => e.start.getTime() + e.minutes * 60_000 > Date.now() - 60 * 60_000);
}

const PLATFORM_STYLE: Record<NonNullable<Platform>, string> = {
  Zoom: "bg-sky-50 text-sky-700",
  "Google Meet": "bg-emerald-50 text-emerald-700",
  "Microsoft Teams": "bg-indigo-50 text-indigo-700",
};

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function CalendarView() {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [rule, setRule] = useState<Rule>("all");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setEvents(buildEvents());
    setRule(load("cal.rule", "all"));
    setOverrides(load("cal.overrides", {}));
  }, []);

  if (!events) return <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6" />;

  const byRule = (e: Event) => !!e.platform && (rule === "all" || (rule === "hosted" && e.host));
  const joins = (e: Event) => !!e.platform && (overrides[e.id] ?? byRule(e));

  const days = new Map<string, Event[]>();
  for (const e of events) {
    const key = e.start.toDateString();
    days.set(key, [...(days.get(key) ?? []), e]);
  }
  const dayLabel = (d: Date) => {
    const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
    return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  };
  const scheduled = events.filter(joins).length;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-zinc-500">
            The notetaker will join <span className="font-medium text-zinc-800">{scheduled}</span> upcoming meeting{scheduled === 1 ? "" : "s"}.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm">
          <CalendarCheck className="size-4 text-emerald-600" /> Google Calendar connected
        </span>
      </div>

      <div className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-medium">Demo:</span> calendar sync and the meeting bot are simulated in this build. Your choices here are saved in
          this browser only. To get a real meeting in, upload its recording from the Meetings page.
        </p>
      </div>

      <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Auto-join rule</h2>
        <p className="mt-0.5 text-xs text-zinc-500">Which meetings should the notetaker record? You can override any single meeting below.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {(
            [
              ["all", "All meetings with a video link"],
              ["hosted", "Only meetings I host"],
              ["none", "None — I'll pick manually"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => {
                setRule(value);
                setOverrides({});
                save("cal.rule", value);
                save("cal.overrides", {});
              }}
              className={clsx(
                "rounded-lg border px-3 py-2 text-left text-sm transition",
                rule === value ? "border-brand-500 bg-brand-50 font-medium text-brand-700" : "border-zinc-200 hover:bg-zinc-50",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <div className="space-y-6">
        {[...days].map(([key, list]) => (
          <section key={key}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{dayLabel(new Date(key))}</h2>
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              {list.map((e) => {
                const on = joins(e);
                return (
                  <li key={e.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="w-20 shrink-0 text-xs tabular-nums text-zinc-500">
                      {e.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      <div className="text-zinc-400">{e.minutes} min</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{e.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        {e.platform ? (
                          <span className={clsx("inline-flex items-center gap-1 rounded px-1.5 py-0.5", PLATFORM_STYLE[e.platform])}>
                            <Video className="size-3" /> {e.platform}
                          </span>
                        ) : (
                          <span className="text-zinc-400">No video link</span>
                        )}
                        <span>{e.attendees} attendees</span>
                        {e.host && <span>You&apos;re hosting</span>}
                        {e.external && <span className="rounded bg-zinc-100 px-1.5 py-0.5">External</span>}
                      </div>
                    </div>
                    {e.platform ? (
                      <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-zinc-600">
                        <Bot className={clsx("size-4", on ? "text-brand-600" : "text-zinc-300")} />
                        <span className="hidden sm:inline">{on ? "Notetaker joins" : "Not recording"}</span>
                        <button
                          role="switch"
                          aria-checked={on}
                          onClick={() => {
                            const next = { ...overrides, [e.id]: !on };
                            setOverrides(next);
                            save("cal.overrides", next);
                          }}
                          className={clsx("relative h-5 w-9 rounded-full transition", on ? "bg-brand-600" : "bg-zinc-200")}
                        >
                          <span className={clsx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
                        </button>
                      </label>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

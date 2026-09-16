"use client";

import clsx from "clsx";
import { Bot, CalendarCheck, CalendarPlus, ExternalLink, FileText, Info, Loader2, Unplug, Upload, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UploadDialog } from "@/components/upload-dialog";
import type { AutoJoinRule } from "@/db/schema";
import type { CalendarEvent } from "@/lib/calendar/google";

type Notice = { tone: "ok" | "error"; text: string } | null;
type Props =
  | { mode: "demo"; notice: Notice; uploadsEnabled: boolean }
  | {
      mode: "connected";
      notice: Notice;
      uploadsEnabled: boolean;
      email: string;
      authError: boolean;
      events: CalendarEvent[];
      rule: AutoJoinRule;
      overrides: Record<string, boolean>;
      linked: Record<string, string>;
    };

const PLATFORM_STYLE: Record<NonNullable<CalendarEvent["platform"]>, string> = {
  Zoom: "bg-sky-50 text-sky-700",
  "Google Meet": "bg-emerald-50 text-emerald-700",
  "Microsoft Teams": "bg-indigo-50 text-indigo-700",
};

const RULES: [AutoJoinRule, string][] = [
  ["all", "All meetings with a video link"],
  ["hosted", "Only meetings I host"],
  ["none", "None — I'll pick manually"],
];

// Sample schedule for visitors who haven't connected a calendar; built relative to "now".
function sampleEvents(): CalendarEvent[] {
  const at = (day: number, h: number, m = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + day);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const ev = (i: number, title: string, day: number, h: number, m: number, mins: number, n: number, platform: CalendarEvent["platform"], isHost: boolean) => {
    const start = at(day, h, m);
    return {
      id: `sample-${i}`,
      title,
      start: start.toISOString(),
      end: new Date(start.getTime() + mins * 60_000).toISOString(),
      attendees: Array.from({ length: n }, (_, k) => ({ name: `Guest ${k + 1}`, email: "", self: k === 0 })),
      isHost,
      platform,
      meetingUrl: null,
      htmlLink: null,
    };
  };
  return [
    ev(0, "Engineering standup", 0, 9, 30, 15, 6, "Google Meet", false),
    ev(1, "Acme Corp — pricing follow-up", 0, 11, 0, 30, 4, "Zoom", true),
    ev(2, "Lunch", 0, 13, 0, 60, 1, null, true),
    ev(3, "1:1 with Priya", 0, 15, 0, 30, 2, "Google Meet", true),
    ev(4, "Q4 roadmap review", 1, 14, 0, 60, 8, "Microsoft Teams", false),
    ev(5, "Candidate interview — Senior PM", 1, 16, 0, 45, 3, "Zoom", true),
    ev(6, "Globex discovery call", 2, 12, 0, 45, 5, "Zoom", true),
    ev(7, "Design critique", 2, 15, 30, 45, 7, "Google Meet", false),
  ].filter((e) => new Date(e.end).getTime() > Date.now());
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function groupByDay(events: CalendarEvent[]) {
  const days = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const key = new Date(e.start).toDateString();
    days.set(key, [...(days.get(key) ?? []), e]);
  }
  return [...days.values()];
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const minutes = (e: CalendarEvent) => Math.round((new Date(e.end).getTime() - new Date(e.start).getTime()) / 60_000);

function EventMeta({ e }: { e: CalendarEvent }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
      {e.platform ? (
        <span className={clsx("inline-flex items-center gap-1 rounded px-1.5 py-0.5", PLATFORM_STYLE[e.platform])}>
          <Video className="size-3" /> {e.platform}
        </span>
      ) : (
        <span className="text-zinc-400">No video link</span>
      )}
      {e.attendees.length > 0 && <span>{e.attendees.length} attendees</span>}
      {e.isHost && <span>You&apos;re hosting</span>}
      {e.htmlLink && (
        <a href={e.htmlLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-zinc-800">
          Open <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

export function CalendarView(props: Props) {
  const router = useRouter();
  const connected = props.mode === "connected";
  const [mounted, setMounted] = useState(false);
  const [sample, setSample] = useState<CalendarEvent[]>([]);
  const [rule, setRule] = useState<AutoJoinRule>(connected ? props.rule : "all");
  const [overrides, setOverrides] = useState<Record<string, boolean>>(connected ? props.overrides : {});
  const [attachTo, setAttachTo] = useState<CalendarEvent | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!connected) setSample(sampleEvents());
    // Drop ?connected / ?error from the URL once the notice has been shown.
    if (props.notice) window.history.replaceState(null, "", "/calendar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mounted) return <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6" />;

  const now = Date.now();
  const all = connected ? props.events : sample;
  const upcoming = all.filter((e) => new Date(e.end).getTime() > now);
  const recent = connected ? all.filter((e) => new Date(e.end).getTime() <= now && e.platform).reverse() : [];

  const byRule = (e: CalendarEvent) => !!e.platform && (rule === "all" || (rule === "hosted" && e.isHost));
  const joins = (e: CalendarEvent) => !!e.platform && (overrides[e.id] ?? byRule(e));
  const scheduled = upcoming.filter(joins).length;

  async function changeRule(next: AutoJoinRule) {
    setRule(next);
    setOverrides({});
    if (connected)
      await fetch("/api/calendar/rule", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rule: next }) });
  }

  async function toggle(e: CalendarEvent) {
    const record = !joins(e);
    setOverrides((o) => ({ ...o, [e.id]: record }));
    if (connected)
      await fetch(`/api/calendar/events/${encodeURIComponent(e.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ record }),
      });
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {upcoming.length === 0
              ? "No upcoming meetings in the next two weeks."
              : (
                <>
                  The notetaker will join <span className="font-medium text-zinc-800">{scheduled}</span> of {upcoming.length} upcoming
                  meeting{upcoming.length === 1 ? "" : "s"}.
                </>
              )}
          </p>
        </div>
        {connected ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm">
              <CalendarCheck className="size-4 text-emerald-600" /> {props.email}
            </span>
            <button
              disabled={disconnecting}
              onClick={async () => {
                setDisconnecting(true);
                await fetch("/api/calendar/disconnect", { method: "POST" });
                router.refresh();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            >
              {disconnecting ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />} Disconnect
            </button>
          </div>
        ) : (
          <a
            href="/api/calendar/google/connect"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
          >
            <CalendarPlus className="size-4" /> Connect Google Calendar
          </a>
        )}
      </div>

      {props.notice && (
        <div
          className={clsx(
            "mb-4 rounded-xl p-3 text-sm",
            props.notice.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800",
          )}
        >
          {props.notice.text}
        </div>
      )}

      {connected && props.authError ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Google Calendar access expired or was revoked.{" "}
          <a href="/api/calendar/google/connect" className="font-medium underline">
            Reconnect
          </a>
        </div>
      ) : (
        <div className="mb-6 flex gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          <Info className="mt-0.5 size-4 shrink-0 text-zinc-400" />
          <p>
            {connected ? (
              <>
                Your real calendar, read-only. Video links are detected automatically. The meeting bot is simulated in this build: after a call,
                use <span className="font-medium text-zinc-800">Attach recording</span> under Recent meetings and the notes are filed against that
                event, with its title and attendees.
              </>
            ) : (
              <>
                <span className="font-medium text-zinc-800">Showing a sample schedule.</span> Connect Google Calendar to see your real meetings.
                Access is read-only and tied to this browser only.
              </>
            )}
          </p>
        </div>
      )}

      <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Auto-join rule</h2>
        <p className="mt-0.5 text-xs text-zinc-500">Which meetings should the notetaker record? You can override any single meeting below.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {RULES.map(([value, label]) => (
            <button
              key={value}
              onClick={() => changeRule(value)}
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
        {groupByDay(upcoming).map((list) => (
          <section key={list[0].start}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{dayLabel(list[0].start)}</h2>
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              {list.map((e) => {
                const on = joins(e);
                const live = new Date(e.start).getTime() <= now;
                return (
                  <li key={e.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="w-20 shrink-0 text-xs tabular-nums text-zinc-500">
                      {time(e.start)}
                      <div className="text-zinc-400">{minutes(e)} min</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{e.title}</span>
                        {live && <span className="shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">NOW</span>}
                      </div>
                      <EventMeta e={e} />
                    </div>
                    {e.platform && (
                      <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-zinc-600">
                        <Bot className={clsx("size-4", on ? "text-brand-600" : "text-zinc-300")} />
                        <span className="hidden sm:inline">{on ? "Notetaker joins" : "Not recording"}</span>
                        <button
                          role="switch"
                          aria-checked={on}
                          aria-label={`Record ${e.title}`}
                          onClick={() => toggle(e)}
                          className={clsx("relative h-5 w-9 rounded-full transition", on ? "bg-brand-600" : "bg-zinc-200")}
                        >
                          <span className={clsx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
                        </button>
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {connected && recent.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-sm font-semibold">Recent meetings</h2>
          <p className="mb-3 text-xs text-zinc-500">Calls from the last 7 days with a video link. Attach a recording to get notes filed against the event.</p>
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {recent.map((e) => {
              const meetingId = props.linked[e.id];
              return (
                <li key={e.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="w-20 shrink-0 text-xs tabular-nums text-zinc-500">
                    {dayLabel(e.start)}
                    <div className="text-zinc-400">{time(e.start)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{e.title}</div>
                    <EventMeta e={e} />
                  </div>
                  {meetingId ? (
                    <Link
                      href={`/meetings/${meetingId}`}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50"
                    >
                      <FileText className="size-4 text-brand-600" /> View notes
                    </Link>
                  ) : (
                    <button
                      onClick={() => setAttachTo(e)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50"
                    >
                      <Upload className="size-4" /> Attach recording
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {attachTo && (
        <UploadDialog
          enabled={props.uploadsEnabled}
          event={{ id: attachTo.id, title: attachTo.title }}
          onClose={() => setAttachTo(null)}
        />
      )}
    </main>
  );
}

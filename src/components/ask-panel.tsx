"use client";

import clsx from "clsx";
import { ArrowUp, Loader2, Play, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { parseTimestamp } from "@/lib/time";

const ERROR_MARKER = "<<ASK_ERROR>>";
const CITE = /\[\[(?:([A-Za-z0-9_-]{4,40})@)?(\d{1,2}:\d{2}(?::\d{2})?)\]\]/g;

type Turn = { question: string; answer: string; status: "streaming" | "done" | "error"; error?: string };

type Props =
  | { scope: "meeting"; meetingId: string; onSeek: (ms: number) => void }
  | { scope: "library"; meetings: { id: string; title: string }[]; initialQuestion?: string };

const SUGGESTIONS = {
  meeting: [
    "What was this meeting about?",
    "What did each person commit to?",
    "What decisions were made?",
    "Were any concerns or disagreements raised?",
  ],
  library: [
    "What decisions were made across my meetings?",
    "Which meetings discussed pricing?",
    "What action items are still open, and who owns them?",
    "Summarize everything discussed this week.",
  ],
};

/** Inline **bold** and [[citations]] inside one line of the answer. */
function Inline({ text, props }: { text: string; props: Props }) {
  const titles = props.scope === "library" ? new Map(props.meetings.map((m) => [m.id, m.title])) : null;
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(CITE)) {
    out.push(<Bold key={`t${last}`} text={text.slice(last, match.index)} />);
    const [, meetingId, ts] = match;
    const ms = parseTimestamp(ts) ?? 0;
    const chip = "mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 align-middle text-[11px] font-medium tabular-nums text-brand-700 hover:bg-brand-100";
    if (props.scope === "meeting") {
      out.push(
        <button key={`c${match.index}`} onClick={() => props.onSeek(ms)} className={chip} title="Play this moment">
          <Play className="size-2.5 fill-current" /> {ts}
        </button>,
      );
    } else if (meetingId && titles?.has(meetingId)) {
      const title = titles.get(meetingId)!;
      out.push(
        <Link key={`c${match.index}`} href={`/meetings/${meetingId}?t=${ms}`} className={chip} title={`${title} at ${ts}`}>
          <Play className="size-2.5 fill-current" />
          <span className="max-w-40 truncate">{title}</span>
          {ms > 0 && <span className="text-brand-500">{ts}</span>}
        </Link>,
      );
    }
    last = match.index + match[0].length;
  }
  out.push(<Bold key={`t${last}`} text={text.slice(last)} />);
  return <>{out}</>;
}

function Bold({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-zinc-900">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function Answer({ text, streaming, props }: { text: string; streaming: boolean; props: Props }) {
  // While streaming, hide a citation that's only half written ("[[12:3").
  const visible = streaming ? text.replace(/\[\[[^\]]*$/, "") : text;
  const blocks: { kind: "p" | "ul" | "ol"; lines: string[] }[] = [];
  for (const raw of visible.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const kind = /^\s*[-*•]\s+/.test(line) ? "ul" : /^\s*\d+[.)]\s+/.test(line) ? "ol" : "p";
    const content = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
    const prev = blocks.at(-1);
    if (kind !== "p" && prev?.kind === kind) prev.lines.push(content);
    else blocks.push({ kind, lines: [content] });
  }
  return (
    <div className="space-y-2 text-sm leading-relaxed text-zinc-700">
      {blocks.map((b, i) =>
        b.kind !== "p" ? (
          <ul key={i} className="space-y-1.5">
            {b.lines.map((l, j) => (
              <li key={j} className="flex gap-2">
                {b.kind === "ol" ? (
                  <span className="w-4 shrink-0 text-right tabular-nums text-zinc-400">{j + 1}.</span>
                ) : (
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-zinc-400" />
                )}
                <span>
                  <Inline text={l} props={props} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <Inline text={b.lines[0]} props={props} />
          </p>
        ),
      )}
      {streaming && <span className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-brand-500 align-middle" />}
    </div>
  );
}

export function AskPanel(props: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = turns.at(-1)?.status === "streaming";

  // Arriving from search with a question: ask it once (guarded against React's double effects in dev).
  const initial = props.scope === "library" ? props.initialQuestion : undefined;
  const askedInitial = useRef(false);
  useEffect(() => {
    if (initial && !askedInitial.current) {
      askedInitial.current = true;
      ask(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const history = turns.filter((t) => t.status === "done").slice(-3).map(({ question, answer }) => ({ question, answer }));
    setTurns((all) => [...all, { question: q, answer: "", status: "streaming" }]);
    const update = (patch: Partial<Turn>) => setTurns((all) => all.map((t, i) => (i === all.length - 1 ? { ...t, ...patch } : t)));

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, history, meetingId: props.scope === "meeting" ? props.meetingId : undefined }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        return update({ status: "error", error: data?.error ?? "Something went wrong. Try again." });
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        update({ answer: text.replace(ERROR_MARKER, "") });
      }
      if (text.includes(ERROR_MARKER)) update({ status: "error", error: "The answer was cut off. Try asking again." });
      else update({ status: "done" });
    } catch {
      update({ status: "error", error: "Couldn't reach the server. Check your connection and try again." });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        {turns.length === 0 && (
          <div>
            <div className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-900">
              <Sparkles className="size-4 text-brand-600" />
              {props.scope === "meeting" ? "Ask anything about this meeting" : "Ask anything across all your meetings"}
            </div>
            <p className="mb-4 text-sm text-zinc-500">
              Answers come from the transcripts and link to the exact moments they cite.
              {props.scope === "meeting" ? " Try asking what someone said to someone else." : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS[props.scope].map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-left text-sm text-zinc-700 hover:border-brand-500 hover:text-brand-700"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-900 px-3.5 py-2 text-sm text-white">{t.question}</p>
            </div>
            <div className="flex gap-2.5">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand-100">
                <Sparkles className="size-3.5 text-brand-600" />
              </span>
              <div className="min-w-0 flex-1">
                {t.status === "streaming" && !t.answer ? (
                  <span className="inline-flex items-center gap-2 text-sm text-zinc-500">
                    <Loader2 className="size-4 animate-spin" /> Reading the transcript…
                  </span>
                ) : (
                  <Answer text={t.answer} streaming={t.status === "streaming"} props={props} />
                )}
                {t.status === "error" && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-red-600">
                    {t.error}
                    {i === turns.length - 1 && (
                      <button
                        onClick={() => {
                          setTurns((all) => all.slice(0, -1));
                          ask(t.question);
                        }}
                        className="inline-flex items-center gap-1 font-medium underline"
                      >
                        <RotateCcw className="size-3.5" /> Retry
                      </button>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="shrink-0 border-t border-zinc-100 p-3"
      >
        <div className="flex items-end gap-2 rounded-xl border border-zinc-200 bg-white p-1.5 pl-3 focus-within:border-brand-500">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            maxLength={500}
            placeholder={props.scope === "meeting" ? "What did Sarah say about the launch date?" : "When did we decide the launch date?"}
            className="max-h-32 min-h-[2rem] flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-zinc-400"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Ask"
            className={clsx(
              "grid size-8 shrink-0 place-items-center rounded-lg text-white transition",
              busy || !input.trim() ? "bg-zinc-300" : "bg-brand-600 hover:bg-brand-700",
            )}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </div>
        {turns.length > 0 && (
          <button type="button" onClick={() => setTurns([])} disabled={busy} className="mt-1.5 px-1 text-xs text-zinc-500 hover:text-zinc-800">
            New conversation
          </button>
        )}
      </form>
    </div>
  );
}

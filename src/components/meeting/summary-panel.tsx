"use client";

import { Check, ChevronDown, Copy, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import type { SummaryContent, TemplateId } from "@/db/schema";
import { TEMPLATES, TEMPLATE_IDS } from "@/lib/pipeline/templates";
import { formatMs } from "@/lib/time";
import type { Chapter } from "./types";
import { TimestampChip } from "./timestamp-chip";

type Cached = Partial<Record<TemplateId, SummaryContent>>;

function toMarkdown(title: string, s: SummaryContent) {
  const lines = [`# ${title}`, "", s.overview, ""];
  for (const sec of s.sections) {
    lines.push(`## ${sec.heading}`);
    for (const b of sec.bullets) lines.push(`- ${b.text}${b.timestampMs != null ? ` (${formatMs(b.timestampMs)})` : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function SummaryPanel({
  meetingId,
  title,
  initial,
  chapters,
  onSeek,
  readOnly = false,
}: {
  meetingId: string;
  title: string;
  initial: Cached;
  chapters: Chapter[];
  onSeek: (ms: number) => void;
  readOnly?: boolean;
}) {
  const [template, setTemplate] = useState<TemplateId>("general");
  const [cache, setCache] = useState<Cached>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const summary = cache[template];

  async function choose(t: TemplateId) {
    setMenuOpen(false);
    setTemplate(t);
    setError(null);
    if (cache[t]) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/summaries/${t}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCache((c) => ({ ...c, [t]: data.content }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate summary");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto p-5">
      <div className="mb-5 flex items-center gap-2">
        <div className="relative">
          <button
            onClick={() => !readOnly && setMenuOpen((o) => !o)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50"
          >
            <Sparkles className="size-4 text-brand-600" />
            {TEMPLATES[template].name}
            {!readOnly && <ChevronDown className="size-4 text-zinc-400" />}
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
              {TEMPLATE_IDS.map((t) => (
                <button
                  key={t}
                  onClick={() => choose(t)}
                  className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-zinc-50"
                >
                  <span className="mt-0.5 size-4 shrink-0">{t === template && <Check className="size-4 text-brand-600" />}</span>
                  <span>
                    <span className="block text-sm font-medium">{TEMPLATES[t].name}</span>
                    <span className="block text-xs text-zinc-500">{TEMPLATES[t].description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {summary && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(toMarkdown(title, summary));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
          >
            {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl bg-brand-50 p-4 text-sm text-brand-700">
          <Loader2 className="size-4 animate-spin" /> Writing a {TEMPLATES[template].name} summary…
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {error}{" "}
          <button className="underline" onClick={() => choose(template)}>
            Retry
          </button>
        </div>
      ) : summary ? (
        <article className="space-y-6">
          <p className="text-[15px] leading-relaxed text-zinc-700">{summary.overview}</p>

          {template === "general" && chapters.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Chapters</h3>
              <ol className="space-y-1">
                {chapters.map((c, i) => (
                  <li key={i}>
                    <button
                      onClick={() => onSeek(c.startMs)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
                    >
                      <span className="w-12 shrink-0 tabular-nums text-xs text-zinc-500">{formatMs(c.startMs)}</span>
                      <span className="text-zinc-800">{c.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {summary.sections.map((sec, i) => (
            <section key={i}>
              <h3 className="mb-2 text-sm font-semibold">{sec.heading}</h3>
              <ul className="space-y-2">
                {sec.bullets.map((b, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm leading-relaxed text-zinc-700">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-zinc-400" />
                    <span className="flex-1">{b.text}</span>
                    <TimestampChip ms={b.timestampMs} onSeek={onSeek} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </article>
      ) : (
        <p className="text-sm text-zinc-500">No summary yet.</p>
      )}
    </div>
  );
}

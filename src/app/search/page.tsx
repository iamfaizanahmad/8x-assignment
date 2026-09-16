import { FileText, Search } from "lucide-react";
import Link from "next/link";
import { searchTranscripts, type SearchHit } from "@/lib/queries";
import { formatMs } from "@/lib/time";
import { LocalTime } from "@/components/local-time";

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

export const dynamic = "force-dynamic";

/** ts_headline returns plain text with <b> markers; render only those as marks so nothing else is injected. */
function Snippet({ html }: { html: string }) {
  const parts = html.split(/(<b>.*?<\/b>)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("<b>") ? (
          <mark key={i} className="rounded bg-amber-200 px-0.5 text-zinc-900">
            {p.slice(3, -4)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim();
  const { hits, titleMatches } = await searchTranscripts(q);

  const byMeeting = new Map<string, { title: string; startedAt: Date; hits: SearchHit[] }>();
  for (const h of hits) {
    const g = byMeeting.get(h.meetingId) ?? { title: h.meetingTitle, startedAt: h.startedAt, hits: [] };
    g.hits.push(h);
    byMeeting.set(h.meetingId, g);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <form action="/search" className="mb-6">
        <label className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm focus-within:border-brand-500">
          <Search className="size-5 text-zinc-400" />
          <input
            name="q"
            defaultValue={q}
            autoFocus
            placeholder='Search what was said — try "pricing" or "launch date"'
            className="w-full bg-transparent text-base outline-none placeholder:text-zinc-400"
          />
        </label>
        <p className="mt-2 px-1 text-xs text-zinc-500">
          Searches every transcript. Use quotes for exact phrases, <code>-word</code> to exclude, <code>or</code> for either.
        </p>
      </form>

      {!q ? null : hits.length === 0 && titleMatches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
          Nothing matched <span className="font-medium text-zinc-800">“{q}”</span> in any meeting.
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-zinc-500">
            {hits.length} moment{hits.length === 1 ? "" : "s"} in {byMeeting.size} meeting{byMeeting.size === 1 ? "" : "s"}
          </p>

          {titleMatches.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Meetings</h2>
              <ul className="flex flex-wrap gap-2">
                {titleMatches.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/meetings/${m.id}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:border-brand-500"
                    >
                      <FileText className="size-4 text-zinc-400" /> {m.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {[...byMeeting].map(([id, g]) => (
            <section key={id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <Link href={`/meetings/${id}`} className="flex items-baseline justify-between gap-3 border-b border-zinc-100 px-4 py-3 hover:bg-zinc-50">
                <span className="font-medium">{g.title}</span>
                <span className="shrink-0 text-xs text-zinc-500">
                  <LocalTime date={g.startedAt} options={SHORT_DATE} /> · {g.hits.length} match
                  {g.hits.length === 1 ? "" : "es"}
                </span>
              </Link>
              <ul className="divide-y divide-zinc-100">
                {g.hits
                  .sort((a, b) => a.startMs - b.startMs)
                  .map((h) => (
                    <li key={h.startMs}>
                      <Link href={`/meetings/${id}?t=${h.startMs}`} className="flex gap-4 px-4 py-3 text-sm hover:bg-brand-50/50">
                        <span className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-brand-700">{formatMs(h.startMs)}</span>
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-zinc-500">{h.speaker ?? "Unknown"}</span>
                          <span className="text-zinc-700">
                            …<Snippet html={h.snippet} />…
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

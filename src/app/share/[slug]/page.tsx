import type { Metadata } from "next";
import Link from "next/link";
import { SharedView } from "@/components/meeting/shared-view";
import { getShare } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const share = await getShare((await params).slug);
  if (!share) return { title: "Link not found — Minutes" };
  const overview = share.data.summaries.find((s) => s.template === "general")?.content.overview;
  return {
    title: `${share.link.kind === "clip" ? "Clip: " : ""}${share.data.meeting.title} — Minutes`,
    description: overview?.slice(0, 200),
  };
}

export default async function SharePage({ params }: { params: Promise<{ slug: string }> }) {
  const share = await getShare((await params).slug);
  if (!share)
    return (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">This link doesn&apos;t exist</h1>
          <p className="mt-1 text-sm text-zinc-500">It may have been removed, or the URL is incomplete.</p>
          <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">
            Go to Minutes
          </Link>
        </div>
      </main>
    );
  const { link, data } = share;
  const clip = link.kind === "clip" && link.startMs != null && link.endMs != null ? { startMs: link.startMs, endMs: link.endMs } : undefined;

  // Only send what the link grants: a clip exposes its own transcript lines and nothing else.
  const visible = clip
    ? {
        ...data,
        meeting: { ...data.meeting, chapters: [] },
        segments: data.segments.filter((s) => s.endMs > clip.startMs && s.startMs < clip.endMs),
        summaries: [],
        actionItems: [],
        highlights: [],
      }
    : { ...data, summaries: data.summaries.filter((s) => s.template === "general"), highlights: [] };

  return <SharedView data={visible} clip={clip} />;
}

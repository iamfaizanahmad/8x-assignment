import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedView } from "@/components/meeting/shared-view";
import { getShare } from "@/lib/queries";
import { formatMs } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const share = await getShare((await params).slug);
  if (!share) return { title: "Link not found — Minutes" };
  const { link, data } = share;
  if (link.kind === "clip" && link.startMs != null && link.endMs != null) {
    // A clip grants only its own moment, so link previews must not reveal the meeting summary.
    return {
      title: `Clip: ${data.meeting.title} — Minutes`,
      description: `A ${formatMs(link.endMs - link.startMs)} clip (${formatMs(link.startMs)}–${formatMs(link.endMs)}) shared from a recorded meeting.`,
    };
  }
  const overview = data.summaries.find((s) => s.template === "general")?.content.overview;
  return { title: `${data.meeting.title} — Minutes`, description: overview?.slice(0, 200) };
}

export default async function SharePage({ params }: { params: Promise<{ slug: string }> }) {
  const share = await getShare((await params).slug);
  if (!share) notFound();
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

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MeetingView } from "@/components/meeting/meeting-view";
import { getMeeting } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const data = await getMeeting((await params).id);
  return { title: data ? `${data.meeting.title} — Minutes` : "Meeting not found — Minutes" };
}

export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const [{ id }, { t }] = await Promise.all([params, searchParams]);
  const data = await getMeeting(id);
  if (!data) notFound();
  return <MeetingView data={data} initialMs={t ? Number(t) || undefined : undefined} />;
}

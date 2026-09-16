import { MeetingList } from "@/components/meeting-list";
import { UploadButton } from "@/components/upload-dialog";
import { listMeetings } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const meetings = await listMeetings();

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {meetings.length} recorded · transcripts, summaries and action items for every call
          </p>
        </div>
        <UploadButton enabled={process.env.UPLOADS_ENABLED === "true"} />
      </div>

      {meetings.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500">
          No meetings yet. Upload a recording to get started.
        </div>
      )}

      <MeetingList meetings={meetings} />
    </main>
  );
}

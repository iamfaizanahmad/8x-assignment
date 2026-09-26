import type { Metadata } from "next";
import { OpenItemsView } from "@/components/open-items/open-items-view";
import { listOpenItems } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Open items — Minutes" };

export default async function OpenItemsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = (await searchParams).status === "done" ? "done" : "pending";
  const data = await listOpenItems(status);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Open items</h1>
        <p className="mt-1 text-sm text-zinc-500">What was promised in your meetings, and who owes it</p>
      </div>
      {/* Keyed by tab so optimistic ticks from one tab don't leak into the other. */}
      <OpenItemsView key={status} data={data} />
    </main>
  );
}

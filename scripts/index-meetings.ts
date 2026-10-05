/**
 * Builds the retrieval index (chunks + Voyage embeddings) for library-wide Ask AI.
 * By default only meetings with no chunks or with chunks still missing a vector; --all rebuilds everything.
 * Waits out Voyage rate limits, so it's slow on the free tier but always finishes.
 *   npm run index [-- --all]
 */
import { eq, sql } from "drizzle-orm";
import { db, meetings } from "../src/db";
import { indexMeeting } from "../src/lib/rag";

async function main() {
  const all = process.argv.includes("--all");
  const rows = await db
    .select({ id: meetings.id, title: meetings.title })
    .from(meetings)
    .where(
      all
        ? eq(meetings.status, "ready")
        : sql`${meetings.status} = 'ready' and (
            not exists (select 1 from transcript_chunks c where c.meeting_id = ${meetings.id})
            or exists (select 1 from transcript_chunks c where c.meeting_id = ${meetings.id} and c.embedding is null))`,
    );
  if (rows.length === 0) return console.log("Every meeting is indexed.");

  for (const m of rows) {
    const started = Date.now();
    const { chunks, embedded } = await indexMeeting(m.id);
    console.log(`${m.title}: ${embedded}/${chunks} chunks embedded (${Math.round((Date.now() - started) / 1000)}s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

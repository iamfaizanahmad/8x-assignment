/**
 * Import a local recording without a browser: multipart upload to S3, run the normal pipeline, then pre-generate
 * every summary template so viewers never wait on (or pay for) a live Claude call.
 *
 *   npm run import -- <file> [--title "Weekly sync"] [--date 2026-09-15T15:00]
 */
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { eq } from "drizzle-orm";
import { createReadStream, statSync } from "fs";
import { nanoid } from "nanoid";
import { basename, extname } from "path";
import { db, meetings } from "../src/db";
import { MAX_UPLOAD_BYTES } from "../src/lib/limits";
import { getOrCreateSummary, processMeeting } from "../src/lib/pipeline";
import { TEMPLATE_IDS } from "../src/lib/pipeline/templates";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/x-m4a",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("Usage: scripts/import-recording.ts <file> [--title T] [--date ISO]");
  const ext = extname(file).toLowerCase();
  const contentType = MIME[ext];
  if (!contentType) throw new Error(`Unsupported file type ${ext}`);
  const { size } = statSync(file);
  if (size > MAX_UPLOAD_BYTES) throw new Error(`File is ${(size / 2 ** 30).toFixed(2)} GB; Deepgram accepts up to 2 GB. Compress it first.`);

  const id = nanoid(10);
  const mediaKey = `meetings/${id}/recording${ext}`;
  const title = arg("title") ?? basename(file, ext).replace(/[_-]+/g, " ").trim();
  const startedAt = arg("date") ? new Date(arg("date")!) : new Date();

  console.log(`Uploading ${basename(file)} (${(size / 2 ** 20).toFixed(0)} MB) as ${id}…`);
  const upload = new Upload({
    client: new S3Client({ region: process.env.AWS_REGION }),
    params: { Bucket: process.env.S3_BUCKET!, Key: mediaKey, Body: createReadStream(file), ContentType: contentType },
    partSize: 16 * 2 ** 20,
    queueSize: 4,
  });
  let lastPct = -10;
  upload.on("httpUploadProgress", (p) => {
    const pct = Math.floor(((p.loaded ?? 0) / size) * 100);
    if (pct >= lastPct + 10) console.log(`  ${(lastPct = pct)}%`);
  });
  await upload.done();

  await db.insert(meetings).values({ id, title, mediaKey, mediaType: contentType, source: "upload", startedAt });
  console.log("Transcribing and summarizing…");
  const t0 = Date.now();
  await processMeeting(id);
  const [m] = await db.select().from(meetings).where(eq(meetings.id, id));
  console.log(`  ready in ${Math.round((Date.now() - t0) / 1000)}s: "${m.title}", ${Math.round(m.durationS / 60)} min, ${m.chapters.length} chapters`);

  for (const t of TEMPLATE_IDS) {
    process.stdout.write(`  template ${t}… `);
    await getOrCreateSummary(id, t);
    console.log("done");
  }
  console.log(`\nDone: /meetings/${id}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

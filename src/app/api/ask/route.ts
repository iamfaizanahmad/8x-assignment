import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { askLog, db } from "@/db";
import { ASK_ERROR_MARKER, askCacheKey, libraryContext, meetingContext, streamAnswer } from "@/lib/ask";
import { ASK_MAX_QUESTION_CHARS, ASK_PER_HOUR_GLOBAL, ASK_PER_HOUR_PER_VISITOR } from "@/lib/limits";
import { visitorHash } from "@/lib/visitor";

export const maxDuration = 60;

const body = z.object({
  question: z.string().trim().min(2, "Ask a question").max(ASK_MAX_QUESTION_CHARS, "That question is too long"),
  meetingId: z.string().max(64).optional(),
  history: z
    .array(z.object({ question: z.string().max(ASK_MAX_QUESTION_CHARS), answer: z.string().max(8000) }))
    .max(3)
    .default([]),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid question" }, { status: 400 });
  const { question, meetingId, history } = parsed.data;

  const scope = meetingId ? "meeting" : "library";
  const context = meetingId ? await meetingContext(meetingId) : await libraryContext();
  if (!context)
    return NextResponse.json(
      { error: meetingId ? "This meeting has no transcript to ask about yet." : "There are no processed meetings to ask about yet." },
      { status: 409 },
    );

  const visitor = visitorHash(req);
  const cacheKey = askCacheKey(`${scope}:${meetingId ?? ""}`, context, question, history);

  // Same question over unchanged material: replay the stored answer for free.
  const [cached] = await db
    .select({ answer: askLog.answer })
    .from(askLog)
    .where(and(eq(askLog.cacheKey, cacheKey), isNotNull(askLog.answer)))
    .orderBy(desc(askLog.createdAt))
    .limit(1);
  if (cached?.answer)
    return new Response(cached.answer, { headers: { "content-type": "text/plain; charset=utf-8", "x-answer-cache": "hit" } });

  const lastHour = gt(askLog.createdAt, sql`now() - interval '1 hour'`);
  const [[{ mine }], [{ total }]] = await Promise.all([
    db.select({ mine: sql<number>`count(*)::int` }).from(askLog).where(and(lastHour, eq(askLog.visitorHash, visitor))),
    db.select({ total: sql<number>`count(*)::int` }).from(askLog).where(lastHour),
  ]);
  if (mine >= ASK_PER_HOUR_PER_VISITOR)
    return NextResponse.json({ error: `You've asked ${ASK_PER_HOUR_PER_VISITOR} questions this hour. Try again later.` }, { status: 429 });
  if (total >= ASK_PER_HOUR_GLOBAL)
    return NextResponse.json({ error: "The demo's hourly question limit is reached. Try again later." }, { status: 429 });

  const [log] = await db.insert(askLog).values({ visitorHash: visitor, meetingId, cacheKey, question }).returning({ id: askLog.id });
  const stream = streamAnswer({ scope, context, question, history });
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        let answer = "";
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              answer += event.delta.text;
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          const final = await stream.finalMessage();
          await db
            .update(askLog)
            .set({
              // Only complete answers are reused; a truncated one would be replayed forever.
              answer: final.stop_reason === "end_turn" ? answer : null,
              inputTokens: final.usage.input_tokens + (final.usage.cache_creation_input_tokens ?? 0),
              cachedInputTokens: final.usage.cache_read_input_tokens ?? 0,
              outputTokens: final.usage.output_tokens,
            })
            .where(eq(askLog.id, log.id));
        } catch (err) {
          console.error("[ask]", err);
          controller.enqueue(encoder.encode(ASK_ERROR_MARKER));
        } finally {
          controller.close();
        }
      },
      cancel() {
        stream.abort();
      },
    }),
    { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-answer-cache": "miss" } },
  );
}

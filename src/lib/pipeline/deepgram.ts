import "server-only";

export type RawSegment = { speaker: number; startMs: number; endMs: number; text: string };
export type Transcription = { durationS: number; segments: RawSegment[] };

type DeepgramUtterance = { start: number; end: number; speaker?: number; transcript: string };

/** Merge back-to-back utterances from the same speaker so the transcript reads in turns, not fragments. */
function mergeUtterances(utterances: DeepgramUtterance[]): RawSegment[] {
  const out: RawSegment[] = [];
  for (const u of utterances) {
    const text = u.transcript.trim();
    if (!text) continue;
    const seg = { speaker: u.speaker ?? 0, startMs: Math.round(u.start * 1000), endMs: Math.round(u.end * 1000), text };
    const prev = out.at(-1);
    if (prev && prev.speaker === seg.speaker && seg.startMs - prev.endMs < 1500 && seg.endMs - prev.startMs < 45_000) {
      prev.endMs = seg.endMs;
      prev.text += " " + seg.text;
    } else {
      out.push(seg);
    }
  }
  return out;
}

export async function transcribeUrl(url: string): Promise<Transcription> {
  const params = new URLSearchParams({
    model: "nova-3",
    diarize: "true",
    utterances: "true",
    smart_format: "true",
    punctuate: "true",
    utt_split: "0.8",
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const utterances: DeepgramUtterance[] = json.results?.utterances ?? [];
  return { durationS: Math.round(json.metadata?.duration ?? 0), segments: mergeUtterances(utterances) };
}

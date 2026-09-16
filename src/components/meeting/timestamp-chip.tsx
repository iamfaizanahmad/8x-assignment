import { Play } from "lucide-react";
import { formatMs } from "@/lib/time";

export function TimestampChip({ ms, onSeek }: { ms?: number | null; onSeek: (ms: number) => void }) {
  if (ms == null) return null;
  return (
    <button
      onClick={() => onSeek(ms)}
      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-600 transition hover:bg-brand-100 hover:text-brand-700"
    >
      <Play className="size-2.5 fill-current" />
      {formatMs(ms)}
    </button>
  );
}

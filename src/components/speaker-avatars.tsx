import clsx from "clsx";
import { initials, speakerColor, speakerName } from "@/lib/ui";

type S = { id: number; label: string; displayName: string | null };

export function speakerIndex(s: { label: string }) {
  const n = Number(s.label.replace(/\D/g, ""));
  return Number.isFinite(n) && n > 0 ? n - 1 : 0;
}

export function SpeakerAvatar({ speaker, size = "sm" }: { speaker: S; size?: "sm" | "md" }) {
  return (
    <span
      title={speakerName(speaker)}
      className={clsx(
        "grid shrink-0 place-items-center rounded-full font-medium text-white ring-2 ring-white",
        speakerColor(speakerIndex(speaker)).bg,
        size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs",
      )}
    >
      {initials(speakerName(speaker))}
    </span>
  );
}

export function SpeakerAvatars({ speakers, max = 4 }: { speakers: S[]; max?: number }) {
  const shown = speakers.slice(0, max);
  const extra = speakers.length - shown.length;
  return (
    <div className="flex -space-x-1.5">
      {shown.map((s) => (
        <SpeakerAvatar key={s.id} speaker={s} />
      ))}
      {extra > 0 && (
        <span className="grid size-6 place-items-center rounded-full bg-zinc-200 text-[10px] font-medium text-zinc-600 ring-2 ring-white">
          +{extra}
        </span>
      )}
    </div>
  );
}

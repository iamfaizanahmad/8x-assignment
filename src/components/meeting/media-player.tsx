"use client";

import { AudioLines, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Player } from "./use-player";

export function MediaPlayer({
  player,
  src,
  mediaType,
  title,
}: {
  player: Player;
  src: string | null;
  mediaType: string | null;
  title: string;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const isVideo = mediaType?.startsWith("video/");

  if (!src)
    return (
      <div className="grid aspect-video place-items-center rounded-xl bg-zinc-900 text-sm text-zinc-400">
        No recording
      </div>
    );

  // Signed URLs expire after a few hours; a refresh re-signs them.
  const onError = () => setFailed(true);

  return (
    <div className="overflow-hidden rounded-xl bg-zinc-950 shadow-sm">
      {failed ? (
        <div className="grid aspect-video place-items-center text-sm text-zinc-300">
          <button
            onClick={() => {
              setFailed(false);
              router.refresh();
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20"
          >
            <RefreshCw className="size-4" /> Recording link expired — reload
          </button>
        </div>
      ) : isVideo ? (
        <video
          ref={player.mediaRef}
          src={src}
          controls
          playsInline
          preload="metadata"
          onError={onError}
          className="aspect-video w-full bg-black"
        />
      ) : (
        <div className="flex aspect-video flex-col justify-between bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-900 p-5 text-white">
          <div className="flex items-center gap-2 text-sm text-white/80">
            <AudioLines className="size-4" /> Audio recording
          </div>
          <div
            className="flex h-16 items-end justify-center gap-[3px]"
            aria-hidden
          >
            {Array.from({ length: 48 }, (_, i) => (
              <span
                key={i}
                className="w-1 rounded-full bg-white/60 transition-all"
                style={{
                  height: `${20 + 70 * Math.abs(Math.sin(i * 1.7 + (player.playing ? player.currentMs / 180 : 0)))}%`,
                }}
              />
            ))}
          </div>
          <div>
            <p className="mb-2 truncate text-sm font-medium">{title}</p>
            <audio
              ref={player.mediaRef}
              src={src}
              controls
              preload="metadata"
              onError={onError}
              className="w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}

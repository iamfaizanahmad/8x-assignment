"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Player = ReturnType<typeof usePlayer>;

/** Shared playback state: one <video>/<audio> element, a smooth playhead, and seek(). */
export function usePlayer(opts: { clip?: { startMs: number; endMs: number }; initialMs?: number } = {}) {
  // The element can be replaced (e.g. remounted after an expired signed URL is refreshed), so track it as state
  // and re-attach listeners whenever it changes.
  const [el, setEl] = useState<HTMLMediaElement | null>(null);
  const elRef = useRef<HTMLMediaElement | null>(null);
  const mediaRef = useCallback((node: HTMLMediaElement | null) => {
    elRef.current = node;
    setEl(node);
  }, []);
  const [currentMs, setCurrentMsState] = useState(opts.clip?.startMs ?? opts.initialMs ?? 0);
  const lastMs = useRef<number | null>(null);
  const setCurrentMs = useCallback((ms: number) => {
    lastMs.current = ms;
    setCurrentMsState(ms);
  }, []);
  const [playing, setPlaying] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const { clip } = opts;

  useEffect(() => {
    if (!el) return;
    let raf = 0;
    const tick = () => {
      const ms = el.currentTime * 1000;
      if (clip && ms >= clip.endMs) {
        el.pause();
        el.currentTime = clip.endMs / 1000;
      }
      setCurrentMs(ms);
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      if (clip && (el.currentTime * 1000 >= clip.endMs - 200 || el.currentTime * 1000 < clip.startMs))
        el.currentTime = clip.startMs / 1000;
      setPlaying(true);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      setCurrentMs(el.currentTime * 1000);
    };
    const onSeeked = () => setCurrentMs(el.currentTime * 1000);
    const onMeta = () => {
      setDurationMs(el.duration * 1000);
      // First load starts at the clip / deep link; a replaced element resumes where playback was.
      const start = lastMs.current ?? clip?.startMs ?? opts.initialMs;
      if (start) el.currentTime = start / 1000;
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("loadedmetadata", onMeta);
    if (el.readyState >= 1) onMeta();
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("loadedmetadata", onMeta);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, clip?.startMs, clip?.endMs]);

  const seek = useCallback(
    (ms: number, play = true) => {
      const media = elRef.current;
      if (!media) return;
      media.currentTime = Math.max(0, ms) / 1000;
      setCurrentMs(ms);
      if (play) media.play().catch(() => {});
    },
    [setCurrentMs],
  );

  const toggle = useCallback(() => {
    const media = elRef.current;
    if (!media) return;
    if (media.paused) media.play().catch(() => {});
    else media.pause();
  }, []);

  return { mediaRef, currentMs, playing, durationMs, seek, toggle };
}

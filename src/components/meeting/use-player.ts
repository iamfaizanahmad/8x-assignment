"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Player = ReturnType<typeof usePlayer>;

/** Shared playback state: one <video>/<audio> element, a smooth playhead, and seek(). */
export function usePlayer(opts: { clip?: { startMs: number; endMs: number }; initialMs?: number } = {}) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [currentMs, setCurrentMs] = useState(opts.clip?.startMs ?? opts.initialMs ?? 0);
  const [playing, setPlaying] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const { clip } = opts;

  useEffect(() => {
    const el = mediaRef.current;
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
      const start = clip?.startMs ?? opts.initialMs;
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
  }, [clip?.startMs, clip?.endMs]);

  const seek = useCallback((ms: number, play = true) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, ms) / 1000;
    setCurrentMs(ms);
    if (play) el.play().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);

  return { mediaRef, currentMs, playing, durationMs, seek, toggle };
}

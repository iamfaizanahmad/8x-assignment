/** 83000 -> "1:23", 3723000 -> "1:02:03" */
export function formatMs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "1:23" / "01:02:03" -> ms. Returns undefined for anything unparseable. */
export function parseTimestamp(ts: string | undefined | null): number | undefined {
  if (!ts) return undefined;
  const parts = ts.trim().replace(/^\[|\]$/g, "").split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return undefined;
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
}

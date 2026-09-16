const PALETTE = [
  "bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-teal-500", "bg-fuchsia-500", "bg-orange-500",
  "bg-indigo-500", "bg-lime-600",
];
const TEXT = [
  "text-violet-700", "text-sky-700", "text-emerald-700", "text-amber-700",
  "text-rose-700", "text-teal-700", "text-fuchsia-700", "text-orange-700",
  "text-indigo-700", "text-lime-700",
];

export function speakerColor(index: number) {
  return { bg: PALETTE[index % PALETTE.length], text: TEXT[index % TEXT.length] };
}

export function initials(name: string) {
  const parts = name.replace(/^Speaker\s+/i, "S").split(/\s+/).filter(Boolean);
  return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

export function speakerName(s: { label: string; displayName: string | null }) {
  return s.displayName || s.label;
}

export function formatDuration(s: number) {
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m} min`;
}

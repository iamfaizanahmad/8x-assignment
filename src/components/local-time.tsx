"use client";

import { useEffect, useState } from "react";

/** Formats in the viewer's timezone. Server (UTC on Vercel) renders nothing to avoid a wrong-time flash. */
export function LocalTime({ date, options }: { date: Date | string; options: Intl.DateTimeFormatOptions }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(new Date(date).toLocaleString("en-US", options)), [date, options]);
  return <span suppressHydrationWarning>{text ?? " "}</span>;
}

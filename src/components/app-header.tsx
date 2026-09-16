"use client";

import clsx from "clsx";
import { AudioLines, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const NAV = [
  { href: "/", label: "Meetings" },
  { href: "/calendar", label: "Calendar" },
];

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  if (pathname.startsWith("/share/")) return null;

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-brand-600 text-white">
            <AudioLines className="size-4" />
          </span>
          <span className="hidden sm:inline">Minutes</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" || pathname.startsWith("/meetings") : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={clsx(
                  "rounded-md px-2.5 py-1.5 transition",
                  active ? "bg-zinc-100 font-medium text-zinc-900" : "text-zinc-500 hover:text-zinc-900",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <form
          className="ml-auto w-full max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
        >
          <label className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm focus-within:border-brand-500 focus-within:bg-white">
            <Search className="size-4 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search all meetings"
              className="w-full bg-transparent outline-none placeholder:text-zinc-400"
            />
          </label>
        </form>
      </div>
    </header>
  );
}

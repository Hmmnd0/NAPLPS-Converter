"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Converter" },
  { href: "/text-placer", label: "Text Placer" },
  { href: "/naplps-viewer", label: "Viewer" },
  { href: "/optimizer", label: "Optimizer" },
];

// Shared top navigation. `tone="dark"` is used by the Author canvas editor so the
// bar reads against its darker workspace; everything else uses the light tone.
export default function AppHeader({ tone = "light" }: { tone?: "light" | "dark" }) {
  const pathname = usePathname();
  const dark = tone === "dark";

  return (
    <header
      className={`sticky top-0 z-20 backdrop-blur ${
        dark ? "bg-zinc-900/80 border-zinc-800" : "bg-white/80 border-zinc-200"
      } border-b`}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span
            className={`grid place-items-center w-7 h-7 rounded-lg text-xs font-bold ${
              dark ? "bg-indigo-500 text-white" : "bg-zinc-900 text-white"
            }`}
          >
            NL
          </span>
          <span className={`font-semibold tracking-tight ${dark ? "text-white" : "text-zinc-900"}`}>
            NAPLPS Studio
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? dark
                      ? "bg-zinc-800 text-white"
                      : "bg-zinc-100 text-zinc-900"
                    : dark
                      ? "text-zinc-400 hover:text-white hover:bg-zinc-800"
                      : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

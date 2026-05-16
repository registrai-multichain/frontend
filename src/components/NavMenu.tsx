"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Item {
  label: string;
  href: string;
  external?: boolean;
}

const ITEMS: Item[] = [
  { label: "become agent", href: "/agents/create" },
  { label: "profile", href: "/profile" },
  { label: "docs", href: "/docs" },
  { label: "devlog", href: "/devlog" },
  { label: "about", href: "/about" },
  { label: "github ↗", href: "https://github.com/registrai-multichain", external: true },
];

export function NavMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1 text-[12px] tracking-wide text-fg-mute hover:text-fg transition-colors"
      >
        more
        <span
          className={`text-[8px] transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 min-w-[160px] border border-line bg-bg-elev/95 backdrop-blur-md z-20"
        >
          {ITEMS.map((it) =>
            it.external ? (
              <a
                key={it.href}
                href={it.href}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-[12px] tracking-wide text-fg-mute hover:text-accent hover:bg-bg/60 transition-colors border-b border-line/60 last:border-0"
              >
                {it.label}
              </a>
            ) : (
              <Link
                key={it.href}
                href={it.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-[12px] tracking-wide text-fg-mute hover:text-accent hover:bg-bg/60 transition-colors border-b border-line/60 last:border-0"
              >
                {it.label}
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  );
}

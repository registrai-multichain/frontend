"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Item {
  label: string;
  href: string;
  external?: boolean;
  /** "go"-section items show on mobile only (desktop has them in top nav). */
  mobileOnly?: boolean;
}

interface MenuSection {
  label: string;
  items: Item[];
}

const SECTIONS: MenuSection[] = [
  {
    label: "go",
    items: [
      { label: "markets", href: "/markets", mobileOnly: true },
      { label: "agents", href: "/agents", mobileOnly: true },
      { label: "vault", href: "/vault", mobileOnly: true },
      { label: "lending", href: "/lending", mobileOnly: true },
      { label: "borrow", href: "/borrow", mobileOnly: true },
    ],
  },
  {
    label: "do",
    items: [
      { label: "create market", href: "/markets/create" },
      { label: "become agent", href: "/agents/create" },
    ],
  },
  {
    label: "read",
    items: [
      { label: "docs", href: "/docs" },
      { label: "devlog", href: "/devlog" },
      { label: "about", href: "/about" },
      { label: "profile", href: "/profile" },
      { label: "github ↗", href: "https://github.com/registrai-multichain", external: true },
    ],
  },
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
          className="absolute right-0 top-full mt-2 min-w-[200px] border border-line bg-bg-elev z-20 shadow-2xl"
        >
          {SECTIONS.map((section, i) => {
            const allMobileOnly = section.items.every((it) => it.mobileOnly);
            return (
              <div key={section.label} className={allMobileOnly ? "sm:hidden" : ""}>
                {i > 0 && <div className="border-t border-line/60" />}
                <div className="px-4 pt-3 pb-1.5 caption text-fg-dim text-[10px]">
                  {section.label}
                </div>
                {section.items.map((it) =>
                  it.external ? (
                    <a
                      key={it.href}
                      href={it.href}
                      target="_blank"
                      rel="noreferrer"
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className={`block px-4 py-2 text-[12.5px] tracking-wide text-fg-mute hover:text-accent hover:bg-bg/60 transition-colors ${
                        it.mobileOnly ? "sm:hidden" : ""
                      }`}
                    >
                      {it.label}
                    </a>
                  ) : (
                    <Link
                      key={it.href}
                      href={it.href}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className={`block px-4 py-2 text-[12.5px] tracking-wide text-fg-mute hover:text-accent hover:bg-bg/60 transition-colors ${
                        it.mobileOnly ? "sm:hidden" : ""
                      }`}
                    >
                      {it.label}
                    </Link>
                  ),
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

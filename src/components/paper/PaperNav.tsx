"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; /** other paths that light this item up */ also?: string[] };

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** The paper top nav. `bar`: inline in the top bar (desktop); `row`: the scrolling row under it (phone). */
export function PaperNav({ items, variant }: { items: NavItem[]; variant: "bar" | "row" }) {
  const path = norm(usePathname() ?? "/");
  return (
    <nav className={variant === "bar" ? "pa-nav" : "pa-nav pa-nav-row"} aria-label="Sections">
      {items.map((it) => {
        const active = [it.href, ...(it.also ?? [])].some((h) => norm(h) === path);
        return (
          <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

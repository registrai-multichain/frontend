"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * View switcher for the Perennial surface. The atlas is not a separate product
 * — it is the same markets seen geographically and by season — so it is reached
 * the same way any other view is, not through a different door.
 */
const VIEWS = [
  { href: "/perennial", label: "markets" },
  { href: "/atlas", label: "atlas" },
] as const;

export function PerennialViews() {
  const path = usePathname();
  return (
    <nav className="pv-switch" aria-label="Perennial views">
      {VIEWS.map((v) => {
        const active = path === v.href || path === `${v.href}/`;
        return (
          <Link
            key={v.href}
            href={v.href}
            className="pv-switch-item"
            data-active={active ? "true" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {v.label}
          </Link>
        );
      })}
    </nav>
  );
}

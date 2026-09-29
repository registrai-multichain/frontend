import type { NavItem } from "@/components/paper/PaperNav";

/** The app's own navigation. The transparency dashboard is a separate site and is not in it. */
export const APP_NAV: NavItem[] = [
  // Markets are frozen (src/lib/freeze.ts): /rounds/ is withdraw-and-claim only.
  { href: "/rounds/", label: "Withdraw" },
  { href: "/perennial/builders/", label: "Builders" },
  { href: "/atlas/", label: "Atlas" },
];

export const DASHBOARD_URL = "https://dashboard.registrai.cc/";
export const APP_URL = "https://app.registrai.cc/";
export const HOME_URL = "https://registrai.cc/";

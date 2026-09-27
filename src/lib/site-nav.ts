import type { NavItem } from "@/components/paper/PaperNav";

/** The app's own navigation. The transparency dashboard is a separate site and is not in it. */
export const APP_NAV: NavItem[] = [
  { href: "/perennial/", label: "Markets", also: ["/perennial/wonder/"] },
  { href: "/rounds/", label: "Rounds" },
  { href: "/propose/", label: "Propose", also: ["/propose/status/"] },
  { href: "/perennial/builders/", label: "Builders" },
  { href: "/atlas/", label: "Atlas" },
  { href: "/perennial/economy/", label: "How it works" },
];

export const DASHBOARD_URL = "https://dashboard.registrai.cc/";
export const APP_URL = "https://app.registrai.cc/";
export const HOME_URL = "https://registrai.cc/";

/** The 7-day attributed share (spec docs/superpowers/specs/2026-10-22-methodology-page-design.md §2): app USD ÷ estimated
 *  USDC moved on Arc, summed over the newest 7 usable daily snapshots, with each day's own share as the range. */
import type { ArcNumbers } from "./arc-numbers";

export type Share7d = { window_days: number; until: string; pct: number; daily_min: number; daily_max: number; complete: boolean };
const WINDOW = 7;
const round2 = (x: number) => Math.round(x * 100) / 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function share7d(days: ArcNumbers[]): Share7d | null {
  const use = days.filter((d) => finite(d?.activity_24h?.app_usd) && finite(d?.activity_24h?.usdc_moved_usd_est) && d.activity_24h.usdc_moved_usd_est! > 0).slice(0, WINDOW);
  if (!use.length) return null;
  const app = use.reduce((s, d) => s + d.activity_24h.app_usd!, 0), moved = use.reduce((s, d) => s + d.activity_24h.usdc_moved_usd_est!, 0);
  const daily = use.map((d) => (100 * d.activity_24h.app_usd!) / d.activity_24h.usdc_moved_usd_est!);
  return { window_days: use.length, until: use[0].activity_24h.data_until ?? use[0].generated_at, pct: round2((100 * app) / moved),
    daily_min: round2(Math.min(...daily)), daily_max: round2(Math.max(...daily)), complete: use.length === WINDOW };
}

export const shareLabel = (s: Share7d) => (s.complete ? "7 days" : s.window_days === 1 ? "24 h" : `last ${s.window_days} days`);
export function shareText(s: Share7d | null): string {
  if (!s) return "Not available right now";
  const range = s.window_days > 1 ? ` (daily ${s.daily_min.toFixed(2)}–${s.daily_max.toFixed(2)}%)` : "";
  return `${s.pct.toFixed(2)}% over ${shareLabel(s)} to ${day(s.until)}${range}`;
}

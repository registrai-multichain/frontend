/** Data API v1: the rows one index file contributes (spec 2026-10-14-data-api-v1-design.md, "How the data gets in"). Pure. */
import type { AbiData } from "../../src/lib/builders-index";

export type IndexId = "abi" | "aii" | "aei";
export const INDEX_IDS: IndexId[] = ["abi", "aii", "aei"];
export type IndexHourRow = { index: IndexId; hour: number; close: number };
export type MemberHourRow = { index: IndexId; id: string; hour: number; points: number; points_earned: number; payments: number; wallets: number; new_payers: number; usdc: number };

const HOUR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/;
/** unix/3600 of an exact ISO hour (`YYYY-MM-DDTHH:00:00Z`); null for anything else. */
export function hourOf(iso: string): number | null {
  if (!HOUR_RE.test(iso)) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t / 3600e3 : null;
}
export const isoHour = (h: number) => new Date(h * 3600e3).toISOString().replace(".000Z", "Z");

/** Index closes from candles. A candle is stamped at its hour's start; its close is the close of hour start+1h. */
export function indexHourRows(index: IndexId, d: AbiData, sinceHour = -Infinity): IndexHourRow[] {
  const out: IndexHourRow[] = [];
  for (const c of d.candles ?? []) {
    const start = hourOf(c[0]);
    if (start === null || start + 1 < sinceHour) continue;
    out.push({ index, hour: start + 1, close: c[4] });
  }
  return out;
}

/** Member rows for the file's closed hour: stock from live.P, activity from the events of that hour (stamped at its start). */
export function memberHourRows(index: IndexId, d: AbiData): MemberHourRow[] {
  const hour = hourOf(d.data_until);
  const P = d.live?.P;
  if (hour === null || !P) return [];
  const startIso = isoHour(hour - 1);
  const act = new Map(d.events.filter((e) => e.kind === "activity" && e.t === startIso).map((e) => [e.source, e]));
  return d.projects
    .filter((p) => typeof P[p.source] === "number" && Number.isFinite(P[p.source]))
    .map((p) => {
      const e = act.get(p.source);
      return { index, id: p.source, hour, points: P[p.source], points_earned: e?.points ?? 0, payments: e?.payments ?? 0, wallets: e?.wallets ?? 0, new_payers: e?.new_payers ?? 0, usdc: e?.usdc ?? 0 };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

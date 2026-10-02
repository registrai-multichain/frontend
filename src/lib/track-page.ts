import type { StoredItem } from "./track";

export type TrackStats = { published30: number; retracted30: number; medianSeconds30: number | null };
export type TrackState =
  | { kind: "loading" }
  | { kind: "error" }
  /** updatedAt: when the radar last published (null: never, so `watching` means nothing yet). */
  | { kind: "ready"; watching: number; updatedAt: string | null; stats: TrackStats; items: StoredItem[] };

const obj = (x: unknown): Record<string, unknown> | null => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const time = (x: unknown): string | null => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}T/.test(x) && Number.isFinite(Date.parse(x)) ? x : null);

export const trackPath = "/api/track";

export function trackState(res: { status: number; body: unknown } | null): TrackState {
  if (!res) return { kind: "loading" };
  if (res.status !== 200) return { kind: "error" };
  const b = obj(res.body);
  const s = obj(b?.stats);
  if (!b || !s || !num(b.watching) || !Array.isArray(b.items)) return { kind: "error" };
  if (!num(s.published30) || !num(s.retracted30) || !(s.medianSeconds30 === null || num(s.medianSeconds30))) return { kind: "error" };
  const items = b.items.filter((i): i is StoredItem => {
    const o = obj(i);
    return !!o && typeof o.id === "string" && typeof o.source === "string" && typeof o.text === "string" && Array.isArray(o.evidence) && typeof o.alertTime === "string";
  });
  return { kind: "ready", watching: b.watching, updatedAt: time(b.updatedAt), stats: { published30: s.published30, retracted30: s.retracted30, medianSeconds30: s.medianSeconds30 as number | null }, items };
}

export function formatMedian(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export const filterBySource = (items: StoredItem[], source: string | null): StoredItem[] => (source ? items.filter((i) => i.source === source) : items);

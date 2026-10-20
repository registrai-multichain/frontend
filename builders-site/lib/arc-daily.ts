/** Arc in numbers: one snapshot per UTC day in D1 (written after the 00:00 AEI close), read newest first. */
import { collectArcNumbers, type ArcNumbers } from "./arc-numbers";
import type { D1Database, Env } from "./env";

export function clampDays(v: string | null): number {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(365, Math.max(1, Math.trunc(n))) : 30;
}

export async function storeArcDaily(db: D1Database, day: string, n: ArcNumbers): Promise<void> {
  await db.prepare("INSERT INTO arc_daily (day, json, created_at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET json = excluded.json, created_at = excluded.created_at")
    .bind(day, JSON.stringify(n), Math.floor(Date.now() / 1000)).run();
}

export async function readArcDaily(db: D1Database, days: number): Promise<ArcNumbers[]> {
  const r = await db.prepare("SELECT json FROM arc_daily ORDER BY day DESC LIMIT ?").bind(days).all<{ json: string }>();
  return r.results.map((x) => JSON.parse(x.json) as ArcNumbers);
}

/** Best effort: never throws (it runs inside the index publish). `day` = the UTC date of the 00:00 close. */
export async function snapshotArcDaily(env: Env, day: string, fetcher?: typeof fetch): Promise<void> {
  try {
    if (!env.DATA_DB) return;
    await storeArcDaily(env.DATA_DB, day, await collectArcNumbers(env, fetcher));
  } catch (err) {
    console.warn("arc daily snapshot failed", err instanceof Error ? err.message : err);
  }
}

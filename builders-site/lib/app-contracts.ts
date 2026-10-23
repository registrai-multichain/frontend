/**
 * Each app's contracts, for its /apps page. The AEI contract map (address → app id) is ~3.5 MB, too large to read on a page
 * view, so the contract push (handlePushContracts, "aei") stores a per-app digest under one KV key: the first
 * APP_CONTRACTS_CAP addresses in address order and the app's total. One write per hourly push; one read per app page.
 */
import type { Env } from "./env";

export const APP_CONTRACTS_KEY = "data:app-contracts";
export const APP_CONTRACTS_CAP = 25;
export type AppContracts = { total: number; sample: string[] };

export function buildAppContracts(map: Record<string, string>): Record<string, AppContracts> {
  const by = new Map<string, string[]>();
  for (const [addr, id] of Object.entries(map)) {
    const l = by.get(id);
    if (l) l.push(addr); else by.set(id, [addr]);
  }
  const out: Record<string, AppContracts> = {};
  for (const [id, l] of by) {
    l.sort();
    out[id] = { total: l.length, sample: l.slice(0, APP_CONTRACTS_CAP) };
  }
  return out;
}

/** Best effort: a failed write never fails the contract publish. */
export async function storeAppContracts(env: Env, map: Record<string, string>): Promise<void> {
  try { await env.INVITES.put(APP_CONTRACTS_KEY, JSON.stringify(buildAppContracts(map))); } catch (err) {
    console.warn("app contracts digest not stored", err instanceof Error ? err.message : err);
  }
}

export async function readAppContracts(env: Env, id: string): Promise<AppContracts | null> {
  try {
    const all = JSON.parse((await env.INVITES.get(APP_CONTRACTS_KEY)) ?? "null") as Record<string, AppContracts> | null;
    return all?.[id] ?? null;
  } catch { return null; }
}

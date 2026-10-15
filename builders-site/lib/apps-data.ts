/** /apps pages and the MCP tools: one loader over the same KV index files and D1 history as /api/v1 (spec 2026-10-15-agent-reference-design.md). */
import type { AbiData } from "../../src/lib/builders-index";
import { projectHref } from "../../src/lib/project-page";
import { dataUntil, firstHours, indexFile } from "./data-api";
import { isoHour, type IndexId } from "./data-api-rows";
import { verifiedIds } from "./data-api-verified";
import type { Env } from "./env";
import { FACTS_PREFIX } from "./facts";
import type { EdgeCacheDeps } from "./http";

const KIND: Record<string, "builder" | "integration" | "base"> = { project: "builder", integration: "integration", base: "base" };
export type AppRow = { id: string; name: string; kind: "builder" | "integration" | "base"; verified: boolean; points: number; share: number; first_hour: string;
  last_24h: { points_earned: number; payments: number; usdc: number }; contracts: number; indices: IndexId[] };
export type AppList = { data_until: string; rows: AppRow[]; totals: { apps: number; payments_24h: number; usdc_24h: number; arc_usdc_24h_est: number } };
export type HourRow = { hour_close: string; points: number; points_earned: number; payments: number; wallets: number; new_payers: number; usdc: number };
export type AppDetail = AppRow & { hourly: HourRow[]; facts_url: string | null; data_until: string };

export function idToPath(id: string): string | null {
  const i = id.indexOf(":");
  if (i <= 0 || i === id.length - 1) return null;
  const rest = id.slice(i + 1).split("/").map(encodeURIComponent).join("/");
  return `/apps/${encodeURIComponent(id.slice(0, i))}/${rest}/`;
}

export function pathToId(segments: string[]): string | null {
  const s = segments.filter(Boolean);
  if (s.length < 2) return null;
  try {
    const d = s.map((x) => decodeURIComponent(x));
    return `${d[0]}:${d.slice(1).join("/")}`;
  } catch { return null; }
}

const membersOf = (f: AbiData | null) => new Set((f?.projects ?? []).map((p) => p.source));

export async function loadAppList(env: Env, deps: EdgeCacheDeps): Promise<AppList | null> {
  const db = env.DATA_DB;
  const [aei, abi, aii] = await Promise.all([indexFile(env, "aei"), indexFile(env, "abi"), indexFile(env, "aii")]);
  if (!db || !aei?.live?.P) return null;
  const until = await dataUntil(db, "aei");
  if (until === null) return null;
  const [first, verified] = await Promise.all([firstHours(db, "aei"), verifiedIds(env, deps)]);
  const inAbi = membersOf(abi), inAii = membersOf(aii), P = aei.live.P;
  const rows: AppRow[] = aei.projects.filter((p) => typeof P[p.source] === "number").map((p) => ({
    id: p.source, name: p.name, kind: KIND[p.kind] ?? "builder", verified: verified.has(p.source), points: P[p.source], share: p.share,
    first_hour: isoHour(first.get(p.source) ?? until),
    last_24h: { points_earned: p.pts_24h ?? 0, payments: p.pay_24h ?? 0, usdc: p.usdc_24h ?? 0 },
    contracts: p.contracts ?? 0,
    indices: [...(inAbi.has(p.source) ? ["abi" as const] : []), ...(inAii.has(p.source) ? ["aii" as const] : []), "aei" as const],
  }));
  const usdc = (aei as { volume_24h?: Record<string, { members_usd: number; members_payments: number; base_usd_est: number }> }).volume_24h?.USDC;
  return { data_until: isoHour(until), rows, totals: {
    apps: rows.length,
    payments_24h: usdc?.members_payments ?? rows.reduce((a, r) => a + r.last_24h.payments, 0),
    usdc_24h: usdc?.members_usd ?? rows.reduce((a, r) => a + r.last_24h.usdc, 0),
    arc_usdc_24h_est: usdc?.base_usd_est ?? 0,
  } };
}

export async function loadApp(env: Env, deps: EdgeCacheDeps, id: string): Promise<AppDetail | null | "unknown"> {
  const list = await loadAppList(env, deps);
  if (!list) return null;
  const row = list.rows.find((r) => r.id === id);
  if (!row) return "unknown";
  const db = env.DATA_DB!, to = Date.parse(list.data_until) / 3600e3;
  const hourly = (await db.prepare("SELECT hour, points, points_earned, payments, wallets, new_payers, usdc FROM member_hour WHERE idx = 'aei' AND id = ? AND hour BETWEEN ? AND ? ORDER BY hour")
    .bind(id, to - 167, to).all<{ hour: number } & Omit<HourRow, "hour_close">>()).results
    .map(({ hour, ...r }) => ({ hour_close: isoHour(hour), ...r }));
  const facts = await env.INVITES.get(`${FACTS_PREFIX}${id}`);
  return { ...row, hourly, facts_url: facts ? projectHref(id) : null, data_until: list.data_until };
}

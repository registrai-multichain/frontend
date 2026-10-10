import type { AbiData } from "./builders-index";
import { validateIndex } from "./builders-index";
import { dayLab, fmt, hm, ts } from "./abi-terminal";

export const abiPath = "/api/index";
export const abiSeenPath = "/api/index/seen";

/** Plain labels only (owner copy rules): every explanation sits behind an "i" bubble. */
export const ABI_COPY = {
  heading: "Arc Builders Index",
  empty: "No data yet",
  failed: "Couldn't load the index. Try again.",
  weight: "Weight is a member's share of Σ√P. The square root keeps one large project from dominating. The Arc base layer carries chain-wide USDC activity.",
  why: "ABI = K · Σ√P. \"Older activity rolling off\" is what ABI would have lost with no new payments. Each project's bar is what its new payments added. Together they equal the net change exactly.",
  pace: "Pace = members' points in the last 24 closed hours ÷ the points needed to hold their current weight (points × daily roll-off). Above 100% pushes ABI up, below 100% lets it drift down.",
  close: "The open hour is computed in your browser from Arc RPC every 5 s with the same method Tabula uses on the server. At :00 UTC the hour closes; the closed value is what Tabula records.",
  inputs: "USDC (system emitter 0xffff…fffe) and registered fiat stablecoins, converted to USD at the ECB reference rate, into contracts Tabula Radar watches; a project's own deployers and contracts don't count. Arc base layer: every stablecoin sender per hour, from the first window of blocks of each hour.",
  milestones: "Verified events multiply the points of the member they belong to: Arc network upgrade ×1.25 and Circle product on Arc ×1.15 (Arc base layer), a new fiat stablecoin's first mint on Arc ×1.10 (base layer), a company going live on Arc ×1.00–1.10 by annual revenue, 1 + 0.025 · log10(revenue / $1M) (base layer), a member's mainnet release ×1.10. Each needs on-chain or official evidence. A milestone counts from the moment it is recorded and is not held back by the rise limit. Like all points, the lift rolls off unless activity follows.",
  noMilestones: "None recorded yet.",
  openHour: "The last closed hour comes from the server; the open hour is computed in this browser from Arc RPC. Every input is public Arc chain data.",
} as const;

/** Base tip: the level and date come from the file. */
export const baseTip = (d: AbiData): string =>
  `ABI was set to ${fmt(d.base.level, 0)} at ${hm(ts(d.base.time))} UTC on ${dayLab(ts(d.base.time))} ${new Date(d.base.time).getUTCFullYear()}, the day Tabula Radar went live. Points from 10 Aug onward count as warm-up.`;

/** Stablecoins tip: the sample window and scale come from the file. */
export const coinsTip = (d: AbiData): string => {
  const w = d.live?.base_window ?? 240, k = d.live?.base_scale ?? 30;
  return `USDC plus fiat stablecoins on Arc's launch list that are live on Arc mainnet. Amounts convert to USD at the ECB reference rate of the day before and score like USDC. A coin counts from the hour it is added. "Arc (est.)" is the base-layer sample (first ${w} blocks of each hour) × ${k}.`;
};

/** Roll-off tip: the half-life comes from the file. */
export const decayTip = (d: AbiData): string =>
  `Points halve every ${d.params.half_life_days} days, so ABI tracks a weighted average of recent activity. A project that keeps paying at a steady rate holds its weight; ABI rises when activity runs above its recent average and falls when it runs below.`;

export type AbiState = { kind: "loading" } | { kind: "empty" } | { kind: "error" } | { kind: "ready"; data: AbiData };

export function abiState(res: { status: number; body: unknown } | null): AbiState {
  if (!res) return { kind: "loading" };
  if (res.status === 404) return { kind: "empty" };
  if (res.status !== 200) return { kind: "error" };
  const v = validateIndex(res.body);
  return v.ok ? { kind: "ready", data: v.data } : { kind: "error" };
}

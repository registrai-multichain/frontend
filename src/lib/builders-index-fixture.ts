/** A small valid Arc Builders Index file for tests. */
export function indexFixture(): Record<string, unknown> {
  const series: [string, number][] = [];
  for (let i = 1; i <= 200; i++) series.push([new Date(Date.UTC(2026, 9, 2, 0) + i * 3600e3).toISOString().replace(".000Z", "Z"), 1000 - i * 0.3]);
  return {
    updated: "2026-10-09T15:47:56Z", data_until: "2026-10-09T15:00:00Z", head_time: "2026-10-09T15:47:23Z", head_block: 25094458,
    index: 944.76, index_24h_ago: 954.63,
    base: { time: "2026-10-02T00:00:00Z", level: 1000, sha256: "a".repeat(64) },
    series,
    projects: [
      { source: "base:arc", name: "Arc base layer", share: 21.15, share_base: 20, points: 21775952, contracts: 0, base_layer: true },
      { source: "domain:argus.world", name: "Argus", share: 18.73, share_base: 19.507, points: 68415.8, contracts: 12, base_layer: false },
      { source: "domain:new.app", name: "New", share: 1, share_base: null, points: 10, contracts: 1, base_layer: false },
    ],
    events: [
      { t: "2026-10-09T14:00:00Z", source: "domain:argus.world", name: "Argus", kind: "activity", payments: 48, wallets: 1, new_payers: 33, points: 180.1 },
      { t: "2026-10-09T13:00:00Z", source: "domain:argus.world", name: "Argus", kind: "rise_limit" },
      { t: "2026-10-05T13:00:00Z", source: "domain:argus.world", name: "Argus", kind: "activity", payments: 2, wallets: 2, new_payers: 0, points: 5 },
    ],
    params: { half_life_days: 14, decay_per_hour_pct: 0.206, cap_per_wallet_hour_usdc: 1000, new_payer_points: 1, rise_limit_own: 0.01, rise_limit_index: 0.005 },
    extra: { secret: "an unknown field is not published" },
    method: "docs/x.md",
  };
}

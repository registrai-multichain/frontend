import { describe, expect, test } from "vitest";
import deployment from "./deployments/arc-mainnet.json";
import { BUYBACK, CONTRACTS, EXPECTED_ROLES, FEE_SPLITS, RECORD, ROLES, WALLETS, compactNumber, holderLabel, parseDexPair, nativeToUsdc, percentOf, roleDiffs, supplySplit, sumBy, donutArcs, buybackView } from "./transparency";

describe("transparency (app.registrai.cc/transparency)", () => {
  test("every wallet comes from the mainnet deployment file, with what it does and what it cannot", () => {
    const b = deployment.builders as unknown as { operator: string; roles: Record<string, string> };
    expect(WALLETS.map((w) => w.address.toLowerCase())).toEqual(
      [b.roles.adminSafe, b.operator, b.roles.onboarder, b.roles.deployer].map((a) => a.toLowerCase()),
    );
    for (const w of WALLETS) {
      expect(w.label.length).toBeGreaterThan(0);
      expect(w.what.length).toBeGreaterThan(10);
      expect(w.cannot.length).toBeGreaterThan(10);
    }
  });

  test("the three phase-1 contracts, with their role names (DEFAULT_ADMIN first)", () => {
    expect(CONTRACTS.map((c) => c.address)).toEqual([
      deployment.builders.BuilderRegistry, deployment.builders.CaretakerRegistry, deployment.builders.VerifiedBuilderBadge,
    ]);
    expect(ROLES.registry.map((r) => r.name)).toEqual(["DEFAULT_ADMIN_ROLE", "REGISTRAR_ROLE"]);
    expect(ROLES.caretakers.map((r) => r.name)).toEqual(["DEFAULT_ADMIN_ROLE", "GOVERNOR_ROLE"]);
    expect(ROLES.badge.map((r) => r.name)).toEqual(["DEFAULT_ADMIN_ROLE", "ISSUER_ROLE", "STATUS_ROLE", "REVOKER_ROLE"]);
    expect(ROLES.registry[0].hash).toBe(`0x${"0".repeat(64)}`);
    expect(ROLES.badge[1].hash).toBe("0x114e74f6ea3bd819998f78687bfcb11b140da08e9b7d222fa9c1f1ba1f2aa122");
  });

  test("names a known wallet, shortens anything else", () => {
    expect(holderLabel(deployment.builders.roles.adminSafe.toLowerCase())).toBe("Admin Safe");
    expect(holderLabel("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });

  test("fee splits add up to 100%; the buyback spends its trigger in whole chunks", () => {
    for (const s of FEE_SPLITS) expect(s.legs.reduce((a, l) => a + l.pct, 0)).toBe(100);
    expect(BUYBACK.triggerUsdc % BUYBACK.chunkUsdc).toBe(0);
    expect(BUYBACK.burnAddress).toBe("0x000000000000000000000000000000000000dEaD");
  });

  test("the public record is newest first, every entry dated and titled", () => {
    const dates = RECORD.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const r of RECORD) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.title.length).toBeGreaterThan(5);
    }
  });

  test("Arc's native gas balance (18 decimals) in USDC base units (6)", () => {
    expect(nativeToUsdc(4_989_297_966_500_000_000n)).toBe(4_989_297n);
    expect(nativeToUsdc(0n)).toBe(0n);
  });
});

describe("numbers first", () => {
  test("expected roles cover every role on every contract", () => {
    for (const c of CONTRACTS) for (const r of ROLES[c.key]) expect(EXPECTED_ROLES[`${c.key}:${r.name}`]).toBeDefined();
  });
  test("roleDiffs: none when the chain matches the plan; names the role and wallet when it doesn't", () => {
    const live: Record<string, boolean> = {};
    for (const c of CONTRACTS) for (const r of ROLES[c.key]) for (const w of WALLETS) live[`${c.key}:${r.name}:${w.key}`] = EXPECTED_ROLES[`${c.key}:${r.name}`].includes(w.key);
    expect(roleDiffs(live)).toEqual([]);
    live["badge:ISSUER_ROLE:deployer"] = true;
    live["registry:REGISTRAR_ROLE:safe"] = false;
    expect(roleDiffs(live)).toEqual([
      "Admin Safe no longer holds BuilderRegistry registrar",
      "Deployer holds VerifiedBuilderBadge issuer, which it shouldn't",
    ]);
  });
  test("percentOf: two decimals, zero-safe", () => {
    expect(percentOf(28_142_908n, 1_000_000_000n)).toBe("2.81%");
    expect(percentOf(1n, 0n)).toBe("0%");
  });
  test("compactNumber: 28.1M, 1.2K, 999", () => {
    expect(compactNumber(28_142_908)).toBe("28.1M");
    expect(compactNumber(1_234)).toBe("1.2K");
    expect(compactNumber(999)).toBe("999");
    expect(compactNumber(1_000_000_000)).toBe("1B");
  });
});

test("parseDexPair: price, market cap and liquidity from DexScreener; null on anything else", () => {
  expect(parseDexPair({ pairs: [{ priceUsd: "0.0001173", marketCap: 114242, fdv: 120000, liquidity: { usd: 31870.97 } }] })).toEqual({
    priceUsd: 0.0001173, marketCapUsd: 114242, liquidityUsd: 31870.97,
  });
  expect(parseDexPair({ pair: { priceUsd: "0.5", fdv: 10, liquidity: { usd: 3 } } })).toEqual({ priceUsd: 0.5, marketCapUsd: 10, liquidityUsd: 3 });
  expect(parseDexPair({ pairs: [] })).toBeNull();
  expect(parseDexPair(null)).toBeNull();
  expect(parseDexPair({ pairs: [{ priceUsd: "abc" }] })).toBeNull();
});

describe("supply and balances", () => {
  test("splits REGI supply into burned, protocol-owned and everyone else, each with its share", () => {
    const parts = supplySplit({ supply: 1000n, burned: 28n, protocol: 150n });
    expect(parts.map((p) => [p.key, p.amount, p.pct])).toEqual([
      ["burned", 28n, "2.80%"],
      ["protocol", 150n, "15.00%"],
      ["public", 822n, "82.20%"],
    ]);
  });

  test("never shows a negative public share when the reads overlap", () => {
    const parts = supplySplit({ supply: 100n, burned: 60n, protocol: 60n });
    expect(parts.find((p) => p.key === "public")!.amount).toBe(0n);
  });

  test("sums balances across wallets, missing ones count as zero", () => {
    expect(sumBy(WALLETS, { safe: 5n, operator: 2n })).toBe(7n);
  });

  test("donut arcs: each part's length and where it starts, around a circle of the given length", () => {
    expect(donutArcs([50, 30, 20], 100)).toEqual([
      { length: 50, offset: 0 },
      { length: 30, offset: 50 },
      { length: 20, offset: 80 },
    ]);
  });

  test("donut arcs keep a tiny part visible and skip empty ones", () => {
    const arcs = donutArcs([0.1, 0, 99.9], 100, 1);
    expect(arcs[0].length).toBe(1);
    expect(arcs[1].length).toBe(0);
    expect(arcs[2].offset).toBeCloseTo(1);
  });
});

describe("buyback volume", () => {
  test("nothing bought yet before the buyback contract exists", () => {
    expect(buybackView(null)).toEqual({ live: false, spentUsdc: 0n, burnedRegi: 0n, buys: 0, pending: 0n, toTrigger: 500_000_000n, progressPct: 0 });
  });

  test("progress toward the next buy from what the contract holds", () => {
    const v = buybackView({ spentUsdc: 1_500_000_000n, burnedRegi: 10n, buys: 15, pending: 125_000_000n });
    expect(v.live).toBe(true);
    expect(v.toTrigger).toBe(375_000_000n);
    expect(v.progressPct).toBe(25);
  });

  test("a full contract shows 100% and nothing left to go", () => {
    const v = buybackView({ spentUsdc: 0n, burnedRegi: 0n, buys: 0, pending: 600_000_000n });
    expect(v.progressPct).toBe(100);
    expect(v.toTrigger).toBe(0n);
  });
});

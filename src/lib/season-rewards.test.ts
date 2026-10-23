import { describe, expect, test } from "vitest";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { concat, decodeFunctionData, keccak256, type Hex } from "viem";
import {
  MIN_HOLD_SECS,
  MIN_MARKET_VOLUME,
  RULE_VERSION,
  allocate,
  buildSeasonTree,
  capFor,
  countedVolume,
  leafOf,
  publishSeasonSafeJson,
  scoreMarkets,
  seasonFile,
  seasonPoolWriteAbi,
  volumePoints,
  type MarketFacts,
  type Trade,
} from "./season-rewards";

const U = 1_000_000n;
const T0 = 1_800_000_000n;

/** A Bought: `shares` for `collateral` at `timestamp`; `seq` orders it (block = seq, log 0). */
function buy(marketId: string, trader: string, outcome: number, shares: bigint, collateral: bigint, timestamp: bigint, seq: number): Trade {
  return { marketId, trader, kind: "buy", outcome, shares, collateral, timestamp, blockNumber: BigInt(seq), logIndex: 0 };
}
/** A Sold of `shares` at `timestamp` (its collateral is informational). */
function sell(marketId: string, trader: string, outcome: number, shares: bigint, timestamp: bigint, seq: number, collateral = 0n): Trade {
  return { marketId, trader, kind: "sell", outcome, shares, collateral, timestamp, blockNumber: BigInt(seq), logIndex: 0 };
}

/** OpenZeppelin MerkleProof.verify: sorted-pair keccak up the tree. */
function verify(proof: Hex[], root: Hex, leaf: Hex): boolean {
  let h = leaf;
  for (const p of proof) h = keccak256(h < p ? concat([h, p]) : concat([p, h]));
  return h === root;
}

describe("leaf encoding matches SeasonPool.leafOf", () => {
  test("vectors read from the deployed contract (anvil, contracts 531c52c)", () => {
    // cast call <SeasonPool> "leafOf(uint256,uint256,uint256)(bytes32)" 3 42 123456789
    expect(leafOf(3n, 42n, 123_456_789n)).toBe("0x727dee6908e521a44374746549be8aee705964fa4eae02cdbd695767f9593f4b");
    expect(leafOf(1n, 7n, 1_000_000n)).toBe("0xc1cda00497167ac0372c50a6315bac07ac95ac589963ee1150716e4e11d1091a");
  });
  test("== OpenZeppelin StandardMerkleTree's leaf hash over [uint256, uint256, uint256]", () => {
    const t = StandardMerkleTree.of([["3", "42", "123456789"]], ["uint256", "uint256", "uint256"]);
    expect(t.leafHash(["3", "42", "123456789"])).toBe(leafOf(3n, 42n, 123_456_789n));
  });
  test("every proof verifies the contract's way; zero amounts are left out", () => {
    const tree = buildSeasonTree(5n, [
      { builderId: 9, amount: 3n * U },
      { builderId: 2, amount: 7n * U },
      { builderId: 4, amount: 0n },
      { builderId: 11, amount: 1n },
    ]);
    expect(tree.rows.map((r) => r.builderId)).toEqual([2, 9, 11]);
    for (const r of tree.rows) {
      expect(r.leaf).toBe(leafOf(5n, BigInt(r.builderId), r.amount));
      expect(verify(r.proof, tree.root, r.leaf)).toBe(true);
    }
    expect(verify(tree.rows[0].proof, tree.root, leafOf(5n, 2n, 7n * U + 1n))).toBe(false);
    expect(() => buildSeasonTree(1n, [{ builderId: 1, amount: 0n }])).toThrow(/nothing to publish/);
  });
  test("deterministic: the same rows in any order give the same root", () => {
    const rows = [{ builderId: 1, amount: 5n }, { builderId: 2, amount: 6n }, { builderId: 3, amount: 7n }];
    expect(buildSeasonTree(1n, rows).root).toBe(buildSeasonTree(1n, [...rows].reverse()).root);
  });
});

describe("points", () => {
  test("sqrt(volume in USD), 6 decimals, floored", () => {
    expect(volumePoints(500n * U)).toBe(22_360_679n); // sqrt(500) = 22.3606797...
    expect(volumePoints(10_000n * U)).toBe(100_000_000n);
    expect(volumePoints(0n)).toBe(0n);
  });

  test("the rule is v2 with a 24-hour minimum hold", () => {
    expect(RULE_VERSION).toBe("v2");
    expect(MIN_HOLD_SECS).toBe(86_400n);
  });

  const builders = [
    { builderId: 1, owner: "0xowner1", feeds: ["0xF1", "0xf2"] },
    { builderId: 2, owner: "0xowner2", feeds: ["0xf3"] },
  ];
  const market = (marketId: string, builderId: number, feedId: string, yes = true): MarketFacts => ({
    marketId, builderId, feedId, creator: "0xcreator", agent: "0xagent", resolvedYesInSeason: yes,
  });
  /** Buys held to settlement (never sold): each counts its full collateralIn. */
  const trades = (marketId: string, ...rows: [string, bigint][]): Trade[] =>
    rows.map(([trader, collateral], i) => buy(marketId, trader, 0, collateral, collateral, T0, i));

  test("only YES-resolved markets on the builder's own project feeds with >= $500 counted volume score", () => {
    const markets = [
      market("0xa", 1, "0xf1"), // counts: 900 from others
      market("0xb", 1, "0xf2"), // 499.999999 counted -> below the floor
      market("0xc", 1, "0xf3"), // builder 1's market on builder 2's feed -> no
      market("0xd", 2, "0xf3", false), // resolved NO / not in season -> no
      market("0xe", 3, "0xf1"), // builder 3 is not eligible -> no
      market("0xf", 2, "0xf3"), // own wallet + creator + agent volume only -> 0 counted
    ];
    const byMarket = new Map<string, Trade[]>([
      ["0xa", trades("0xa", ["0xuser", 900n * U], ["0xowner1", 5_000n * U])],
      ["0xb", trades("0xb", ["0xuser", MIN_MARKET_VOLUME - 1n])],
      ["0xc", trades("0xc", ["0xuser", 10_000n * U])],
      ["0xd", trades("0xd", ["0xuser", 10_000n * U])],
      ["0xe", trades("0xe", ["0xuser", 10_000n * U])],
      ["0xf", trades("0xf", ["0xowner2", 9_000n * U], ["0xcreator", 9_000n * U], ["0xagent", 9_000n * U])],
    ]);
    const r = scoreMarkets(builders, markets, byMarket);
    expect([...r.points]).toEqual([[1, volumePoints(900n * U)]]);
    expect([...r.volumes]).toEqual([[1, 900n * U]]);
    expect(r.markets.map((m) => m.marketId)).toEqual(["0xa"]);
    expect(r.markets[0].volume).toBe(900n * U);
  });

  test("one square root per builder: splitting a market's volume over many markets earns the same points", () => {
    const one = scoreMarkets(
      [{ builderId: 1, owner: "0xowner1", feeds: ["0xf1"] }],
      [market("0x01", 1, "0xf1")],
      new Map([["0x01", trades("0x01", ["0xuser", 3_000n * U])]]),
    );
    const split = scoreMarkets(
      [{ builderId: 1, owner: "0xowner1", feeds: ["0xf1"] }],
      [market("0x01", 1, "0xf1"), market("0x02", 1, "0xf1"), market("0x03", 1, "0xf1")],
      new Map([
        ["0x01", trades("0x01", ["0xuser", 1_000n * U])],
        ["0x02", trades("0x02", ["0xuser", 1_000n * U])],
        ["0x03", trades("0x03", ["0xuser", 1_000n * U])],
      ]),
    );
    expect(split.points.get(1)).toBe(volumePoints(3_000n * U));
    expect(split.points.get(1)).toBe(one.points.get(1));
    expect(split.volumes.get(1)).toBe(3_000n * U);
    expect(split.points.get(1)!).toBeLessThan(3n * volumePoints(1_000n * U)); // what v1 paid
    expect(split.markets.map((m) => m.volume)).toEqual([1_000n * U, 1_000n * U, 1_000n * U]);
  });

  test("the $500 floor stays per market: a small market adds nothing even when the builder's total is large", () => {
    const r = scoreMarkets(
      [{ builderId: 1, owner: "0xowner1", feeds: ["0xf1"] }],
      [market("0x01", 1, "0xf1"), market("0x02", 1, "0xf1")],
      new Map([
        ["0x01", trades("0x01", ["0xuser", 2_000n * U])],
        ["0x02", trades("0x02", ["0xuser", 499n * U])],
      ]),
    );
    expect(r.volumes.get(1)).toBe(2_000n * U);
    expect(r.points.get(1)).toBe(volumePoints(2_000n * U));
    expect(r.markets.map((m) => m.marketId)).toEqual(["0x01"]);
  });
});

describe("counted volume: buys held >= MIN_HOLD_SECS, FIFO per (trader, market, side)", () => {
  const H = MIN_HOLD_SECS;
  const m = "0xm";

  test("a buy sold back within the hold time counts 0", () => {
    expect(countedVolume([buy(m, "0xu", 0, 100n, 50n * U, T0, 0), sell(m, "0xu", 0, 100n, T0 + H - 1n, 1)], [])).toBe(0n);
  });

  test("a buy held past the hold time counts fully (and the sell itself never counts)", () => {
    expect(countedVolume([buy(m, "0xu", 0, 100n, 50n * U, T0, 0), sell(m, "0xu", 0, 100n, T0 + H + 1n, 1, 70n * U)], [])).toBe(50n * U);
    // exactly MIN_HOLD_SECS is enough
    expect(countedVolume([buy(m, "0xu", 0, 100n, 50n * U, T0, 0), sell(m, "0xu", 0, 100n, T0 + H, 1)], [])).toBe(50n * U);
  });

  test("a buy never sold (held to settlement) counts fully, however late", () => {
    expect(countedVolume([buy(m, "0xu", 0, 100n, 50n * U, T0, 0)], [])).toBe(50n * U);
  });

  test("a partial sell within the hold time counts only the remainder, pro rata by shares", () => {
    expect(countedVolume([buy(m, "0xu", 0, 100n, 50n * U, T0, 0), sell(m, "0xu", 0, 40n, T0 + 60n, 1)], [])).toBe(30n * U);
  });

  test("FIFO across lots: the oldest lot is consumed first, each judged by its own age", () => {
    const t = [
      buy(m, "0xu", 0, 100n, 60n * U, T0, 0), // lot A
      buy(m, "0xu", 0, 100n, 40n * U, T0 + H / 2n, 1), // lot B
      // at T0 + H: all of A (held H -> counts 60), 50 shares of B (held H/2 -> 20 does not count)
      sell(m, "0xu", 0, 150n, T0 + H, 2),
    ];
    expect(countedVolume(t, [])).toBe(60n * U + 20n * U);
    // both sold early: only B's unsold half counts
    const early = [t[0], t[1], sell(m, "0xu", 0, 150n, T0 + H / 2n + 1n, 2)];
    expect(countedVolume(early, [])).toBe(20n * U);
  });

  test("lots are per trader and per side: another wallet's or the other side's sell does not consume them", () => {
    const t = [
      buy(m, "0xu", 0, 100n, 50n * U, T0, 0),
      buy(m, "0xv", 0, 100n, 50n * U, T0, 1),
      sell(m, "0xv", 0, 100n, T0 + 1n, 2), // v's own lot, early -> 0
      buy(m, "0xu", 1, 10n, 5n * U, T0, 3),
      sell(m, "0xu", 1, 10n, T0 + 1n, 4), // u's NO lot, early -> 0
      sell(m, "0xU", 1, 5n, T0 + 2n, 5), // more NO than u holds: consumes nothing more (and not u's YES lot)
    ];
    expect(countedVolume(t, [])).toBe(50n * U);
  });

  test("trades are matched in chain order (block, log index), whatever order they are passed in", () => {
    const t = [buy(m, "0xu", 0, 100n, 50n * U, T0, 0), sell(m, "0xu", 0, 100n, T0 + 5n, 1), buy(m, "0xu", 0, 100n, 50n * U, T0 + 6n, 2)];
    expect(countedVolume([...t].reverse(), [])).toBe(countedVolume(t, []));
    expect(countedVolume(t, [])).toBe(50n * U);
  });

  test("pro rata is floored on the part that does not count, and a lot's last share takes what is left", () => {
    // 3 shares for 10 units; 1 share sold early -> floor(10 * 1/3) = 3 not counted
    expect(countedVolume([buy(m, "0xu", 0, 3n, 10n, T0, 0), sell(m, "0xu", 0, 1n, T0 + 1n, 1)], [])).toBe(7n);
    // then the other 2 early too -> nothing is left to count
    expect(countedVolume([buy(m, "0xu", 0, 3n, 10n, T0, 0), sell(m, "0xu", 0, 1n, T0 + 1n, 1), sell(m, "0xu", 0, 2n, T0 + 2n, 2)], [])).toBe(0n);
  });

  test("the hold time is a parameter", () => {
    const t = [buy(m, "0xu", 0, 100n, 50n * U, T0, 0), sell(m, "0xu", 0, 100n, T0 + 60n, 1)];
    expect(countedVolume(t, [], 60n)).toBe(50n * U);
    expect(countedVolume(t, [], 61n)).toBe(0n);
  });

  test("the builder owner, the creator and the agent are excluded (any case), held or not", () => {
    const t = [
      buy(m, "0xAAA", 0, 100n, 100n, T0, 0),
      buy(m, "0xbbb", 0, 10n, 10n, T0, 1),
      buy(m, "0xccc", 1, 1n, 1n, T0, 2),
      buy(m, "0xddd", 0, 1_000n, 1_000n, T0, 3),
    ];
    expect(countedVolume(t, ["0xaaa", "0xBBB", "0xccc"])).toBe(1_000n);
  });
});

describe("allocation: pro rata, 20% cap, excess re-spread, floored", () => {
  const sum = (a: { amount: bigint }[]) => a.reduce((s, x) => s + x.amount, 0n);

  test("uncapped: plain pro rata, dust to no one", () => {
    const pts = new Map<number, bigint>([[1, 1n], [2, 1n], [3, 1n], [4, 1n], [5, 1n], [6, 1n]]);
    const a = allocate(pts, 100n);
    expect(a.map((x) => x.amount)).toEqual([16n, 16n, 16n, 16n, 16n, 16n]); // 100/6 floored
    expect(sum(a)).toBe(96n); // 4 units of dust stay unassigned
    expect(a.every((x) => !x.capped)).toBe(true);
  });

  test("a whale is capped at 20% and its excess re-spread over the rest", () => {
    const pts = new Map<number, bigint>([[1, 1_000n], [2, 10n], [3, 10n], [4, 10n], [5, 10n], [6, 10n], [7, 10n]]);
    const total = 1_000n * U;
    const a = allocate(pts, total);
    expect(capFor(total)).toBe(200n * U);
    expect(a[0]).toMatchObject({ builderId: 1, amount: 200n * U, capped: true });
    // the other 800 split evenly over six equal builders
    for (const x of a.slice(1)) expect(x.amount).toBe((800n * U) / 6n);
    expect(sum(a)).toBeLessThanOrEqual(total);
    expect(total - sum(a)).toBeLessThan(6n);
    for (const x of a) expect(x.amount).toBeLessThanOrEqual(capFor(total));
  });

  test("capping cascades: a re-spread can push a second builder over the cap", () => {
    // 50/25/10/5/5/5 of 100: #1 (50%) and #2 (25%) are over 20 -> capped; the 60 left over
    // 25 pts gives #3 24 > 20 -> capped too; the last 40 over 15 pts: 13.33 each, floored.
    const pts = new Map<number, bigint>([[1, 50n], [2, 25n], [3, 10n], [4, 5n], [5, 5n], [6, 5n]]);
    const a = allocate(pts, 100n);
    expect(a.map((x) => [x.builderId, x.amount, x.capped])).toEqual([
      [1, 20n, true], [2, 20n, true], [3, 20n, true], [4, 13n, false], [5, 13n, false], [6, 13n, false],
    ]);
    expect(sum(a)).toBe(99n);
    // exactly at the cap is not over it
    const b = allocate(new Map([[1, 2n], [2, 2n], [3, 2n], [4, 2n], [5, 2n]]), 100n);
    expect(b.map((x) => [x.amount, x.capped])).toEqual(Array(5).fill([20n, false]));
  });

  test("fewer than five builders: everyone capped, the rest stays unassigned", () => {
    const a = allocate(new Map([[1, 3n], [2, 1n]]), 1_000n);
    expect(a.map((x) => x.amount)).toEqual([200n, 200n]);
    expect(a.every((x) => x.capped)).toBe(true);
  });

  test("deterministic: insertion order does not matter; no points, no row", () => {
    const e: [number, bigint][] = [[3, 7n], [1, 2n], [2, 9n], [9, 0n], [5, 4n], [4, 4n], [6, 1n]];
    const a = allocate(new Map(e), 12_345_678n);
    const b = allocate(new Map([...e].reverse()), 12_345_678n);
    expect(a).toEqual(b);
    expect(a.map((x) => x.builderId)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const x of a) expect(x.amount).toBeLessThanOrEqual(capFor(12_345_678n));
  });

  test("nothing eligible: nothing allocated", () => {
    expect(allocate(new Map(), 100n)).toEqual([]);
  });
});

describe("outputs", () => {
  test("the Safe file calls publishSeason(N, root, total, deadline) on the pool", () => {
    const root = `0x${"12".repeat(32)}` as Hex;
    const j = publishSeasonSafeJson({ chainId: 5042, seasonPool: "0x00000000000000000000000000000000000000b2", seasonId: 3n, root, total: 5n * U, deadline: 1_900_000_000n, createdAt: 1 });
    expect(j.chainId).toBe("5042");
    expect(j.transactions).toHaveLength(1);
    const d = decodeFunctionData({ abi: seasonPoolWriteAbi, data: j.transactions[0].data });
    expect(d.args).toEqual([3n, root, 5n * U, 1_900_000_000n]);
  });

  test("season file: root, totals, per-builder rows with proofs", () => {
    const allocations = allocate(new Map([[1, 3n], [2, 1n], [3, 1n], [4, 1n], [5, 1n], [6, 1n]]), 1_000n);
    const tree = buildSeasonTree(2n, allocations);
    const f = seasonFile({
      seasonId: 2n, total: 1_000n, deadline: 99n, chainId: 1, params: { fromBlock: "1" },
      eligible: allocations.map((a) => ({ builderId: a.builderId, owner: `0xOWNER${a.builderId}`, feeds: [] })),
      scored: [], allocations, tree,
    });
    expect(f.root).toBe(tree.root);
    expect(BigInt(f.allocated) + BigInt(f.unassigned)).toBe(1_000n);
    expect(f.builders[0]).toMatchObject({ builderId: 1, amount: "200", capped: true, owner: "0xowner1" });
    expect(f.builders[0].proof.length).toBeGreaterThan(0);
    expect(verify(f.builders[1].proof as Hex[], f.root, f.builders[1].leaf as Hex)).toBe(true);
  });
});

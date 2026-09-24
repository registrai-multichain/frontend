import { describe, expect, test } from "vitest";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { concat, decodeFunctionData, keccak256, type Hex } from "viem";
import {
  MIN_MARKET_VOLUME,
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
  test("counted volume skips the builder owner, the creator and the agent (any case)", () => {
    const trades: Trade[] = [
      { marketId: "m", trader: "0xAAA", gross: 100n },
      { marketId: "m", trader: "0xbbb", gross: 10n },
      { marketId: "m", trader: "0xccc", gross: 1n },
      { marketId: "m", trader: "0xddd", gross: 1_000n },
    ];
    expect(countedVolume(trades, ["0xaaa", "0xBBB", "0xccc"])).toBe(1_000n);
  });

  const builders = [
    { builderId: 1, owner: "0xowner1", feeds: ["0xF1", "0xf2"] },
    { builderId: 2, owner: "0xowner2", feeds: ["0xf3"] },
  ];
  const market = (marketId: string, builderId: number, feedId: string, yes = true): MarketFacts => ({
    marketId, builderId, feedId, creator: "0xcreator", agent: "0xagent", resolvedYesInSeason: yes,
  });
  const trades = (marketId: string, ...rows: [string, bigint][]) => rows.map(([trader, gross]) => ({ marketId, trader, gross }));

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
    expect(r.markets.map((m) => m.marketId)).toEqual(["0xa"]);
    expect(r.markets[0].volume).toBe(900n * U);
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

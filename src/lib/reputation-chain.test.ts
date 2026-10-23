import { describe, expect, test } from "vitest";
import type { Address, Hex, PublicClient } from "viem";
import { freshCatchFor, readAgentBond, readOpenCollateral, resolveStack, scanInvalidRulings } from "./reputation-chain";

const MARKET = "0x00000000000000000000000000000000000000a1" as Address;
const ATT = "0x00000000000000000000000000000000000000a2" as Address;
const REG = "0x00000000000000000000000000000000000000a3" as Address;
const DIS = "0x00000000000000000000000000000000000000a4" as Address;
const AGENT = "0x00000000000000000000000000000000000000b1" as Address;
const OTHER = "0x00000000000000000000000000000000000000b2" as Address;
const FEED = `0x${"fe".repeat(32)}` as Hex;
const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

type Call = { address: string; functionName: string; args?: readonly unknown[] };

/** A fake client: `views(call)` answers or throws (a missing view reverts). */
function fake(views: (c: Call) => unknown, logs: (a: bigint, b: bigint) => unknown[] = () => []) {
  const ranges: Array<[bigint, bigint]> = [];
  const client = {
    readContract: async (c: Call) => views(c),
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push([fromBlock, toBlock]);
      return logs(fromBlock, toBlock);
    },
  } as unknown as PublicClient;
  return { client, ranges };
}
const missing = () => {
  throw new Error("execution reverted");
};

describe("resolveStack", () => {
  test("follows market → ATTESTATION → REGISTRY / dispute", async () => {
    const { client } = fake((c) =>
      c.functionName === "ATTESTATION" ? ATT : c.functionName === "REGISTRY" && c.address === ATT ? REG : c.functionName === "dispute" ? DIS : missing(),
    );
    expect(await resolveStack(client, MARKET)).toEqual({ attestation: ATT, registry: REG, dispute: DIS });
  });

  test("falls back to config when the chain won't say", async () => {
    const { client } = fake(missing);
    const m = "0x00000000000000000000000000000000000000c9" as Address;
    expect(await resolveStack(client, m, { registry: REG, dispute: DIS })).toEqual({ attestation: undefined, registry: REG, dispute: DIS });
  });
});

describe("readAgentBond", () => {
  test("reads Registry.getAgent(feed, agent).bond, undefined without a registry or on failure", async () => {
    const { client } = fake((c) => (c.functionName === "getAgent" ? { bond: 42n } : missing()));
    expect(await readAgentBond(client, REG, FEED, AGENT)).toBe(42n);
    expect(await readAgentBond(client, undefined, FEED, AGENT)).toBeUndefined();
    expect(await readAgentBond(fake(missing).client, REG, FEED, AGENT)).toBeUndefined();
  });
});

describe("readOpenCollateral", () => {
  const markets: Record<string, { phase: number; agent: string; feedId: string; createdAt: bigint; col: bigint }> = {
    [id(1)]: { phase: 0, agent: AGENT, feedId: FEED, createdAt: 1n, col: 100n },
    [id(2)]: { phase: 0, agent: AGENT, feedId: FEED, createdAt: 1n, col: 250n },
    [id(3)]: { phase: 1, agent: AGENT, feedId: FEED, createdAt: 1n, col: 999n }, // resolved
    [id(4)]: { phase: 0, agent: OTHER, feedId: FEED, createdAt: 1n, col: 999n }, // another agent
    [id(5)]: { phase: 0, agent: AGENT, feedId: `0x${"ab".repeat(32)}`, createdAt: 1n, col: 999n }, // another feed
  };
  const v3 = (c: Call) => {
    const m = markets[c.args?.[0] as string];
    if (c.functionName === "collateralOf") return m?.col ?? 0n;
    if (c.functionName === "getMarket") return m ?? { phase: 0, agent: AGENT, feedId: FEED, createdAt: 0n };
    return missing();
  };

  test("sums only the agent's Trading markets on the feed, each once", async () => {
    const { client } = fake(v3);
    const ids = [1, 2, 3, 4, 5, 1, 9].map((n) => ({ id: id(n) }));
    expect(await readOpenCollateral(client, MARKET, "v4", AGENT, FEED, id(1), ids)).toBe(350n);
  });

  test("uses known phase/collateral without re-reading", async () => {
    const { client } = fake((c) => (c.functionName === "collateralOf" ? 0n : missing()));
    const known = [{ id: id(7), phase: 0, agent: AGENT, feed: FEED, collateral: 70n }, { id: id(8), phase: 2, agent: AGENT, feed: FEED }];
    expect(await readOpenCollateral(client, MARKET, "perennial", AGENT, FEED, id(7), known)).toBe(70n);
  });

  test("nothing at risk is 0, not unknown", async () => {
    const { client } = fake(v3);
    expect(await readOpenCollateral(client, MARKET, "v4", AGENT, FEED, id(3), [{ id: id(3) }])).toBe(0n);
  });

  test("legacy (no collateralOf) is undefined: coverage hidden", async () => {
    const { client } = fake((c) => (c.functionName === "getMarket" ? markets[id(1)] : missing()));
    expect(await readOpenCollateral(client, MARKET, "v4", AGENT, FEED, id(1), [{ id: id(1) }])).toBeUndefined();
  });
});

describe("scanInvalidRulings", () => {
  const ruling = (block: bigint, disputeId: Hex, outcome: number) => ({
    blockNumber: block,
    transactionHash: `0x${block.toString(16).padStart(64, "0")}`,
    args: { disputeId, outcome },
  });

  test("finds Invalid rulings after the snapshot, traces the agent, stays in ≤5,000-block chunks", async () => {
    const dispute = "0x00000000000000000000000000000000000000d1" as Address;
    const { client, ranges } = fake(
      (c) =>
        c.functionName === "getDispute"
          ? { attestationId: c.args?.[0] === id(0xd1) ? id(0xa1) : id(0xa2) }
          : c.functionName === "getAttestation"
            ? { agent: c.args?.[0] === id(0xa1) ? AGENT : OTHER }
            : missing(),
      (a, b) =>
        [ruling(10_500n, id(0xd1), 2), ruling(11_000n, id(0xd2), 2), ruling(12_000n, id(0xd3), 1)].filter(
          (l) => l.blockNumber >= a && l.blockNumber <= b,
        ),
    );
    const r = await scanInvalidRulings(client, dispute, ATT, 10_000n, 21_000n);
    expect(r.partial).toBe(false);
    for (const [a, b] of ranges) expect(b - a + 1n).toBeLessThanOrEqual(5_000n);
    expect(ranges[0][1]).toBe(21_000n); // newest first
    expect(r.rulings.map((x) => x.agent).sort()).toEqual([AGENT, OTHER].map((x) => x.toLowerCase()).sort());
    const mine = freshCatchFor(r.rulings, AGENT, 10_000);
    expect(mine).toMatchObject({ disputeId: id(0xd1), block: 10_500 });
    expect(mine?.tx).toBe(`0x${(10_500).toString(16).padStart(64, "0")}`);
    expect(freshCatchFor(r.rulings, AGENT, 10_500)).toBeUndefined();

    // A later call only reads the new blocks.
    ranges.length = 0;
    await scanInvalidRulings(client, dispute, ATT, 10_000n, 23_000n);
    expect(ranges).toEqual([[21_001n, 23_000n]]);
  });

  test("a budget smaller than the gap reports a partial scan and resumes it", async () => {
    const dispute = "0x00000000000000000000000000000000000000d2" as Address;
    const { client, ranges } = fake(missing);
    const first = await scanInvalidRulings(client, dispute, ATT, 0n, 30_000n, 2);
    expect(first.partial).toBe(true);
    expect(ranges).toEqual([[25_001n, 30_000n], [20_001n, 25_000n]]);
    ranges.length = 0;
    const second = await scanInvalidRulings(client, dispute, ATT, 0n, 30_000n, 10);
    expect(second.partial).toBe(false);
    expect(ranges[0]).toEqual([15_001n, 20_000n]);
    expect(ranges[ranges.length - 1]).toEqual([1n, 5_000n]);
  });
});

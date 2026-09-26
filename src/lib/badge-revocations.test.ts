import { describe, expect, test } from "vitest";
import type { Address } from "viem";
import {
  blockRanges, checkpointFromJson, checkpointToJson, readRevokedBuilders, revokedBuilders, type LogReader,
} from "./badge-revocations";

const BADGE = "0x05de78E9Ff17ccE47D7F4E9170fdfC130Abe278c" as Address;
const REG = "0x10F8D6D5905E2C4dc565a1894c102B25E9d21DF4" as Address;

describe("revokedBuilders", () => {
  test("a Revoked event not followed by a reactivation", () => {
    const revoked = revokedBuilders(
      [
        { builderId: 1, block: 10n, index: 0 },
        { builderId: 2, block: 10n, index: 1 },
        { builderId: 3, block: 20n, index: 0 },
      ],
      [
        { builderId: 1, active: false, block: 10n, index: 1 }, // the /admin revoke file: revoke, then deactivate
        { builderId: 2, active: false, block: 10n, index: 2 },
        { builderId: 2, active: true, block: 30n, index: 0 }, // the Safe re-admitted #2
        { builderId: 3, active: true, block: 19n, index: 0 }, // a reactivation BEFORE the revoke does not count
      ],
    );
    expect([...revoked].sort()).toEqual([1, 3]);
  });

  test("same block: log order decides", () => {
    expect(revokedBuilders([{ builderId: 5, block: 7n, index: 3 }], [{ builderId: 5, active: true, block: 7n, index: 4 }]).size).toBe(0);
    expect(revokedBuilders([{ builderId: 5, block: 7n, index: 3 }], [{ builderId: 5, active: true, block: 7n, index: 2 }]).has(5)).toBe(true);
  });

  test("revoked again after a reactivation: revoked", () => {
    const revoked = revokedBuilders(
      [
        { builderId: 4, block: 1n, index: 0 },
        { builderId: 4, block: 9n, index: 0 },
      ],
      [{ builderId: 4, active: true, block: 5n, index: 0 }],
    );
    expect(revoked.has(4)).toBe(true);
  });
});

describe("readRevokedBuilders", () => {
  const fake = (logs: { address: Address; block: bigint; args: Record<string, unknown> }[], head = 12_000n) => {
    const ranges: [bigint, bigint][] = [];
    const client: LogReader = {
      getBlockNumber: async () => head,
      getLogs: async ({ address, fromBlock, toBlock }) => {
        if (address === BADGE) ranges.push([fromBlock, toBlock]);
        return logs
          .filter((l) => l.address === address && l.block >= fromBlock && l.block <= toBlock)
          .map((l) => ({ args: l.args, blockNumber: l.block, logIndex: 0 }));
      },
    };
    return { client, ranges };
  };

  test("reads Revoked on the badge and BuilderStatusSet on the registry, in ≤5,000-block chunks", async () => {
    const { client, ranges } = fake([
      { address: BADGE, block: 1_500n, args: { builderId: 7n, serial: 3n } },
      { address: BADGE, block: 6_000n, args: { builderId: 8n, serial: 4n } },
      { address: REG, block: 11_000n, args: { id: 8n, active: true } },
    ]);
    const r = await readRevokedBuilders(client, { badge: BADGE, registry: REG, fromBlock: 1_000n });
    expect(r).toMatchObject({ ok: true, revoked: new Set([7]), toBlock: 12_000n });
    expect(ranges.sort((a, b) => Number(a[0] - b[0]))).toEqual([
      [1_000n, 5_999n],
      [6_000n, 10_999n],
      [11_000n, 12_000n],
    ]);
  });

  test("a history longer than maxChunks, or a failing RPC, is not a verdict (ok: false)", async () => {
    const { client } = fake([], 1_000_000n);
    expect(await readRevokedBuilders(client, { badge: BADGE, registry: REG, fromBlock: 0n, maxChunks: 10 })).toMatchObject({ ok: false });
    const broken: LogReader = { getBlockNumber: async () => 10n, getLogs: async () => Promise.reject(new Error("range too large\nmore")) };
    expect(await readRevokedBuilders(broken, { badge: BADGE, registry: REG, fromBlock: 0n })).toEqual({ ok: false, error: "range too large" });
  });

  test("resumes from a checkpoint: reads only the blocks after it and keeps its logs", async () => {
    const { client, ranges } = fake([
      { address: REG, block: 11_000n, args: { id: 8n, active: true } },
      { address: BADGE, block: 11_500n, args: { builderId: 9n, serial: 5n } },
    ]);
    const prior = {
      chainId: 5042, badge: BADGE, registry: REG, toBlock: 10_000n,
      revokes: [{ builderId: 7, block: 1_500n, index: 0 }, { builderId: 8, block: 6_000n, index: 0 }],
      statuses: [],
    };
    const r = await readRevokedBuilders(client, { badge: BADGE, registry: REG, fromBlock: 1_000n, chainId: 5042, prior, maxChunks: 1 });
    expect(ranges).toEqual([[10_001n, 12_000n]]);
    expect(r.ok && [...r.revoked].sort()).toEqual([7, 9]);
    expect(r.ok && r.checkpoint.toBlock).toBe(12_000n);
    // A checkpoint of another badge, registry or chain is ignored: full read from the deploy block.
    for (const other of [{ ...prior, badge: REG }, { ...prior, registry: BADGE }, { ...prior, chainId: 5042002 }]) {
      const f = fake([]);
      await readRevokedBuilders(f.client, { badge: BADGE, registry: REG, fromBlock: 1_000n, chainId: 5042, prior: other });
      expect(f.ranges[0]).toEqual([1_000n, 5_999n]);
    }
    // A head behind the checkpoint (a lagging RPC) keeps the checkpoint's block.
    const lag = fake([], 9_000n);
    const l = await readRevokedBuilders(lag.client, { badge: BADGE, registry: REG, fromBlock: 1_000n, chainId: 5042, prior });
    expect(lag.ranges).toEqual([]);
    expect(l.ok && l.checkpoint.toBlock).toBe(10_000n);
  });

  test("checkpoint JSON round-trips and is refused for another deployment or when malformed", () => {
    const c = {
      chainId: 5042, badge: BADGE, registry: REG, toBlock: 10_000n,
      revokes: [{ builderId: 7, block: 1_500n, index: 2 }],
      statuses: [{ builderId: 7, active: false, block: 1_500n, index: 3 }],
    };
    const json = JSON.parse(JSON.stringify(checkpointToJson(c)));
    const want = { chainId: 5042, badge: BADGE, registry: REG };
    expect(checkpointFromJson(json, want)).toEqual(c);
    expect(checkpointFromJson(json, { ...want, badge: REG })).toBeNull();
    expect(checkpointFromJson(json, { ...want, chainId: 1 })).toBeNull();
    expect(checkpointFromJson({ ...json, toBlock: "-1" }, want)).toBeNull();
    expect(checkpointFromJson({ ...json, revokes: [{ builderId: 7, block: "20000", index: 0 }] }, want)).toBeNull(); // after toBlock
    expect(checkpointFromJson({ ...json, statuses: [{ builderId: 7, active: "yes", block: "1", index: 0 }] }, want)).toBeNull();
    expect(checkpointFromJson(null, want)).toBeNull();
  });

  test("blockRanges", () => {
    expect(blockRanges(0n, 9n, 5n)).toEqual([
      [0n, 4n],
      [5n, 9n],
    ]);
    expect(blockRanges(5n, 4n, 5n)).toEqual([]);
  });
});

describe("readRevokedBuilders pacing (the admin page, Arc mainnet rate limit)", () => {
  test("parallel: 1 never has more than one range (two getLogs) in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const client: LogReader = {
      getBlockNumber: async () => 30_000n,
      getLogs: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        return [];
      },
    };
    const r = await readRevokedBuilders(client, { badge: BADGE, registry: REG, fromBlock: 0n, parallel: 1 });
    expect(r.ok).toBe(true);
    expect(peak).toBe(2);
  });
  test("the admin page reads one range at a time", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../components/admin/AdminApp.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/readRevokedBuilders\(buildersClient\(\)[\s\S]{0,400}?parallel: 1,/);
  });
});

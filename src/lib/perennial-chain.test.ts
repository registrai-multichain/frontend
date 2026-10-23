import { describe, expect, test } from "vitest";
import { DISCOVERY_CHUNKS_PER_PASS, discoverMarkets, overviewRefreshMs, seedFromSnapshot, subjectsFor, withWonderFallback } from "./perennial-chain";
import { PERENNIAL } from "./perennial-network";
import live from "./live-data.json";
import { sourceKey } from "./wonder";

describe("market subjects", () => {
  test("readOverview skips subjectOf without WonderEscrow", async () => {
    let called = 0;
    const client = { readContract: async () => { called++; throw new Error("should not be called"); } };
    const out = await subjectsFor(client as never, { contracts: { MarketsPerennial: "0x00000000000000000000000000000000000000a1", WonderEscrow: null } } as never, [`0x${"ab".repeat(32)}`], {});
    expect(out).toEqual({});
    expect(called).toBe(0);
  });
});


describe("wonder market discovery", () => {
  const seed = BigInt((live as { atlas: { lastScannedBlock: string } }).atlas.lastScannedBlock);
  const markets = (live as { atlas: { markets: string } }).atlas.markets;
  const WID = `0x${"cd".repeat(32)}`;
  test("finds wonder markets created before the build-time snapshot (sync only records MarketCreated)", async () => {
    const at = seed - 50n;
    const client = {
      async getLogs(a: { event?: { name: string }; events?: { name: string }[]; fromBlock: bigint; toBlock: bigint }) {
        const names = a.events ? a.events.map((e) => e.name) : [a.event!.name];
        if (!names.includes("WonderMarketCreated") || at < a.fromBlock || at > a.toBlock) return [];
        return [{ topics: ["0x00", WID], eventName: "WonderMarketCreated", args: { source: "github:acme/tool" }, blockNumber: at }];
      },
    };
    const d = { ...PERENNIAL, contracts: { ...PERENNIAL.contracts, MarketsPerennial: markets, WonderEscrow: "0x00000000000000000000000000000000000000e5" }, deployBlock: seed - 100n };
    const out = await discoverMarkets(client as never, d as never, seed + 10n);
    expect(out.ids).toContain(WID);
    expect(out.wonderSources[WID]).toBe("github:acme/tool");
  });
  // Launch-day UX (arc-78's report, 2026-09-28): the pages rendered nothing until two
  // full scans finished. Each pass now reads a few chunks of BOTH scans and returns;
  // the pages refresh quickly while `partial`, and the browser cursor carries on.
  test("a pass reads at most DISCOVERY_CHUNKS_PER_PASS chunks per scan and reports partial", async () => {
    let calls = 0;
    const client = { async getLogs() { calls++; return []; } };
    const head = 10_000_000n;
    const d = { ...PERENNIAL, contracts: { ...PERENNIAL.contracts, MarketsPerennial: "0x00000000000000000000000000000000000000a1", WonderEscrow: "0x00000000000000000000000000000000000000e5" }, deployBlock: head - 1_000_000n };
    const out = await discoverMarkets(client as never, d as never, head);
    expect(DISCOVERY_CHUNKS_PER_PASS).toBeLessThanOrEqual(10);
    expect(calls).toBeLessThanOrEqual(2 * DISCOVERY_CHUNKS_PER_PASS);
    expect(out.partial).toBe(true);
  });

  test("the wonder scan advances even when the builder scan hits an RPC error", async () => {
    const at = 1_000n;
    const client = {
      async getLogs(a: { event: { name: string }; fromBlock: bigint; toBlock: bigint }) {
        if (a.event.name === "MarketCreated") throw new Error("429");
        if (at < a.fromBlock || at > a.toBlock) return [];
        return [{ topics: ["0x00", WID], args: { source: "github:acme/tool" }, blockNumber: at }];
      },
    };
    const d = { ...PERENNIAL, contracts: { ...PERENNIAL.contracts, MarketsPerennial: "0x00000000000000000000000000000000000000a2", WonderEscrow: "0x00000000000000000000000000000000000000e5" }, deployBlock: 500n };
    const out = await discoverMarkets(client as never, d as never, 20_000n);
    expect(out.wonderSources[WID]).toBe("github:acme/tool");
    expect(out.partial).toBe(true);
  });

  test("the build-time snapshot seeds wonder markets and their cursor too", () => {
    const mp = "0x00000000000000000000000000000000000000A3";
    const atlas = { markets: mp.toLowerCase(), lastScannedBlock: "900", marketToBuilder: { "0xaa": 1 }, wonderMarkets: { [WID]: "github:acme/tool" }, wonderLastScannedBlock: "880" };
    const s = seedFromSnapshot(atlas, [], mp, true);
    expect(s.scannedTo).toBe(900n);
    expect(s.wonderScannedTo).toBe(880n);
    expect(s.wonder[WID]).toBe("github:acme/tool");
    expect(s.ids).toEqual(expect.arrayContaining(["0xaa", WID]));
    expect(seedFromSnapshot(atlas, [], "0x00000000000000000000000000000000000000ff", true).ids).toEqual([]);
    expect(seedFromSnapshot(atlas, [], mp, false).ids).toEqual([]);
  });

  test("a wonder market whose subject read failed keeps its disclosure", () => {
    const out = withWonderFallback({}, [WID as never], { [WID]: "github:acme/tool" });
    expect(out[WID]).toEqual({ kind: 2, builderId: 0n, sourceKey: sourceKey("github:acme/tool"), bound: undefined, source: "github:acme/tool" });
  });
});

describe("overview refresh", () => {
  test("refreshes every couple of seconds while discovery is partial, every 30 s once complete", () => {
    expect(overviewRefreshMs({ discovery: { partial: true } })).toBeLessThanOrEqual(3_000);
    expect(overviewRefreshMs({ discovery: { partial: false } })).toBe(30_000);
    expect(overviewRefreshMs(undefined)).toBe(30_000);
  });
});

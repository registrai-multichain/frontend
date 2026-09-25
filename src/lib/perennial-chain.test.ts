import { describe, expect, test } from "vitest";
import { discoverMarkets, subjectsFor, withWonderFallback } from "./perennial-chain";
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
  test("a wonder market whose subject read failed keeps its disclosure", () => {
    const out = withWonderFallback({}, [WID as never], { [WID]: "github:acme/tool" });
    expect(out[WID]).toEqual({ kind: 2, builderId: 0n, sourceKey: sourceKey("github:acme/tool"), bound: undefined, source: "github:acme/tool" });
  });
});

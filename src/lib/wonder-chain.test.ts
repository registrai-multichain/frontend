import { describe, expect, test } from "vitest";
import type { Address, Hex } from "viem";
import { readExpiry, readMarketSubjects, readWonderStatus, type WonderReader } from "./wonder-chain";
import { sourceKey } from "./wonder";

const W = { markets: "0x00000000000000000000000000000000000000a1" as Address, escrow: "0x00000000000000000000000000000000000000e5" as Address };
const A = "github:acme/tool";
const B = "github:bad/read";

function fake(values: Record<string, unknown>, fail: (fn: string, args: readonly unknown[]) => boolean = () => false): WonderReader {
  return {
    async readContract({ functionName, args = [] }) {
      if (fail(functionName, args)) throw new Error("rpc down");
      const k = `${functionName}:${args.map(String).join(",")}`;
      if (!(k in values)) throw new Error(`no stub ${k}`);
      return values[k];
    },
  };
}

describe("readWonderStatus", () => {
  const ka = sourceKey(A);
  const values = {
    [`nominated:${ka}`]: true,
    [`escrowOf:${ka}`]: 7_000_000n,
    [`releasedTo:${ka}`]: 0n,
    [`pendingRelease:${ka}`]: [7n, 3n, 1_790_000_000n],
    [`firstCreditAt:${ka}`]: 1000n,
  };
  test("reads every field per source", async () => {
    const out = await readWonderStatus(fake(values), W, [A]);
    expect(out[A]).toEqual({ source: A, key: ka, nominated: true, escrow: 7_000_000n, releasedTo: 0,
      pending: { builderId: 7, projectId: 3, readyAt: 1_790_000_000 }, firstCreditAt: 1000 });
  });
  test("no pending release reads as null", async () => {
    const out = await readWonderStatus(fake({ ...values, [`pendingRelease:${ka}`]: [0n, 0n, 0n] }), W, [A]);
    expect(out[A].pending).toBeNull();
  });
  test("readWonderStatus drops failed reads", async () => {
    const out = await readWonderStatus(fake(values, (_fn, args) => args[0] === sourceKey(B)), W, [A, B]);
    expect(Object.keys(out)).toEqual([A]);
  });
});

describe("readExpiry", () => {
  test("seconds, or null on failure", async () => {
    expect(await readExpiry(fake({ "EXPIRY:": 15_552_000n }), W)).toBe(15_552_000);
    expect(await readExpiry(fake({}, () => true), W)).toBeNull();
  });
});

describe("readMarketSubjects", () => {
  const id = `0x${"ab".repeat(32)}` as Hex;
  test("subject + bound, with the wonder source attached", async () => {
    const v = { [`subjectOf:${id}`]: [{ kind: 2, builderId: 0n, sourceKey: sourceKey(A) }, true] };
    const out = await readMarketSubjects(fake(v), W.markets, [id], { [id.toLowerCase()]: A });
    expect(out[id.toLowerCase()]).toEqual({ kind: 2, builderId: 0n, sourceKey: sourceKey(A), bound: true, source: A });
  });
  test("a failed read is absent", async () => {
    expect(await readMarketSubjects(fake({}, () => true), W.markets, [id], {})).toEqual({});
  });
});

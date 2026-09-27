import { describe, expect, test } from "vitest";
import { readNominations, type NominationsReader } from "./nominations";

const N = "0x6d87c64cd64e5c8b3204fcbfd28720b27c80f354" as const;

function fakeReader(rows: { source: string; active: boolean }[], pageSize = 2): NominationsReader & { calls: number } {
  const r = {
    calls: 0,
    async readContract({ functionName, args }: { functionName: string; args?: readonly unknown[] }) {
      r.calls++;
      if (functionName === "count") return BigInt(rows.length);
      if (functionName === "page") {
        const start = Number(args![0]);
        const n = Math.min(Number(args![1]), pageSize);
        const slice = rows.slice(start, start + n);
        return [slice.map((x) => x.source), slice.map((x) => ({ active: x.active, profileHash: `0x${"00".repeat(32)}`, by: N, at: 1_800_000_000n }))];
      }
      throw new Error(functionName);
    },
  };
  return r;
}

describe("readNominations", () => {
  test("reads every page into a map by source, active and not", async () => {
    const reader = fakeReader([
      { source: "domain:arctools.fun", active: true },
      { source: "domain:www.myarcade.fun", active: false },
      { source: "github:acme/tool", active: true },
    ]);
    const m = await readNominations(reader, N, 2);
    expect([...m.keys()]).toEqual(["domain:arctools.fun", "domain:www.myarcade.fun", "github:acme/tool"]);
    expect(m.get("domain:arctools.fun")).toMatchObject({ active: true, at: 1_800_000_000 });
    expect(m.get("domain:www.myarcade.fun")?.active).toBe(false);
  });

  test("an empty list costs one call", async () => {
    const reader = fakeReader([]);
    expect((await readNominations(reader, N)).size).toBe(0);
    expect(reader.calls).toBe(1);
  });
});

describe("profileHash", () => {
  const base = {
    source: "domain:arctools.fun", name: "ArcTools", website: "https://arctools.fun",
    deployers: [{ address: "0x408c3d3fd36fdf84888f343417787d8710e76fe8", note: "private" }], contracts: [], metrics: ["x-posts" as const],
    x: "@ArcToolsBackup", redFlags: ["secret"], declaredBy: "0xb7", declaredAt: "2026-09-27T12:00:00.000Z",
  };

  test("is the same for the same public profile, whatever the key order or private fields", async () => {
    const { profileHash } = await import("./nominations");
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as typeof base;
    expect(profileHash(base)).toBe(profileHash(reordered));
    expect(profileHash({ ...base, redFlags: ["other"], deployers: [{ address: base.deployers[0].address, note: "changed" }] })).toBe(profileHash(base));
  });

  test("changes with any public field, and is zero without a profile", async () => {
    const { profileHash } = await import("./nominations");
    expect(profileHash({ ...base, x: "@other" })).not.toBe(profileHash(base));
    expect(profileHash(null)).toBe(`0x${"00".repeat(32)}`);
  });
});

describe("nominationTx", () => {
  test("encodes nominate with the hash, and unnominate", async () => {
    const { nominationTx, nominationsAbi } = await import("./nominations");
    const { decodeFunctionData } = await import("viem");
    const h = `0x${"ab".repeat(32)}` as const;
    const on = nominationTx(N, "domain:arctools.fun", true, h);
    expect(on.to).toBe(N);
    expect(decodeFunctionData({ abi: nominationsAbi, data: on.data as `0x${string}` })).toEqual({ functionName: "nominate", args: ["domain:arctools.fun", h] });
    const off = nominationTx(N, "domain:arctools.fun", false);
    expect(decodeFunctionData({ abi: nominationsAbi, data: off.data as `0x${string}` })).toEqual({ functionName: "unnominate", args: ["domain:arctools.fun"] });
  });
});

describe("a list item hashes like the stored profile once its status is dropped", () => {
  test("profileOfListItem(item) hashes as the profile the nomination anchored", async () => {
    const { profileHash } = await import("./nominations");
    const { profileOfListItem } = await import("./projects");
    const profile = {
      source: "domain:arctools.fun", name: "ArcTools", website: "https://arctools.fun",
      deployers: [], contracts: [], metrics: [] as never[], declaredBy: "0xb7", declaredAt: "2026-09-27T12:00:00.000Z",
    };
    const item = { ...profile, status: "invited" as const };
    expect(profileHash(profileOfListItem(item))).toBe(profileHash(profile));
    expect(profileHash(item)).not.toBe(profileHash(profile));
  });
});

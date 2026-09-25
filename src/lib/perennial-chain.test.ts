import { describe, expect, test } from "vitest";
import { subjectsFor } from "./perennial-chain";

describe("market subjects", () => {
  test("readOverview skips subjectOf without WonderEscrow", async () => {
    let called = 0;
    const client = { readContract: async () => { called++; throw new Error("should not be called"); } };
    const out = await subjectsFor(client as never, { contracts: { MarketsPerennial: "0x00000000000000000000000000000000000000a1", WonderEscrow: null } } as never, [`0x${"ab".repeat(32)}`], {});
    expect(out).toEqual({});
    expect(called).toBe(0);
  });
});

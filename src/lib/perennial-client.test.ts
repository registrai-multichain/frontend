import { describe, expect, test } from "vitest";
import { perennialClient } from "./perennial-client";

// readOverview fires ~16 reads at once; Arc's RPC answers a burst like that with
// 429 "rate limit exceeded" and the markets page never loads. Concurrent reads
// must fold into one Multicall3 eth_call.
describe("perennialClient", () => {
  test("aggregates concurrent contract reads through Multicall3", () => {
    const c = perennialClient();
    expect(c.batch?.multicall).toBeTruthy();
    expect(c.chain?.contracts?.multicall3?.address?.toLowerCase()).toBe("0xca11bde05977b3631167028862be2a173976ca11");
  });

  test("is one shared client", () => {
    expect(perennialClient()).toBe(perennialClient());
  });
});

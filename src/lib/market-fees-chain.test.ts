import { describe, expect, test } from "vitest";
import { BaseError, ContractFunctionRevertedError, type Address, type PublicClient } from "viem";
import { readFeeModel, readHolderSettlement, readMarketSettlement } from "./market-fees-chain";

const ADDR = "0x0000000000000000000000000000000000000001" as Address;
const ID = `0x${"11".repeat(32)}` as const;

const revert = (fn: string) =>
  new BaseError("call reverted", { cause: new ContractFunctionRevertedError({ abi: [], functionName: fn }) });

/** A fake client answering the listed views and reverting on everything else. */
function fakeClient(answers: Record<string, bigint>, calls: string[] = []) {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      calls.push(functionName);
      if (functionName in answers) return answers[functionName];
      throw revert(functionName);
    },
  } as unknown as PublicClient;
}

describe("readFeeModel capability probing", () => {
  test("v3 Perennial with the BuilderFund: BUILDER_SHARE_BPS, never the legacy fee reads", async () => {
    const calls: string[] = [];
    const m = await readFeeModel(
      fakeClient({ TRADE_FEE_BPS: 100n, CREATOR_SHARE_BPS: 3_000n, AGENT_SHARE_BPS: 2_000n, BUILDER_SHARE_BPS: 5_000n }, calls),
      ADDR,
      "perennial",
    );
    expect(m).toMatchObject({ kind: "trade", tradeFeeBps: 100n, payeeShareBps: 5_000n, payee: "builder" });
    expect(calls).not.toContain("COMMONS_SHARE_BPS");
    expect(calls).not.toContain("FEE_BPS_TOTAL");
    expect(calls).not.toContain("creatorBps");
  });
  test("v3 Perennial from before the BuilderFund: COMMONS_SHARE_BPS -> the commons payee", async () => {
    const m = await readFeeModel(
      fakeClient({ TRADE_FEE_BPS: 100n, CREATOR_SHARE_BPS: 3_000n, AGENT_SHARE_BPS: 2_000n, COMMONS_SHARE_BPS: 5_000n }),
      ADDR,
      "perennial",
    );
    expect(m).toMatchObject({ kind: "trade", payeeShareBps: 5_000n, payee: "commons" });
  });
  test("v3 MarketsV4 names the 50% leg TREASURY_SHARE_BPS", async () => {
    const calls: string[] = [];
    const m = await readFeeModel(fakeClient({ TRADE_FEE_BPS: 100n, TREASURY_SHARE_BPS: 5_000n }, calls), ADDR, "v4");
    expect(calls).toContain("TREASURY_SHARE_BPS");
    expect(calls).not.toContain("BUILDER_SHARE_BPS");
    expect(calls).not.toContain("COMMONS_SHARE_BPS");
    expect(m).toMatchObject({ kind: "trade", creatorShareBps: 3_000n, agentShareBps: 2_000n, payee: "treasury" });
  });
  test("legacy testnet Perennial: TRADE_FEE_BPS reverts -> 70 bps via the old reads", async () => {
    const m = await readFeeModel(fakeClient({ FEE_BPS_TOTAL: 70n, creatorBps: 20n, treasuryBps: 35n, agentBps: 15n }), ADDR, "perennial");
    expect(m).toEqual({ kind: "legacy", tradeFeeBps: 70n, split: { creatorBps: 20n, agentBps: 15n, payeeBps: 35n }, payee: "commons" });
  });
  test("legacy testnet MarketsV4 reads its immutables", async () => {
    const m = await readFeeModel(fakeClient({ FEE_BPS_TOTAL: 70n, FEE_BPS_CREATOR: 40n, FEE_BPS_AGENT: 20n, FEE_BPS_TREASURY: 10n }), ADDR, "v4");
    expect(m).toEqual({ kind: "legacy", tradeFeeBps: 70n, split: { creatorBps: 40n, agentBps: 20n, payeeBps: 10n }, payee: "treasury" });
  });
  test("neither -> unknown", async () => {
    expect(await readFeeModel(fakeClient({}), ADDR, "perennial")).toEqual({ kind: "unknown" });
  });
  test("transport errors are not mistaken for a missing view", async () => {
    const client = { readContract: async () => { throw new Error("fetch failed"); } } as unknown as PublicClient;
    await expect(readFeeModel(client, ADDR, "perennial")).rejects.toThrow("fetch failed");
  });
});

describe("settlement views", () => {
  test("per phase, and undefined where the deployment lacks the view", async () => {
    const c = fakeClient({ collateralOf: 7n, agentEscrow: 3n, voidTraderPool: 5n, netCost: 2n, redeemable: 1n });
    expect(await readMarketSettlement(c, ADDR, ID, 0)).toEqual({ collateral: 7n, agentEscrow: 3n });
    expect(await readMarketSettlement(c, ADDR, ID, 1)).toEqual({});
    expect(await readMarketSettlement(c, ADDR, ID, 2)).toEqual({ voidTraderPool: 5n, voidNetCostTotal: undefined });
    expect(await readHolderSettlement(c, ADDR, ID, ADDR, 0)).toEqual({ netCost: 2n });
    expect(await readHolderSettlement(c, ADDR, ID, ADDR, 1)).toEqual({ netCost: 2n, redeemable: 1n, claimableLP: undefined });
  });
});

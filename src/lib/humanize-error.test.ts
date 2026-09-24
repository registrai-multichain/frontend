import { describe, expect, test } from "vitest";
import { BaseError, encodeErrorResult, parseAbi } from "viem";
import { decodeRevertData, humanizeError, revertName } from "./humanize-error";

const errs = parseAbi([
  "error SettlementPending()",
  "error NotVoidable()",
  "error FeedUnsettleable()",
  "error AgentNotApproved()",
  "error ResolverNotApproved()",
  "error BuilderInactive()",
  "error AgentNotRegistered()",
  "error InsufficientShares()",
  "error NotResolved()",
  "error NoLPShares()",
  "error LiquidityTooLow()",
  "error SelfResolvedFeed()",
  "error ReserveDepleted()",
]);

describe("revert decoding", () => {
  test.each([
    "SettlementPending",
    "NotVoidable",
    "FeedUnsettleable",
    "AgentNotApproved",
    "ResolverNotApproved",
    "BuilderInactive",
    "AgentNotRegistered",
    "InsufficientShares",
    "NotResolved",
    "NoLPShares",
    "LiquidityTooLow",
    "SelfResolvedFeed",
    "ReserveDepleted",
  ] as const)("%s decodes and has a human message", (name) => {
    const data = encodeErrorResult({ abi: errs, errorName: name });
    expect(decodeRevertData(data)).toBe(name);
    const e = new BaseError("call failed", { cause: Object.assign(new Error("reverted"), { data }) as never });
    expect(revertName(e)).toBe(name);
    const msg = humanizeError(e);
    expect(msg).not.toMatch(/reverted onchain/);
    expect(msg.length).toBeGreaterThan(10);
  });

  test("names in a flattened wallet message still map", () => {
    expect(humanizeError(new Error('execution reverted: custom error SettlementPending()'))).toContain("finalized attestation");
    expect(humanizeError(new Error("Error: NotVoidable()"))).toContain("can't be voided");
  });

  test("void copy never promises a refund", () => {
    expect(humanizeError(new Error("NotVoidable()"))).not.toMatch(/refund|money back/i);
  });

  test("mainnet copy has no faucet", () => {
    expect(humanizeError(new Error("insufficient funds for gas"), { testnet: false })).not.toContain("faucet");
    expect(humanizeError(new Error("insufficient funds for gas"))).toContain("faucet");
  });

  test("unknown data is not decoded", () => {
    expect(decodeRevertData("0xdeadbeef")).toBeUndefined();
    expect(decodeRevertData(undefined)).toBeUndefined();
  });
});

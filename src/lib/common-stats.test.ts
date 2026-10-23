import { describe, expect, test } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { ATTESTATION_EVENTS_ABI, DISPUTE_EVENTS_ABI, MARKET_EVENTS_ABI, REGISTRY_EVENTS_ABI, emptyStats, reduceLogs, type RawLog } from "./common-stats";

const V4 = "0xbdc4b03bf67b4ef70195b1862303ace61f0d77ce";
const ATT = "0x86df667e1cd560e39600827c4f4709b939f55d2b";
const DIS = "0xf62cd073f6748f56a0233c43c2ce02640faa75d8";
const REG = "0x52bb229697c552d8b8e01298525093572420a7eb";
const AGENT = "0x422700c9c549e055672fa670f4f0076c43c4ee36";
const ADDR = { marketsV4: V4, attestation: ATT, dispute: DIS, registry: REG, agent: AGENT } as const;
const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

function log(address: string, eventName: string, args: Record<string, unknown>, data: { types: { type: string }[]; values: unknown[] }, ts = 1000, block = 1): RawLog {
  const abi = { [V4]: MARKET_EVENTS_ABI, [ATT]: ATTESTATION_EVENTS_ABI, [DIS]: DISPUTE_EVENTS_ABI, [REG]: REGISTRY_EVENTS_ABI }[address]!;
  const topics = (encodeEventTopics as (p: unknown) => Hex[])({ abi, eventName, args });
  return { address, topics, data: encodeAbiParameters(data.types, data.values), blockNumber: `0x${block.toString(16)}`, blockTimestamp: `0x${ts.toString(16)}` };
}

describe("reduceLogs: market numbers", () => {
  test("counts rounds opened, settled and voided, and sums volume and the splitter's fees", () => {
    const logs = [
      log(V4, "MarketCreated", { marketId: id(1), creator: AGENT, feedId: id(9) }, { types: [{ type: "address" }, { type: "int256" }, { type: "uint8" }, { type: "uint256" }, { type: "uint256" }], values: [AGENT, 0n, 0, 300n, 5_000_000n] }),
      log(V4, "MarketCreated", { marketId: id(2), creator: AGENT, feedId: id(9) }, { types: [{ type: "address" }, { type: "int256" }, { type: "uint8" }, { type: "uint256" }, { type: "uint256" }], values: [AGENT, 0n, 0, 600n, 5_000_000n] }),
      log(V4, "Bought", { marketId: id(1), buyer: AGENT }, { types: [{ type: "uint8" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], values: [0, 10_000_000n, 1n, 100_000n] }),
      log(V4, "Sold", { marketId: id(1), seller: AGENT }, { types: [{ type: "uint8" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], values: [0, 1n, 4_000_000n, 40_000n] }),
      log(V4, "FeesPaid", { marketId: id(1) }, { types: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], values: [30_000n, 50_000n, 20_000n] }),
      log(V4, "Resolved", { marketId: id(1) }, { types: [{ type: "bool" }, { type: "int256" }], values: [true, 7n] }),
      log(V4, "MarketVoided", { marketId: id(2) }, { types: [], values: [] }),
      log(V4, "VoidFeesPaid", { marketId: id(2) }, { types: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }], values: [0n, 7_000n, 0n, "0x0000000000000000000000000000000000000000"] }),
      log(V4, "DustSwept", { marketId: id(1) }, { types: [{ type: "uint256" }], values: [3n] }),
    ];
    const s = reduceLogs(emptyStats(), logs, ADDR);
    expect(s.markets).toEqual({ opened: 2, settled: 1, voided: 1, trades: 2, volume: 14_000_000n, feesToSplitter: 57_003n });
  });
});

describe("reduceLogs: oracle health", () => {
  test("readings by our agent, challenges, rulings, open disputes, ruling time and slashes", () => {
    const logs = [
      log(ATT, "Attested", { attestationId: id(11), feedId: id(9), agent: AGENT }, { types: [{ type: "int256" }, { type: "bytes32" }, { type: "uint256" }], values: [5n, id(0), 2000n] }),
      log(ATT, "Attested", { attestationId: id(12), feedId: id(9), agent: "0x0000000000000000000000000000000000000001" }, { types: [{ type: "int256" }, { type: "bytes32" }, { type: "uint256" }], values: [5n, id(0), 2000n] }),
      log(DIS, "Challenged", { disputeId: id(21), attestationId: id(11), challenger: "0x0000000000000000000000000000000000000002" }, { types: [{ type: "uint256" }, { type: "bytes32" }], values: [2_000_000n, id(0)] }, 1_000),
      log(DIS, "Challenged", { disputeId: id(22), attestationId: id(11), challenger: "0x0000000000000000000000000000000000000002" }, { types: [{ type: "uint256" }, { type: "bytes32" }], values: [2_000_000n, id(0)] }, 1_100),
      log(DIS, "Resolved", { disputeId: id(21) }, { types: [{ type: "uint8" }], values: [1] }, 1_600),
      log(REG, "AgentSlashed", { feedId: id(9), agent: AGENT }, { types: [{ type: "uint256" }, { type: "address" }], values: [0n, "0x0000000000000000000000000000000000000002"] }),
    ];
    const s = reduceLogs(emptyStats(), logs, ADDR);
    expect(s.oracle.readings).toBe(1);
    expect(s.oracle.challenges).toBe(2);
    expect(s.oracle.valid).toBe(1);
    expect(s.oracle.invalid).toBe(0);
    expect(s.oracle.open).toEqual([id(22)]);
    expect(s.oracle.rulingSecsTotal).toBe(600);
    expect(s.oracle.ruled).toBe(1);
    expect(s.oracle.slashes).toBe(1);
  });

  test("a V4 'Resolved' is a market settling, never a dispute ruling (same event name)", () => {
    const logs = [log(V4, "Resolved", { marketId: id(1) }, { types: [{ type: "bool" }, { type: "int256" }], values: [false, 0n] })];
    const s = reduceLogs(emptyStats(), logs, ADDR);
    expect(s.markets.settled).toBe(1);
    expect(s.oracle.valid + s.oracle.invalid).toBe(0);
  });

  test("reducing in two batches gives the same totals as one", () => {
    const a = log(V4, "Bought", { marketId: id(1), buyer: AGENT }, { types: [{ type: "uint8" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], values: [0, 1_000_000n, 1n, 10_000n] });
    const once = reduceLogs(emptyStats(), [a, a], ADDR);
    const twice = reduceLogs(reduceLogs(emptyStats(), [a], ADDR), [a], ADDR);
    expect(twice.markets).toEqual(once.markets);
  });
});

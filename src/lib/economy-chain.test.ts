import { describe, expect, test } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Abi, type Address, type Log, type PublicClient } from "viem";
import { builderFundAbi, seasonPoolAbi } from "./abi";
import { LAUNCH_SCHEDULE } from "./builder-economy";
import {
  EMPTY_LEDGER,
  cursorMatches,
  decodeEconomyLogs,
  foldEconomyLogs,
  readBuilderEpochs,
  readEconomy,
  scanEconomy,
  seasonRewardsOf,
  type EconomyCursor,
} from "./economy-chain";

const FUND = "0x00000000000000000000000000000000000000f1" as Address;
const POOL = "0x00000000000000000000000000000000000000b2" as Address;
const PAYOUT = "0x00000000000000000000000000000000000000aa" as Address;
const U = 1_000_000n;

function log(abi: Abi, address: Address, eventName: string, args: Record<string, unknown>, blockNumber: bigint, logIndex = 0): Log {
  const ev = abi.find((x) => x.type === "event" && x.name === eventName) as Extract<Abi[number], { type: "event" }>;
  const topics = encodeEventTopics({ abi: [ev], eventName, args } as never);
  const data = encodeAbiParameters(
    ev.inputs.filter((i) => !i.indexed),
    ev.inputs.filter((i) => !i.indexed).map((i) => args[i.name!]),
  );
  return { address, topics, data, blockNumber, logIndex } as unknown as Log;
}
const F = (name: string, args: Record<string, unknown>, block: bigint, i = 0) => log(builderFundAbi as Abi, FUND, name, args, block, i);
const S = (name: string, args: Record<string, unknown>, block: bigint, i = 0) => log(seasonPoolAbi as Abi, POOL, name, args, block, i);

describe("the event ledger", () => {
  const logs = [
    F("IncomeCredited", { epoch: 0n, builderId: 7n, amount: 5n * U }, 10n),
    F("IncomeCredited", { epoch: 0n, builderId: 7n, amount: 3n * U }, 11n),
    F("IncomeCredited", { epoch: 1n, builderId: 9n, amount: 2n * U }, 12n),
    F("ScheduleSet", { effectiveEpoch: 0n }, 1n),
    S("Funded", { funder: FUND, amount: 4n * U, unallocated: 4n * U }, 20n),
    F("Claimed", { epoch: 0n, builderId: 7n, gross: 8n * U, tax: 0n, fee: 80_000n, net: 7_920_000n, payout: PAYOUT }, 20n, 1),
    F("FrozenSwept", { epoch: 1n, builderId: 9n, gross: 2n * U }, 21n),
    S("SeasonPublished", { seasonId: 1n, root: `0x${"ab".repeat(32)}`, total: 3n * U, deadline: 99n }, 30n),
    S("SeasonClaimed", { seasonId: 1n, builderId: 7n, amount: 600_000n, payout: PAYOUT }, 31n),
    S("SeasonReclaimed", { seasonId: 1n, amount: 2_400_000n }, 40n),
  ];

  test("decodes fund + pool logs in chain order and skips foreign addresses", () => {
    const foreign = { ...logs[0], address: "0x0000000000000000000000000000000000000001" } as Log;
    const ev = decodeEconomyLogs([...logs, foreign], FUND, POOL);
    expect(ev).toHaveLength(logs.length);
    expect(ev[0].eventName).toBe("ScheduleSet"); // block 1 sorts first
    expect(ev.map((e) => e.eventName).slice(-3)).toEqual(["SeasonPublished", "SeasonClaimed", "SeasonReclaimed"]);
  });

  test("folds income, claims, sweeps, schedules and seasons", () => {
    const l = foldEconomyLogs(EMPTY_LEDGER, decodeEconomyLogs(logs, FUND, POOL));
    expect(l.income).toEqual({ "7": { "0": "8000000" }, "9": { "1": "2000000" } });
    expect(l.claims["7"]["0"]).toEqual({ gross: "8000000", tax: "0", fee: "80000", net: "7920000", payout: PAYOUT.toLowerCase() });
    expect(l.swept).toEqual({ "9": { "1": "2000000" } });
    expect(l.schedules).toEqual(["0"]);
    expect(l.funded).toBe("4000000");
    expect(l.seasons["1"]).toEqual({ root: `0x${"ab".repeat(32)}`, total: "3000000", deadline: "99", claimed: { "7": "600000" }, reclaimed: "2400000" });
    expect(seasonRewardsOf(l, 7)).toEqual([{ seasonId: "1", amount: 600_000n }]);
    expect(seasonRewardsOf(l, 9)).toEqual([]);
    expect(seasonRewardsOf(null, 7)).toEqual([]);
  });

  test("folding is incremental: two halves == all at once, and the input is not mutated", () => {
    const ev = decodeEconomyLogs(logs, FUND, POOL);
    const whole = foldEconomyLogs(EMPTY_LEDGER, ev);
    const half = foldEconomyLogs(EMPTY_LEDGER, ev.slice(0, 4));
    const snapshot = JSON.stringify(half);
    expect(foldEconomyLogs(half, ev.slice(4))).toEqual(whole);
    expect(JSON.stringify(half)).toBe(snapshot);
    expect(EMPTY_LEDGER.income).toEqual({});
  });

  test("a cursor for another chain, fund or pool is not trusted", () => {
    const c: EconomyCursor = { chainId: 5, fund: FUND, pool: POOL, scannedTo: "9", ledger: EMPTY_LEDGER };
    expect(cursorMatches(c, 5, FUND, POOL)).toBe(true);
    expect(cursorMatches({ ...c, fund: FUND.toUpperCase().replace("0X", "0x") }, 5, FUND, POOL)).toBe(true);
    expect(cursorMatches(c, 6, FUND, POOL)).toBe(false);
    expect(cursorMatches(c, 5, POOL, POOL)).toBe(false);
    expect(cursorMatches(undefined, 5, FUND, POOL)).toBe(false);
  });

  test("scanEconomy: chunked, stops at the first failed chunk, resumes from its cursor", async () => {
    const calls: [bigint, bigint][] = [];
    const client = {
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        calls.push([fromBlock, toBlock]);
        if (fromBlock >= 10_001n) throw new Error("rate limited");
        return logs.filter((l) => l.blockNumber! >= fromBlock && l.blockNumber! <= toBlock);
      },
    } as unknown as PublicClient;
    const start: EconomyCursor = { chainId: 1, fund: FUND, pool: POOL, scannedTo: "0", ledger: EMPTY_LEDGER };
    const r = await scanEconomy(client, start, 12_000n);
    expect(calls[0]).toEqual([1n, 5_000n]);
    expect(r.cursor.scannedTo).toBe("10000");
    expect(r.partial).toBe(true);
    expect(r.cursor.ledger.income["7"]["0"]).toBe("8000000");
  });
});

/** A fake fund answering the views readEconomy / readBuilderEpochs use. */
function fakeFund(state: { epoch: bigint; income: Record<string, bigint>; claimed: Set<string> }) {
  const schedule = LAUNCH_SCHEDULE.map((b) => ({ upTo: b.upTo, rateBps: b.rateBps }));
  return {
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly bigint[] }) => {
      switch (functionName) {
        case "currentEpoch": return state.epoch;
        case "START": return 1_000n;
        case "EPOCH_LENGTH": return 100n;
        case "outstanding": return 42n;
        case "scheduleCount": return 2n;
        case "scheduleFor": return schedule;
        case "scheduleAt": return args![0] === 1n ? [state.epoch + 2n, [{ upTo: (1n << 128n) - 1n, rateBps: 0 }]] : [0n, schedule];
        case "unallocated": return 7n;
        case "reserved": return 3n;
        case "incomeOf": return state.income[`${args![0]}:${args![1]}`] ?? 0n;
        case "claimed": return state.claimed.has(`${args![0]}:${args![1]}`);
        case "quote": {
          const g = state.income[`${args![0]}:${args![1]}`] ?? 0n;
          return [g, 0n, g / 100n, g - g / 100n];
        }
      }
      throw new Error(`unexpected ${functionName}`);
    },
  } as unknown as PublicClient;
}

describe("views", () => {
  test("readEconomy: current schedule, upcoming schedules, pool balances", async () => {
    const e = await readEconomy(fakeFund({ epoch: 3n, income: {}, claimed: new Set() }), FUND, POOL);
    expect(e.epoch).toBe(3n);
    expect(e.epochEndsAt).toBe(1_400n);
    expect(e.schedule).toEqual(LAUNCH_SCHEDULE);
    expect(e.upcoming).toEqual([{ effectiveEpoch: 5n, brackets: [{ upTo: (1n << 128n) - 1n, rateBps: 0 }] }]);
    expect([e.outstanding, e.unallocated, e.reserved]).toEqual([42n, 7n, 3n]);
  });

  test("readBuilderEpochs: current epoch estimated locally, past epochs from quote + claimed, swept from the ledger", async () => {
    const state = {
      epoch: 3n,
      income: { "3:7": 60_000n * U, "1:7": 800n * U, "0:7": 5n * U },
      claimed: new Set(["0:7"]),
    };
    const ledger = foldEconomyLogs(EMPTY_LEDGER, [{ eventName: "FrozenSwept", args: { epoch: 0n, builderId: 7n, gross: 5n * U } }]);
    const econ = await readEconomy(fakeFund(state), FUND, POOL);
    const rows = await readBuilderEpochs(fakeFund(state), econ, 7, 1_350n, ledger);
    expect(rows.map((r) => r.epoch)).toEqual([3n, 1n, 0n]); // epoch 2 had no income
    expect(rows[0]).toMatchObject({ gross: 60_000n * U, tax: 11_900n * U, fee: 481n * U, net: 47_619n * U, claimed: false, ended: false });
    expect(rows[1]).toMatchObject({ gross: 800n * U, claimed: false, ended: true });
    expect(rows[2]).toMatchObject({ claimed: true, swept: true });
  });
});

import { describe, expect, test } from "vitest";
import {
  MARKET_TABS, ROUNDS_TABS, holdingLabel, parseRoundsTab, tradeAmountOpts, isEnded, marketsForTab, parseMarketParam, parseSide, parseTab, potOf, ticketState,
  topBuilder, yesPct, type TicketInput,
} from "./perennial-view";

const E = 10n ** 18n;

describe("params", () => {
  test("tabs: known keys, else trending", () => {
    expect(MARKET_TABS.map((t) => t.label)).toEqual(["Trending", "Closing soon", "New", "Unclaimed projects", "Ended"]);
    expect(parseTab("unclaimed")).toBe("unclaimed");
    expect(parseTab("ENDED")).toBe("ended");
    expect(parseTab("featured")).toBe("trending");
    expect(parseTab(null)).toBe("trending");
  });
  test("market: a 32-byte hex id, lower-cased; anything else undefined", () => {
    const id = "0x" + "Ab".repeat(32);
    expect(parseMarketParam(id)).toBe(id.toLowerCase());
    expect(parseMarketParam("0x1234")).toBeUndefined();
    expect(parseMarketParam("<script>")).toBeUndefined();
    expect(parseMarketParam(null)).toBeUndefined();
  });
  test("side: no → No, anything else Yes", () => {
    expect(parseSide("no")).toBe("No");
    expect(parseSide("NO")).toBe("No");
    expect(parseSide("yes")).toBe("Yes");
    expect(parseSide(undefined)).toBe("Yes");
  });
});

describe("market figures", () => {
  test("ended keys", () => {
    expect(["resolved-yes", "resolved-no", "voided"].every((k) => isEnded(k as never))).toBe(true);
    expect(["trading", "waiting", "resolvable", "voidable", "closed-legacy", "loading"].some((k) => isEnded(k as never))).toBe(false);
  });
  test("yes chance from equal reserves is 50", () => {
    expect(yesPct({ yesReserve: 100n * E, noReserve: 100n * E })).toBe(50);
  });
  test("the pot is the collateral, else the seeded liquidity", () => {
    expect(potOf({ collateral: 7n, seeded: 5n })).toBe(7n);
    expect(potOf({ seeded: 5n })).toBe(5n);
  });
  test("holding label", () => {
    expect(holdingLabel({ yes: 1n, no: 0n })).toBe("You hold Yes");
    expect(holdingLabel({ yes: 0n, no: 2n })).toBe("You hold No");
    expect(holdingLabel({ yes: 1n, no: 2n })).toBe("You hold Yes and No");
    expect(holdingLabel({ yes: 0n, no: 0n })).toBeNull();
  });
  test("top builder earns the most this epoch; nobody earning → null", () => {
    const bs = [{ builderId: 1 }, { builderId: 2 }, { builderId: 3 }];
    expect(topBuilder(bs, (id) => (id === 2 ? 9n : 1n))?.builderId).toBe(2);
    expect(topBuilder(bs, () => 0n)).toBeNull();
  });
});

describe("marketsForTab", () => {
  const m = (id: string, o: Partial<{ createdAt: bigint; expiry: bigint; yesPct: number; canTrade: boolean; wonder: boolean; ended: boolean }>) => ({
    id, createdAt: 0n, expiry: 100n, yesPct: 50, canTrade: true, wonder: false, ended: false, ...o,
  });
  const all = [
    m("a", { yesPct: 90, createdAt: 3n, expiry: 300n }),
    m("b", { yesPct: 52, createdAt: 1n, expiry: 200n }),
    m("closed", { canTrade: false, createdAt: 5n, expiry: 50n }),
    m("won", { canTrade: false, ended: true, expiry: 40n }),
    m("w", { wonder: true, createdAt: 4n, expiry: 400n }),
    m("wEnded", { wonder: true, ended: true, canTrade: false, expiry: 30n }),
  ];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  test("trending: not ended; open first, closest to 50/50 first", () => {
    expect(ids(marketsForTab(all, "trending"))).toEqual(["w", "b", "a", "closed"]);
  });
  test("closing soon: not ended; open first, soonest expiry first", () => {
    expect(ids(marketsForTab(all, "closing"))).toEqual(["b", "a", "w", "closed"]);
  });
  test("new: not ended, newest first", () => {
    expect(ids(marketsForTab(all, "new"))).toEqual(["closed", "w", "a", "b"]);
  });
  test("unclaimed: wonder markets not ended, newest first", () => {
    expect(ids(marketsForTab(all, "unclaimed"))).toEqual(["w"]);
  });
  test("ended: settled or voided, latest expiry first", () => {
    expect(ids(marketsForTab(all, "ended"))).toEqual(["won", "wEnded"]);
  });
});

describe("ticketState", () => {
  const base: TicketInput = {
    writesEnabled: true, address: "0xabc", onChain: true, canTrade: true, ledgerBal: 5n,
    canResolve: false, canVoid: false, canRedeem: false, redeemable: 0n, canClaimLP: false, lp: 0n, yes: 0n, no: 0n,
  };
  test("paused beats everything", () => {
    expect(ticketState({ ...base, writesEnabled: false })).toBe("paused");
  });
  test("open market: connect, switch, fund, trade", () => {
    expect(ticketState({ ...base, address: undefined })).toBe("connect");
    expect(ticketState({ ...base, onChain: false })).toBe("switch");
    expect(ticketState({ ...base, ledgerBal: 0n })).toBe("fund");
    expect(ticketState(base)).toBe("trade");
  });
  test("undefined balance is not zero: no 'Add funds' flash while the account loads", () => {
    expect(ticketState({ ...base, ledgerBal: undefined })).toBe("trade");
  });
  test("closed market: settle, collect, closed", () => {
    const closed = { ...base, canTrade: false };
    expect(ticketState({ ...closed, canResolve: true })).toBe("settle");
    expect(ticketState({ ...closed, canVoid: true, address: undefined })).toBe("settle");
    expect(ticketState({ ...closed, canRedeem: true, redeemable: 3n })).toBe("collect");
    expect(ticketState({ ...closed, canClaimLP: true, lp: 1n })).toBe("collect");
    expect(ticketState({ ...closed, canRedeem: true, redeemable: 0n })).toBe("closed");
    expect(ticketState({ ...closed, canRedeem: true, redeemable: 3n, address: undefined })).toBe("connect");
    expect(ticketState(closed)).toBe("closed");
  });
});

describe("review fixes", () => {
  const base: TicketInput = {
    writesEnabled: true, address: "0xabc", onChain: true, canTrade: true, ledgerBal: 0n,
    canResolve: false, canVoid: false, canRedeem: false, redeemable: 0n, canClaimLP: false, lp: 0n, yes: 0n, no: 0n,
  };
  test("$0 to trade but holding shares: the trade form (so they can sell), not 'Add funds'", () => {
    expect(ticketState({ ...base, yes: 5n })).toBe("trade");
    expect(ticketState({ ...base, no: 1n })).toBe("trade");
    expect(ticketState(base)).toBe("fund");
  });
  test("a winner on another chain is asked to switch; a disconnected viewer of a settled market is asked to connect", () => {
    const settled = { ...base, canTrade: false, canRedeem: true, redeemable: 3n };
    expect(ticketState({ ...settled, onChain: false })).toBe("switch");
    expect(ticketState({ ...settled, address: undefined, redeemable: 0n })).toBe("connect");
    expect(ticketState({ ...base, canTrade: false, canClaimLP: true, address: undefined })).toBe("connect");
    expect(ticketState(settled)).toBe("collect");
  });
  test("amount limits: no cap until the balance is read; buy caps at the balance, sell at the shares", () => {
    expect(tradeAmountOpts("buy", undefined, 9n)).toEqual({ label: "amount" });
    expect(tradeAmountOpts("buy", 5n, 9n)).toEqual({ max: 5n, label: "amount" });
    expect(tradeAmountOpts("sell", undefined, 9n)).toEqual({ max: 9n, label: "share amount" });
  });
});

describe("rounds categories", () => {
  test("Price and Events; #events opens Events, anything else Price", () => {
    expect(ROUNDS_TABS.map((t) => t.label)).toEqual(["Price", "Events"]);
    expect(parseRoundsTab("#events")).toBe("events");
    expect(parseRoundsTab("events")).toBe("events");
    expect(parseRoundsTab("#price")).toBe("price");
    expect(parseRoundsTab("")).toBe("price");
    expect(parseRoundsTab(undefined)).toBe("price");
  });
});

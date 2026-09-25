import { describe, expect, test } from "vitest";
import type { Address, Hex } from "viem";
import { SESSION_GAS, SESSION_GAS_LOW, parseSession, sessionCovers, sessionStatus, storageKey, type LocalSession } from "./session";

const OWNER = "0x00000000000000000000000000000000000000aA" as Address;
const LOCAL: LocalSession = {
  pk: `0x${"11".repeat(32)}` as Hex,
  delegate: "0x00000000000000000000000000000000000000De" as Address,
  owner: OWNER,
  chainId: 5042002,
  expiry: 2_000,
};
const live = { spendLeft: 50_000_000n, expiry: 2_000, gas: SESSION_GAS };

describe("stored session", () => {
  test("round-trips; a different owner, chain or a malformed record is ignored", () => {
    const raw = JSON.stringify(LOCAL);
    expect(parseSession(raw, 5042002, OWNER)).toEqual(LOCAL);
    expect(parseSession(raw, 5042002, OWNER.toLowerCase() as Address)).toEqual(LOCAL);
    expect(parseSession(raw, 1, OWNER)).toBeUndefined();
    expect(parseSession(raw, 5042002, "0x00000000000000000000000000000000000000bB" as Address)).toBeUndefined();
    expect(parseSession(JSON.stringify({ ...LOCAL, pk: "0x12" }), 5042002, OWNER)).toBeUndefined();
    expect(parseSession("{not json", 5042002, OWNER)).toBeUndefined();
    expect(parseSession(null, 5042002, OWNER)).toBeUndefined();
  });

  test("storage key per chain and owner", () => {
    expect(storageKey(5042002, OWNER)).toBe("registrai.session.5042002.0x00000000000000000000000000000000000000aa");
  });
});

describe("session status", () => {
  test("none / pending / active / expired / spent / low gas", () => {
    expect(sessionStatus(undefined, live, 1_000)).toBe("none");
    expect(sessionStatus(LOCAL, undefined, 1_000)).toBe("pending");
    expect(sessionStatus(LOCAL, { ...live, expiry: 0 }, 1_000)).toBe("pending");
    expect(sessionStatus(LOCAL, live, 1_000)).toBe("active");
    expect(sessionStatus(LOCAL, live, 1_975)).toBe("expired");
    expect(sessionStatus(LOCAL, { ...live, spendLeft: 0n }, 1_000)).toBe("spent");
    expect(sessionStatus(LOCAL, { ...live, gas: SESSION_GAS_LOW - 1n }, 1_000)).toBe("low-gas");
  });

  test("what the session can carry", () => {
    expect(sessionCovers("active", live, "buy", 10_000_000n, 10_000_000n)).toBe(true);
    expect(sessionCovers("active", live, "buy", 60_000_000n, 99_000_000n)).toBe(false);
    expect(sessionCovers("active", live, "buy", 10_000_000n, 9_000_000n)).toBe(false);
    expect(sessionCovers("spent", { ...live, spendLeft: 0n }, "sell", 1n, 0n)).toBe(true);
    expect(sessionCovers("spent", { ...live, spendLeft: 0n }, "buy", 1n, 10n)).toBe(false);
    expect(sessionCovers("expired", live, "redeem", 0n, 0n)).toBe(false);
    expect(sessionCovers("low-gas", live, "sell", 1n, 0n)).toBe(false);
  });
});

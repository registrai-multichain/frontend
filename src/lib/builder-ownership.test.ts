import { describe, expect, test } from "vitest";
import { zeroAddress } from "viem";
import {
  RECOVERY_DELAY_S,
  formatCountdown,
  pendingFor,
  recoveriesFor,
  recoveryView,
  showFinishRecovery,
  transferTargetError,
  utcMinute,
} from "./builder-ownership";

const NEW = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const OWNER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

describe("recovery countdown", () => {
  const T = 1_800_000_000;
  test("none, waiting (owner may cancel), ready (anyone may finish)", () => {
    expect(RECOVERY_DELAY_S).toBe(604_800);
    expect(recoveryView(null, T)).toEqual({ kind: "none" });
    expect(recoveryView({ newOwner: zeroAddress, readyAt: 0 }, T)).toEqual({ kind: "none" });
    expect(recoveryView({ newOwner: NEW, readyAt: T + RECOVERY_DELAY_S }, T)).toEqual({ kind: "waiting", newOwner: NEW, readyAt: T + RECOVERY_DELAY_S, secondsLeft: RECOVERY_DELAY_S });
    expect(recoveryView({ newOwner: NEW, readyAt: T + 1 }, T + 0.9)).toMatchObject({ kind: "waiting", secondsLeft: 1 });
    // finishRecovery requires block.timestamp >= readyAt
    expect(recoveryView({ newOwner: NEW, readyAt: T }, T)).toEqual({ kind: "ready", newOwner: NEW, readyAt: T });
    expect(recoveryView({ newOwner: NEW, readyAt: T }, T + 99)).toMatchObject({ kind: "ready" });
  });

  test("formatCountdown", () => {
    expect(formatCountdown(RECOVERY_DELAY_S)).toBe("7d 0h");
    expect(formatCountdown(RECOVERY_DELAY_S - 1)).toBe("6d 23h");
    expect(formatCountdown(5 * 3600 + 4 * 60 + 9)).toBe("5h 04m");
    expect(formatCountdown(3 * 60 + 5)).toBe("3m 05s");
    expect(formatCountdown(45)).toBe("45s");
    expect(formatCountdown(0)).toBe("0s");
    expect(formatCountdown(-10)).toBe("0s");
  });

  test("utcMinute", () => {
    expect(utcMinute(Date.parse("2026-10-01T12:34:56Z") / 1000)).toBe("2026-10-01 12:34 UTC");
  });
});

describe("transfer target", () => {
  test("an unregistered, non-zero, different address", () => {
    expect(transferTargetError(NEW, { owner: OWNER })).toBeNull();
    expect(transferTargetError("", { owner: OWNER })).toMatch(/Enter/);
    expect(transferTargetError("0x123", { owner: OWNER })).toMatch(/Not an address/);
    expect(transferTargetError(zeroAddress, { owner: OWNER })).toMatch(/zero/);
    expect(transferTargetError(OWNER.toUpperCase().replace("0X", "0x"), { owner: OWNER })).toMatch(/already the owner/);
    expect(transferTargetError(NEW, { owner: OWNER, newOwnerBuilderId: 4 })).toMatch(/builder #4/);
  });

  test("pendingFor: the builders proposed to this wallet", () => {
    const pending = new Map<number, string>([[1, zeroAddress], [2, NEW.toLowerCase()], [3, OWNER], [5, NEW]]);
    expect(pendingFor(NEW, pending)).toEqual([2, 5]);
    expect(pendingFor(undefined, pending)).toEqual([]);
    expect(pendingFor(zeroAddress, pending)).toEqual([]);
  });
});

describe("recovery on /verify", () => {
  const T = 1_800_000_000;
  const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

  test("recoveriesFor: the builders a pending recovery moves to this wallet (any case), in id order", () => {
    const reads = new Map([
      [3, { newOwner: NEW.toLowerCase(), readyAt: T }],
      [1, { newOwner: NEW, readyAt: T + 5 }],
      [2, { newOwner: OTHER, readyAt: T }],
      [4, { newOwner: zeroAddress, readyAt: 0 }],
    ]);
    expect(recoveriesFor(NEW, reads)).toEqual([
      { builderId: 1, readyAt: T + 5 },
      { builderId: 3, readyAt: T },
    ]);
    expect(recoveriesFor(null, reads)).toEqual([]);
    expect(recoveriesFor(zeroAddress, reads)).toEqual([]);
  });

  test("the public Finish recovery button: old or new owner only, once readyAt has passed", () => {
    const recovery = { newOwner: NEW, readyAt: T };
    // before readyAt: nobody
    expect(showFinishRecovery({ viewer: NEW, owner: OWNER, recovery }, T - 1)).toBe(false);
    expect(showFinishRecovery({ viewer: OWNER, owner: OWNER, recovery }, T - 1)).toBe(false);
    // at / after readyAt: the new owner and the old owner (any case)
    expect(showFinishRecovery({ viewer: NEW.toLowerCase(), owner: OWNER, recovery }, T)).toBe(true);
    expect(showFinishRecovery({ viewer: OWNER.toUpperCase().replace("0X", "0x"), owner: OWNER, recovery }, T + 60)).toBe(true);
    // anyone else, no wallet, no recovery: hidden
    expect(showFinishRecovery({ viewer: OTHER, owner: OWNER, recovery }, T + 60)).toBe(false);
    expect(showFinishRecovery({ viewer: null, owner: OWNER, recovery }, T + 60)).toBe(false);
    expect(showFinishRecovery({ viewer: OWNER, owner: OWNER, recovery: null }, T + 60)).toBe(false);
    expect(showFinishRecovery({ viewer: NEW, owner: null, recovery: { newOwner: zeroAddress, readyAt: 0 } }, T)).toBe(false);
  });
});

import { describe, expect, test } from "vitest";
import { decodeFunctionData, keccak256, toBytes, type Address, type Hex } from "viem";
import { cancelReleaseSafeFile, cancelReleaseTx, nominateInput, nominateSafeFile, nominateTx } from "./wonder-admin";
import {
  groupWonderMarkets, LABEL_COMMUNITY, LABEL_UNCLAIMED, marketLabels,
  nextHourExpiry, releaseView, sourceKey, SUBJECT, waitingLine,
  waitingAmount, wonderContracts, wonderCreateCheck, wonderEscrowAbi, wonderFeedFor, wonderMarketsAbi, type WonderStatus,
} from "./wonder";

const MK = "0x00000000000000000000000000000000000000a1" as Address;
const ESC = "0x00000000000000000000000000000000000000e5" as Address;
const SRC = "github:acme/tool";
const KEY = keccak256(toBytes(SRC));

describe("wonder contracts", () => {
  test("wonderContracts is null without an escrow", () => {
    expect(wonderContracts({ contracts: { MarketsPerennial: MK, WonderEscrow: null } as never })).toBeNull();
    expect(wonderContracts({ contracts: { MarketsPerennial: null, WonderEscrow: ESC } as never })).toBeNull();
    expect(wonderContracts({ contracts: { MarketsPerennial: MK, WonderEscrow: ESC } as never })).toEqual({ markets: MK, escrow: ESC });
  });
  test("sourceKey is keccak256 of the canonical source (SourceKey.keyOf)", () => {
    expect(sourceKey(SRC)).toBe(KEY);
  });
});

describe("labels", () => {
  const w = (bound: boolean) => ({ kind: SUBJECT.Wonder, builderId: 0n, sourceKey: KEY, bound, source: SRC });
  test("wonder markets are unclaimed; unbound ones community too", () => {
    expect(marketLabels(w(true))).toEqual([LABEL_UNCLAIMED]);
    expect(marketLabels(w(false))).toEqual([LABEL_UNCLAIMED, LABEL_COMMUNITY]);
  });
  test("a builder market is community only when unbound", () => {
    const b = (bound: boolean) => ({ kind: SUBJECT.Builder, builderId: 7n, sourceKey: `0x${"0".repeat(64)}` as Hex, bound });
    expect(marketLabels(b(true))).toEqual([]);
    expect(marketLabels(b(false))).toEqual([LABEL_COMMUNITY]);
  });
  test("no subject (pre-wonder deployment): no labels", () => {
    expect(marketLabels(undefined)).toEqual([]);
  });
  test("the spec's copy", () => {
    expect(LABEL_UNCLAIMED).toBe("Unclaimed: this team hasn't joined Registrai and hasn't endorsed this market.");
    expect(LABEL_COMMUNITY).toBe("Community market: not created or endorsed by the project.");
  });
});

describe("waitingLine", () => {
  test("only for a positive amount", () => {
    expect(waitingLine(12_500_000n)).toBe("$12.50 waiting for the team");
    expect(waitingLine(0n)).toBeNull();
    expect(waitingLine(null)).toBeNull();
    expect(waitingLine(undefined)).toBeNull();
  });
});

describe("releaseView", () => {
  const base: WonderStatus = { source: SRC, key: KEY, nominated: true, escrow: 5_000_000n, releasedTo: 0, pending: null, firstCreditAt: 1000 };
  const EXP = 180 * 86400;
  test("waiting / empty / expired", () => {
    expect(releaseView(base, 2000, EXP)).toEqual({ state: "waiting", line: "$5.00 waiting for the team" });
    expect(releaseView({ ...base, escrow: 0n }, 2000, EXP).state).toBe("empty");
    expect(releaseView(base, 1000 + EXP, EXP).state).toBe("expired");
  });
  test("pending, then ready", () => {
    const p = { ...base, pending: { builderId: 7, projectId: 3, readyAt: 1_790_000_000 } };
    const v = releaseView(p, 1_789_000_000, EXP);
    expect(v.state).toBe("pending");
    expect(v.line).toContain("builder #7");
    expect(v.line).toContain("2026-09-21");
    expect(releaseView(p, 1_790_000_000, EXP).state).toBe("ready");
  });
  test("released", () => {
    expect(releaseView({ ...base, releasedTo: 7, escrow: 0n }, 2000, EXP)).toEqual({ state: "released", line: "Released to builder #7" });
  });
});

describe("groupWonderMarkets", () => {
  test("by source, busiest first", () => {
    const g = groupWonderMarkets([{ source: "github:b/b", id: 1 }, { source: SRC, id: 2 }, { source: SRC, id: 3 }]);
    expect(g.map((x) => [x.source, x.markets.length])).toEqual([[SRC, 2], ["github:b/b", 1]]);
    expect(g[0].key).toBe(KEY);
  });
});

describe("nextHourExpiry", () => {
  test("rounds up to a whole hour", () => {
    expect(nextHourExpiry(1_000, 1)).toBe(BigInt(Math.ceil((1_000 + 86_400) / 3600) * 3600));
    expect(nextHourExpiry(3600, 1) % 3600n).toBe(0n);
  });
});

describe("wonderFeedFor", () => {
  test("the operator's registrai-milestone:<source> feed", () => {
    const f = `0x${"f1".repeat(32)}`;
    expect(wonderFeedFor({ [`registrai-milestone:${SRC}`]: f }, SRC)).toBe(f);
    expect(wonderFeedFor({}, SRC)).toBeNull();
    expect(wonderFeedFor(undefined, SRC)).toBeNull();
  });
});

describe("nominateInput", () => {
  const invited = new Set([SRC]);
  test("nominateInput normalises or refuses", () => {
    expect(nominateInput("  https://github.com/Acme/Tool  ", invited)).toEqual({ ok: true, source: SRC });
    expect(nominateInput("not a source", invited).ok).toBe(false);
  });
  test("nominateInput refuses an uninvited source", () => {
    const r = nominateInput("github:other/thing", invited);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invite/i);
  });
});

describe("Safe files", () => {
  test("nominate and cancelRelease calldata", () => {
    const n = nominateTx(MK, SRC, true);
    expect(n.kind).toBe("nominate");
    expect(decodeFunctionData({ abi: wonderMarketsAbi, data: n.data }).args).toEqual([SRC, true]);
    const c = cancelReleaseTx(ESC, KEY, SRC);
    expect(c.kind).toBe("cancelRelease");
    expect(decodeFunctionData({ abi: wonderEscrowAbi, data: c.data }).args).toEqual([KEY]);
    const f = nominateSafeFile({ markets: MK, source: SRC, on: false, chainId: 5042, createdAt: 1 });
    expect(f.chainId).toBe("5042");
    expect(f.transactions).toHaveLength(1);
    expect(f.meta.name).toContain("un-nominate");
    expect(cancelReleaseSafeFile({ escrow: ESC, source: SRC, chainId: 5042, createdAt: 1 }).meta.name).toContain(SRC);
  });
});


describe("wonderCreateCheck", () => {
  const feed = `0x${"f1".repeat(32)}` as Hex;
  test("wonderCreateCheck requires the source's bound feed", () => {
    expect(wonderCreateCheck({ source: SRC, feed, feedSubject: { kind: 2, sourceKey: KEY }, nominated: true, hasReading: true })).toBeNull();
    expect(wonderCreateCheck({ source: SRC, feed: null, feedSubject: null, nominated: true, hasReading: true })).toMatch(/milestone feed/);
    expect(wonderCreateCheck({ source: SRC, feed, feedSubject: { kind: 0, sourceKey: `0x${"0".repeat(64)}` as Hex }, nominated: true, hasReading: true })).toMatch(/not bound/);
    expect(wonderCreateCheck({ source: SRC, feed, feedSubject: { kind: 2, sourceKey: sourceKey("github:x/y") }, nominated: true, hasReading: true })).toMatch(/not bound/);
    expect(wonderCreateCheck({ source: SRC, feed, feedSubject: { kind: 2, sourceKey: KEY }, nominated: false, hasReading: true })).toMatch(/not nominated/);
  });
});


describe("final review fixes", () => {
  const feed = `0x${"f1".repeat(32)}` as Hex;
  test("no market before the feed's first reading (threshold 1 would be a sure YES)", () => {
    expect(wonderCreateCheck({ source: SRC, feed, feedSubject: { kind: 2, sourceKey: KEY }, nominated: true, hasReading: false })).toMatch(/first reading/);
  });
  test("an unclaimed domain source has no feed to open markets on", () => {
    const d = "domain:acme.dev";
    expect(wonderCreateCheck({ source: d, feed: null, feedSubject: null, nominated: true, hasReading: false })).toMatch(/until the team claims/);
  });
  test("a source bound to its builder: open a builder market instead", () => {
    expect(wonderCreateCheck({ source: SRC, feed, feedSubject: { kind: 1, sourceKey: `0x${"0".repeat(64)}` as Hex }, nominated: true, hasReading: true })).toMatch(/builder market/);
  });
  test("un-nominating (an opt-out) needs no live invite", () => {
    expect(nominateInput("github:other/thing", new Set([SRC]), false)).toEqual({ ok: true, source: "github:other/thing" });
    expect(nominateInput("github:other/thing", new Set([SRC]), true).ok).toBe(false);
  });
  test("the cancel-release Safe file describes itself", () => {
    const f = cancelReleaseSafeFile({ escrow: ESC, source: SRC, chainId: 5042, createdAt: 1 });
    expect(f.meta.description).toContain("cancelRelease(");
    expect(f.meta.description).not.toContain("registerFor");
  });
  test("waitingAmount: only escrow that is actually waiting for the team", () => {
    const base: WonderStatus = { source: SRC, key: KEY, nominated: true, escrow: 5_000_000n, releasedTo: 0, pending: null, firstCreditAt: 1000 };
    expect(waitingAmount(base, 2000, 180 * 86400)).toBe(5_000_000n);
    expect(waitingAmount(base, 1000 + 180 * 86400, 180 * 86400)).toBeNull();
    expect(waitingAmount({ ...base, pending: { builderId: 7, projectId: 3, readyAt: 9e9 } }, 2000, 180 * 86400)).toBeNull();
    expect(waitingAmount(base, 2000, null)).toBeNull();
    expect(waitingAmount(undefined, 2000, 1)).toBeNull();
  });
  test("a wonder market whose binding is unknown is still labelled unclaimed", () => {
    expect(marketLabels({ kind: SUBJECT.Wonder, builderId: 0n, sourceKey: KEY, bound: undefined, source: SRC })).toEqual([LABEL_UNCLAIMED]);
  });
});

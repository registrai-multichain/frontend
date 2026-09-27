import { describe, expect, test } from "vitest";
import {
  EMPTY_FORM, PRICE_SOURCE, formatUtcDeadline, parseUtcDeadline, prepareSubmission, priceQuestion,
  feesScanEnd, mergeFeeProgress, mergeScanProgress, parseScanCache, proposalFeedDescription, proposalScanStart, scanForward,
  statusChip, statusHref, sumCreatorFees, forwardPayee, forwardedShown, isTreasury, shareExact, shareText, type ProposeFormState, type ScanCache,
} from "./propose-form";
import { TREASURY } from "./market-proposals";
import { DEFAULT_PROPOSALS_API, proposalsApiBase } from "./proposals-api";

const NOW = 1_790_500_000; // 2026-09-27
const DEC31_2300 = Date.UTC(2026, 11, 31, 23, 0) / 1000;

describe("parseUtcDeadline", () => {
  test("reads YYYY-MM-DD HH:MM as UTC, with a space, several spaces or a T", () => {
    expect(parseUtcDeadline("2026-12-31 23:00")).toBe(DEC31_2300);
    expect(parseUtcDeadline(" 2026-12-31  23:00 ")).toBe(DEC31_2300);
    expect(parseUtcDeadline("2026-12-31T23:00")).toBe(DEC31_2300);
  });
  test("rounds DOWN to the 5-minute grid", () => {
    expect(parseUtcDeadline("2026-12-31 23:04")).toBe(DEC31_2300);
    expect(parseUtcDeadline("2026-12-31 23:05")).toBe(DEC31_2300 + 300);
    expect(parseUtcDeadline("2026-12-31 23:59")! % 300).toBe(0);
  });
  test("refuses anything that is not a real date and time", () => {
    for (const bad of ["", "tomorrow", "2026-13-01 10:00", "2026-02-30 10:00", "2026-12-31 24:00", "2026-12-31 23:60", "31/12/2026 23:00", "2026-12-31"]) {
      expect(parseUtcDeadline(bad)).toBeNull();
    }
  });
  test("formatUtcDeadline is its inverse", () => {
    expect(formatUtcDeadline(DEC31_2300)).toBe("2026-12-31 23:00");
    expect(parseUtcDeadline(formatUtcDeadline(DEC31_2300 + 600))).toBe(DEC31_2300 + 600);
  });
});

describe("priceQuestion", () => {
  test("builds the sentence from the asset, the comparator, the price and the deadline", () => {
    expect(priceQuestion({ asset: "btc-usd", comparator: 1, price: "100000", deadline: DEC31_2300 })).toBe(
      "Will BTC be at least $100,000 on Dec 31, 2026 at 23:00 UTC?",
    );
    expect(priceQuestion({ asset: "sol-usd", comparator: 3, price: "1234.567", deadline: DEC31_2300 + 300 })).toBe(
      "Will SOL be at most $1,234.567 on Dec 31, 2026 at 23:05 UTC?",
    );
    expect(priceQuestion({ asset: "hype-usd", comparator: 1, price: "0.52", deadline: DEC31_2300 })).toBe(
      "Will HYPE be at least $0.52 on Dec 31, 2026 at 23:00 UTC?",
    );
  });
  test("is empty until there is a price and a deadline", () => {
    expect(priceQuestion({ asset: "btc-usd", comparator: 1, price: "", deadline: DEC31_2300 })).toBe("");
    expect(priceQuestion({ asset: "btc-usd", comparator: 1, price: "abc", deadline: DEC31_2300 })).toBe("");
    expect(priceQuestion({ asset: "btc-usd", comparator: 1, price: "3000", deadline: null })).toBe("");
  });
});

const event: ProposeFormState = {
  ...EMPTY_FORM,
  kind: "event",
  question: "Will Circle announce native USDC on a new chain before Dec 31, 2026?",
  rule: "Circle publishes an official announcement that native USDC is live on a chain it did not support on Oct 1, 2026.",
  source: "https://www.circle.com/blog",
  deadlineText: "2026-12-31 23:00",
};

describe("prepareSubmission", () => {
  test("a yes/no event becomes the API body, validated like the API does", () => {
    const r = prepareSubmission(event, NOW);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.body).toMatchObject({ kind: "event", question: event.question, rule: event.rule, source: event.source, deadline: DEC31_2300, website2: "" });
    expect(r.body).not.toHaveProperty("asset");
  });
  test("an unreadable deadline is a deadline field error before anything else", () => {
    expect(prepareSubmission({ ...event, deadlineText: "next friday" }, NOW)).toMatchObject({ ok: false, field: "deadline" });
  });
  test("errors come in the order the fields are shown", () => {
    expect(prepareSubmission(EMPTY_FORM, NOW)).toMatchObject({ ok: false, field: "question" });
    expect(prepareSubmission({ ...EMPTY_FORM, kind: "price" }, NOW)).toMatchObject({ ok: false, field: "price", error: "Give a positive price, e.g. 3000 or 0.52." });
    expect(prepareSubmission({ ...EMPTY_FORM, kind: "price", price: "3000" }, NOW)).toMatchObject({ ok: false, field: "deadline" });
  });
  test("the shared validation's field messages come through", () => {
    expect(prepareSubmission({ ...event, source: "http://x.test" }, NOW)).toMatchObject({ ok: false, field: "source" });
    expect(prepareSubmission({ ...event, creatorPayee: "0x123" }, NOW)).toMatchObject({ ok: false, field: "creatorPayee" });
  });
  test("a price proposal: auto question (unless edited), the rule is the sentence, the source is fixed", () => {
    const price: ProposeFormState = { ...EMPTY_FORM, kind: "price", asset: "eth-usd", comparator: 3, price: "3000.5", deadlineText: "2026-12-31 23:02" };
    const r = prepareSubmission(price, NOW);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const sentence = "Will ETH be at most $3,000.5 on Dec 31, 2026 at 23:00 UTC?";
    expect(r.body).toMatchObject({ kind: "price", question: sentence, rule: sentence, source: PRICE_SOURCE, asset: "eth-usd", comparator: 3, price: "3000.5", deadline: DEC31_2300 });
    const edited = prepareSubmission({ ...price, priceQuestionEdit: "Will ETH close 2026 at or under $3,000.5?" }, NOW);
    expect(edited.ok && edited.body).toMatchObject({ question: "Will ETH close 2026 at or under $3,000.5?", rule: sentence });
  });
  test("a price with too many decimals for the asset is refused on the price field", () => {
    const r = prepareSubmission({ ...EMPTY_FORM, kind: "price", asset: "btc-usd", comparator: 1, price: "100000.123", deadlineText: "2026-12-31 23:00" }, NOW);
    expect(r).toMatchObject({ ok: false, field: "price", error: "Use at most 2 decimals for BTC." });
  });
  test("a phase-2 kind is sent like an event", () => {
    expect(prepareSubmission({ ...event, kind: "wonder" }, NOW)).toMatchObject({ ok: true, body: { kind: "wonder" } });
  });
});

describe("status page helpers", () => {
  test("chip labels; only the chain decides Opened", () => {
    expect(statusChip("pending", false).label).toBe("Pending review");
    expect(statusChip("approved", false).label).toBe("Approved — opening shortly");
    expect(statusChip("approved", true).label).toBe("Opened");
    // the API alone never says Opened: only the chain lookup does
    expect(statusChip("opened", false).label).toBe("Approved — opening shortly");
    expect(statusChip("approved", false, true).label).toBe("Approved — opening delayed");
    expect(statusChip("approved", true, true).label).toBe("Opened");
    expect(statusChip("rejected", false).label).toBe("Not approved");
    expect(statusChip("queued", false).label).toBe("Phase 2 queue");
  });
  test("the agent's feed description for a proposal", () => {
    expect(proposalFeedDescription("pabcdefghij")).toBe("registrai-data:p-pabcdefghij");
  });
  test("status link and API base", () => {
    expect(statusHref("pabcdefghij")).toBe("/propose/status/?id=pabcdefghij");
    expect(DEFAULT_PROPOSALS_API).toBe("https://builder.registrai.cc/api/market-proposals");
    expect(proposalsApiBase(undefined)).toBe(DEFAULT_PROPOSALS_API);
    expect(proposalsApiBase("")).toBe(DEFAULT_PROPOSALS_API);
    expect(proposalsApiBase("http://127.0.0.1:8788/api/market-proposals")).toBe("http://127.0.0.1:8788/api/market-proposals");
  });
  test("creator share = the sum of FeesPaid.creatorFee", () => {
    expect(sumCreatorFees([{ args: { creatorFee: 1_500_000n } }, { args: {} }, { args: { creatorFee: 250_000n } }])).toBe(1_750_000n);
  });
  test("the scan starts a little before the proposal was made, never before deploy", () => {
    // head 1_000_000 at t=NOW; created 1 hour ago at 0.5 s blocks = 7200 blocks, plus a 1200-block margin
    expect(proposalScanStart(1_000_000n, NOW, NOW - 3600, 0n)).toBe(1_000_000n - 7200n - 1200n);
    expect(proposalScanStart(1_000_000n, NOW, NOW - 3600, 995_000n)).toBe(995_000n);
    expect(proposalScanStart(1_000n, NOW, NOW - 30 * 86_400, 0n)).toBe(0n);
  });
});

describe("scanForward", () => {
  test("scans window by window and stops at the first window where it found what it looks for", async () => {
    const calls: Array<[bigint, bigint]> = [];
    const fetchRange = async (a: bigint, b: bigint) => {
      calls.push([a, b]);
      return a <= 23_000n && 23_000n <= b ? [{ at: 23_000n }] : [];
    };
    const r = await scanForward(fetchRange, 0n, 100_000n, (logs) => logs.length > 0, 10_000n, 5_000n);
    expect(r).toMatchObject({ logs: [{ at: 23_000n }], complete: true, scannedTo: 29_999n });
    expect(calls.at(-1)).toEqual([25_000n, 29_999n]);
  });
  test("reads to the end when nothing is found; a failed chunk ends it incomplete", async () => {
    expect(await scanForward(async () => [], 0n, 12_000n, () => false, 10_000n, 5_000n)).toMatchObject({ logs: [], complete: true, scannedTo: 12_000n });
    const failing = async (a: bigint) => {
      if (a >= 10_000n) throw new Error("rate limited");
      return [];
    };
    expect(await scanForward(failing, 0n, 30_000n, () => false, 10_000n, 5_000n)).toMatchObject({ complete: false, scannedTo: 9_999n });
  });
});

describe("bounded status reads", () => {
  test("the fee scan ends 600 blocks after the market's expiry block, or at the head", () => {
    // market at block 1000 created at t=0, expiry t=3600 -> expiry block 1000 + 7200 = 8200
    expect(feesScanEnd(1_000_000n, 1_000n, 0, 3_600)).toBe(8_800n);
    expect(feesScanEnd(5_000n, 1_000n, 0, 3_600)).toBe(5_000n);
    // a fractional block rounds up
    expect(feesScanEnd(1_000_000n, 1_000n, 0, 3_601)).toBe(8_802n);
    // expiry before creation (never on chain) clamps to the market's block
    expect(feesScanEnd(1_000_000n, 1_000n, 100, 50)).toBe(1_600n);
  });

  test("scan progress only advances over a contiguous range", () => {
    expect(mergeScanProgress(undefined, 100n, 499n)).toBe(499n);
    expect(mergeScanProgress(99n, 100n, 499n)).toBe(499n);
    // nothing scanned in this pass (first chunk failed)
    expect(mergeScanProgress(99n, 100n, 99n)).toBe(99n);
    // a range that does not start right after the cached end leaves a gap: keep the cache
    expect(mergeScanProgress(99n, 200n, 499n)).toBe(99n);
    // never goes backwards
    expect(mergeScanProgress(600n, 100n, 499n)).toBe(600n);
  });

  test("the fee sum adds only what a contiguous pass read", () => {
    expect(mergeFeeProgress(undefined, 1_000n, 4_999n, 7n)).toEqual({ scannedTo: "4999", sum: "7" });
    expect(mergeFeeProgress({ scannedTo: "4999", sum: "7" }, 5_000n, 9_999n, 3n)).toEqual({ scannedTo: "9999", sum: "10" });
    expect(mergeFeeProgress({ scannedTo: "4999", sum: "7" }, 5_000n, 4_999n, 0n)).toEqual({ scannedTo: "4999", sum: "7" });
    expect(mergeFeeProgress({ scannedTo: "4999", sum: "7" }, 6_000n, 9_999n, 3n)).toEqual({ scannedTo: "4999", sum: "7" });
  });

  test("a stored cache is read back only when its shape is right", () => {
    const c: ScanCache = {
      feed: { scannedTo: "123", feedId: "0xab" },
      market: { scannedTo: "150", marketId: "0xcd", blockNumber: "140", createdTs: 10, expiry: 99 },
      fees: { scannedTo: "160", sum: "5" },
    };
    expect(parseScanCache(JSON.stringify(c))).toEqual(c);
    expect(parseScanCache(JSON.stringify({ feed: { scannedTo: "7" } }))).toEqual({ feed: { scannedTo: "7" } });
    const f: ScanCache = { ...c, fwd: { scannedTo: "170", sum: "3", payee: "0x000000000000000000000000000000000000dead" } };
    expect(parseScanCache(JSON.stringify(f))).toEqual(f);
    expect(parseScanCache(JSON.stringify({ ...f, fwd: { scannedTo: "170", sum: "3", payee: "treasury" } }))).toBeNull();
    expect(parseScanCache(JSON.stringify({ ...f, fwd: { scannedTo: "170", sum: "-3", payee: "0x000000000000000000000000000000000000dead" } }))).toBeNull();
    for (const bad of [null, "", "{", "[]", JSON.stringify({ feed: { scannedTo: 7 } }), JSON.stringify({ feed: { scannedTo: "x" } }), JSON.stringify({ fees: { scannedTo: "1", sum: "2" } })]) {
      expect(parseScanCache(bad)).toBeNull();
    }
  });
});

describe("forwarded creator share (R37)", () => {
  const own = { agent: "0x31CCE575eC134bFD57c46997A295Ab14Ab887BB4", ledger: "0x02D278930B67A290fEfE93Ac049a086A9b5e0FB5", markets: "0xddf0814e6C95E1A0585c16dbb012c611ae23A220" };
  const payee = "0x000000000000000000000000000000000000dEaD";
  const signed = (creatorPayee: string) => ({ message: { creatorPayee } }) as never;
  test("the signed approval's payee, else the proposal's, lower-cased", () => {
    expect(forwardPayee({ creatorPayee: payee }, own)).toBe(payee.toLowerCase());
    expect(forwardPayee({ creatorPayee: undefined, approval: signed(payee) }, own)).toBe(payee.toLowerCase());
    expect(forwardPayee({ creatorPayee: "0x1111111111111111111111111111111111111111", approval: signed(payee) }, own)).toBe(payee.toLowerCase());
  });
  test("an empty, zero or own-contract payee means the treasury", () => {
    expect(forwardPayee({ creatorPayee: undefined }, own)).toBe(TREASURY.toLowerCase());
    expect(forwardPayee({ creatorPayee: "" }, own)).toBe(TREASURY.toLowerCase());
    expect(forwardPayee({ creatorPayee: payee, approval: signed(`0x${"0".repeat(40)}`) }, own)).toBe(TREASURY.toLowerCase());
    for (const x of Object.values(own)) expect(forwardPayee({ creatorPayee: x.toLowerCase() }, own)).toBe(TREASURY.toLowerCase());
    expect(forwardPayee({ creatorPayee: "nope" }, own)).toBe(TREASURY.toLowerCase());
  });
});

describe("status page share lines (R42)", () => {
  test("forwarded is shown up to this market's earned share, and unknown while either is", () => {
    expect(forwardedShown(200_000n, 279_000n)).toBe(200_000n);
    expect(forwardedShown(14_300_000n, 270_000n)).toBe(270_000n); // other markets' payouts to the same payee
    expect(forwardedShown(5n, null)).toBeUndefined();
    expect(forwardedShown(5n, undefined)).toBeUndefined();
    expect(forwardedShown(null, 5n)).toBeUndefined();
    expect(forwardedShown(undefined, 5n)).toBeUndefined();
  });
  test("a share reads to 4 decimals (rounded down); under 0.0001 reads < 0.0001, nothing reads 0", () => {
    expect(shareText(99n)).toBe("< 0.0001 USDC");
    expect(shareText(0n)).toBe("0 USDC");
    expect(shareText(100n)).toBe("0.0001 USDC");
    expect(shareText(9_000n)).toBe("0.009 USDC");
    expect(shareText(279_000n)).toBe("0.279 USDC");
    expect(shareText(279_123n)).toBe("0.2791 USDC");
    expect(shareText(12_345_678_999n)).toBe("12345.6789 USDC");
  });
  test("shareExact gives all 6 decimals (the tooltip)", () => {
    expect(shareExact(279_123n)).toBe("0.279123 USDC");
    expect(shareExact(99n)).toBe("0.000099 USDC");
    expect(shareExact(5_000_000n)).toBe("5.000000 USDC");
  });
  test("isTreasury compares case-insensitively", () => {
    expect(isTreasury(TREASURY.toLowerCase())).toBe(true);
    expect(isTreasury("0x000000000000000000000000000000000000dead")).toBe(false);
  });
});


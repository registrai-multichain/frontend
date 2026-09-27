import { describe, expect, test } from "vitest";
import {
  EMPTY_FORM, PRICE_SOURCE, formatUtcDeadline, parseUtcDeadline, prepareSubmission, priceQuestion,
  proposalFeedDescription, proposalScanStart, scanForward, statusChip, statusHref, sumCreatorFees, type ProposeFormState,
} from "./propose-form";
import { PROPOSALS_API } from "./proposals-api";

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
  test("chip labels; the chain decides Opened", () => {
    expect(statusChip("pending", false).label).toBe("Pending review");
    expect(statusChip("approved", false).label).toBe("Approved — opening shortly");
    expect(statusChip("approved", true).label).toBe("Opened");
    expect(statusChip("opened", false).label).toBe("Opened");
    expect(statusChip("rejected", false).label).toBe("Not approved");
    expect(statusChip("queued", false).label).toBe("Phase 2 queue");
  });
  test("the agent's feed description for a proposal", () => {
    expect(proposalFeedDescription("pabcdefghij")).toBe("registrai-data:p-pabcdefghij");
  });
  test("status link and API base", () => {
    expect(statusHref("pabcdefghij")).toBe("/propose/status/?id=pabcdefghij");
    expect(PROPOSALS_API).toBe("https://builder.registrai.cc/api/market-proposals");
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

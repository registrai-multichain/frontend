import { describe, expect, test } from "vitest";
import { getAddress } from "viem";
import { MARKETS_V4, TREASURY, approvalMessage, type Proposal } from "./market-proposals";
import {
  ageLabel, applyDraft, approvalText, draftOf, filterCounts, filterOf, inFilter, isDirty, kindLabel, nextNonce, outcomeProblems,
  outcomeRecordedText, outcomeWindow, parseUtcMinute, tooLateText, patchBody, proposalChecks, shortUtc, wrongChainMessage,
} from "./proposals-admin";

const NOW = 1_790_500_000; // Sep 21, 2026 (a fixed unix second)
const DAY = 86_400;
const grid = (t: number) => t - (t % 300);
const PAYEE = getAddress("0x71c2000000000000000000000000000000009f04");
const ev = (over: Partial<Proposal> = {}): Proposal => ({
  id: "pabcdefghij", createdAt: new Date((NOW - 7200) * 1000).toISOString(), status: "pending", kind: "event",
  question: "Will Circle announce native USDC on a new chain before Dec 31, 2026?",
  rule: "Circle publishes an official announcement.", source: "https://www.circle.com/blog",
  deadline: grid(NOW + 95 * DAY), creatorPayee: PAYEE, ...over,
});
const price = (over: Partial<Proposal> = {}): Proposal =>
  ev({ kind: "price", question: "Will ETH be at least $3,000 on Nov 30, 2026 at 23:00 UTC?", rule: "", source: "", asset: "eth-usd", comparator: 1, price: "3000.5", creatorPayee: undefined, ...over });

describe("filters", () => {
  test("approved includes opened; counts per filter", () => {
    const list = [ev(), ev({ id: "p2", status: "opened" }), ev({ id: "p3", status: "approved" }), ev({ id: "p4", status: "queued", kind: "wonder" }), ev({ id: "p5", status: "rejected" })];
    expect(list.filter((p) => inFilter(p, "approved")).map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(filterCounts(list)).toEqual({ pending: 1, approved: 2, rejected: 1, queued: 1 });
  });
});

describe("labels", () => {
  test("kind and age", () => {
    expect(kindLabel("event")).toBe("Yes / no event");
    expect(kindLabel("price")).toBe("Price at a deadline");
    expect(kindLabel("wonder")).toBe("Wonder market");
    const at = (secsAgo: number) => new Date((NOW - secsAgo) * 1000).toISOString();
    expect(ageLabel(at(20), NOW * 1000)).toBe("submitted just now");
    expect(ageLabel(at(600), NOW * 1000)).toBe("submitted 10 min ago");
    expect(ageLabel(at(7200), NOW * 1000)).toBe("submitted 2 h ago");
    expect(ageLabel(at(30 * 3600), NOW * 1000)).toBe("submitted yesterday");
    expect(ageLabel(at(5 * DAY), NOW * 1000)).toBe("submitted 5 days ago");
    expect(ageLabel("not a date", NOW * 1000)).toBe("");
  });
  test("short UTC times omit the year when it is this year", () => {
    const dec31 = Date.UTC(2026, 11, 31, 23, 0) / 1000;
    expect(shortUtc(dec31, NOW)).toBe("Dec 31, 23:00 UTC");
    expect(shortUtc(Date.UTC(2027, 0, 5, 9, 5) / 1000, NOW)).toBe("Jan 5 2027, 09:05 UTC");
  });
  test("parseUtcMinute reads an exact minute (no grid rounding)", () => {
    expect(parseUtcMinute("2026-10-02 14:03")).toBe(Date.UTC(2026, 9, 2, 14, 3) / 1000);
    expect(parseUtcMinute("2026-02-30 10:00")).toBeNull();
    expect(parseUtcMinute("yesterday")).toBeNull();
  });
});

describe("proposalChecks", () => {
  const ctx = { nowS: NOW, duplicate: null, liveMatch: null, own: [MARKETS_V4] };
  test("a clean event passes every check", () => {
    const c = proposalChecks(ev(), ctx);
    expect(c.every((x) => x.ok)).toBe(true);
    expect(c.map((x) => x.text)).toEqual([
      "Deadline is on the 5-minute grid and 95 days away",
      "Answer source is public (circle.com)",
      "No live market or other proposal asks the same question",
      "Creator wallet is a valid address (not a contract we control)",
    ]);
  });
  test("the deadline must be on the grid and between 1 day and 1 year away", () => {
    expect(proposalChecks(ev({ deadline: grid(NOW + 95 * DAY) + 60 }), ctx)[0]).toEqual({ ok: false, text: "Deadline is off the 5-minute grid" });
    expect(proposalChecks(ev({ deadline: grid(NOW + 3600) }), ctx)[0]).toEqual({ ok: false, text: "Deadline is less than 1 day away" });
    expect(proposalChecks(ev({ deadline: grid(NOW + 400 * DAY) }), ctx)[0]).toEqual({ ok: false, text: "Deadline is more than 1 year away" });
    expect(proposalChecks(ev({ deadline: grid(NOW + DAY + 600) }), ctx)[0].text).toBe("Deadline is on the 5-minute grid and 1 day away");
  });
  test("the source must be an https link; a price market has the fixed median", () => {
    expect(proposalChecks(ev({ source: "http://circle.com" }), ctx)[1]).toEqual({ ok: false, text: "Answer source is not a public https link" });
    expect(proposalChecks(price(), ctx)[1]).toEqual({ ok: true, text: "Answer source is the median of Coinbase, Kraken and OKX" });
  });
  test("duplicates of a live market or another proposal fail", () => {
    expect(proposalChecks(ev(), { ...ctx, duplicate: "live market", liveMatch: "Will X?" })[2]).toEqual({ ok: false, text: "A live market asks the same question: “Will X?”" });
    expect(proposalChecks(ev(), { ...ctx, duplicate: "pother" })[2]).toEqual({ ok: false, text: "Proposal pother asks the same question" });
  });
  test("creator wallet: treasury fallback, invalid, or one of ours", () => {
    expect(proposalChecks(price(), ctx)[3]).toEqual({ ok: true, text: "No creator wallet: the creator share goes to the treasury" });
    expect(proposalChecks(ev({ creatorPayee: TREASURY }), ctx)[3]).toEqual({ ok: true, text: "Creator wallet is the treasury" });
    expect(proposalChecks(ev({ creatorPayee: "0x123" }), ctx)[3]).toEqual({ ok: false, text: "Creator wallet is not a valid address (the share would go to the treasury)" });
    expect(proposalChecks(ev({ creatorPayee: MARKETS_V4.toLowerCase() }), ctx)[3]).toEqual({ ok: false, text: "Creator wallet is a contract we control" });
  });
  test("any other submission rule that fails is listed too", () => {
    const c = proposalChecks(price({ price: "3000.567" }), ctx);
    expect(c[4]).toEqual({ ok: false, text: "Use at most 2 decimals for ETH." });
  });
});

describe("drafts", () => {
  test("an untouched draft is not dirty and its patch round-trips the proposal", () => {
    const p = ev();
    const d = draftOf(p);
    expect(isDirty(p, d)).toBe(false);
    expect(patchBody(p, d)).toEqual({ question: p.question, rule: p.rule, source: p.source, deadline: p.deadline, creatorPayee: PAYEE });
    expect(patchBody(price(), draftOf(price()))).toMatchObject({ asset: "eth-usd", comparator: 1, price: "3000.5", creatorPayee: "" });
  });
  test("edits apply to the preview; a bad deadline text keeps the stored one and is reported", () => {
    const p = ev();
    const d = { ...draftOf(p), question: "Edited?", deadlineText: "2026-12-31 23:00" };
    expect(isDirty(p, d)).toBe(true);
    const a = applyDraft(p, d);
    expect(a.proposal.question).toBe("Edited?");
    expect(a.proposal.deadline).toBe(Date.UTC(2026, 11, 31, 23, 0) / 1000);
    expect(a.deadlineError).toBeNull();
    const b = applyDraft(p, { ...d, deadlineText: "soon" });
    expect(b.proposal.deadline).toBe(p.deadline);
    expect(b.deadlineError).toBe("Write the deadline as YYYY-MM-DD HH:MM (UTC).");
  });
});

describe("approvalText", () => {
  test("renders every signed field of an event approval", () => {
    const p = ev({ deadline: Date.UTC(2026, 11, 31, 23, 0) / 1000 });
    const t = approvalText(approvalMessage(p, 17n), NOW);
    expect(t).toContain("MarketApproval (Arc mainnet 5042, MarketsV4 0xBdC4…77cE)");
    expect(t).toContain("  kind       curated-event");
    expect(t).toContain(`  question   ${p.question}`);
    expect(t).toMatch(/ {2}ruleHash {3}0x[0-9a-f]{64}/);
    expect(t).toContain("  threshold  ≥ 1      expiry  1798758000 (Dec 31, 23:00 UTC)");
    expect(t).toContain(`  seed       5 USDC   creatorPayee  ${PAYEE}`);
    expect(t).toContain("  proposal   #pabcdefghij  nonce 17");
  });
  test("a price approval shows the asset, comparator and scaled threshold; the nonce may be pending", () => {
    const t = approvalText(approvalMessage(price({ comparator: 3 }), 1n), NOW, { nonceAtSigning: true });
    expect(t).toContain("  kind       price-at-deadline   asset  eth-usd");
    expect(t).toContain("  threshold  ≤ 300050 (3000.50 USD)");
    expect(t).toContain(`creatorPayee  ${TREASURY} (treasury)`);
    expect(t).toContain("nonce set when you sign");
  });
});

describe("after an action", () => {
  test("filterOf: the filter that lists a status", () => {
    expect(filterOf("pending")).toBe("pending");
    expect(filterOf("approved")).toBe("approved");
    expect(filterOf("opened")).toBe("approved");
    expect(filterOf("rejected")).toBe("rejected");
    expect(filterOf("queued")).toBe("queued");
  });
  test("signing needs the wallet on Arc mainnet", () => {
    expect(wrongChainMessage(5042)).toBeNull();
    expect(wrongChainMessage(5042002)).toBe("Switch your wallet to Arc mainnet to sign.");
    expect(wrongChainMessage(undefined)).toBe("Switch your wallet to Arc mainnet to sign.");
  });
});

describe("outcomeProblems", () => {
  const deadline = Date.UTC(2026, 11, 31, 23, 0) / 1000;
  // inside the grace window: 15 minutes past the deadline (the form closes at +20)
  const nowS = Date.UTC(2026, 11, 31, 23, 15) / 1000;
  const ok = { value: true, evidence: "https://www.circle.com/blog/x", sinceText: "2026-12-01 14:30", deadline, nowS };
  test("a complete Yes before the deadline has no problem", () => {
    expect(outcomeProblems(ok)).toEqual([]);
    expect(outcomeProblems({ ...ok, sinceText: "2026-12-31 23:00" })).toEqual([]); // at the deadline is in time
  });
  test("blank fields block signing without shouting", () => {
    const p = outcomeProblems({ ...ok, value: null, evidence: "", sinceText: "" });
    expect(p.map((x) => [x.field, x.blank])).toEqual([["value", true], ["evidence", true], ["since", true]]);
  });
  test("the evidence must be an https link; the time must parse and be in the past", () => {
    expect(outcomeProblems({ ...ok, evidence: "http://x.test" })).toEqual([{ field: "evidence", blank: false, error: "Give the evidence as a public https link." }]);
    expect(outcomeProblems({ ...ok, sinceText: "Dec 1" })).toEqual([{ field: "since", blank: false, error: "Write when it happened as YYYY-MM-DD HH:MM (UTC)." }]);
    expect(outcomeProblems({ ...ok, sinceText: "2027-01-03 00:00" })[0].error).toBe("That time is in the future.");
    expect(outcomeProblems({ ...ok, sinceText: "2026-12-31 23:21" })[0].error).toBe("That time is in the future.");
  });
  test("an evidence link the agent would refuse (over 2048 bytes) blocks signing (R24)", () => {
    const base = "https://www.circle.com/blog/";
    expect(outcomeProblems({ ...ok, evidence: base + "x".repeat(2048 - base.length) })).toEqual([]);
    const long = outcomeProblems({ ...ok, evidence: base + "x".repeat(2049 - base.length) });
    expect(long.map((x) => [x.field, x.blank])).toEqual([["evidence", false]]);
    // bytes, not characters: 700 three-byte characters are 2100 bytes
    expect(outcomeProblems({ ...ok, evidence: base + "€".repeat(700) })[0]?.field).toBe("evidence");
  });
  test("an outcome dated after the deadline is refused, Yes or No (the agent ignores it)", () => {
    const late = { ...ok, sinceText: "2026-12-31 23:10" };
    expect(outcomeProblems(late)).toEqual([
      { field: "since", blank: false, error: "The event must have happened by the deadline; a Yes dated after it settles as No." },
    ]);
    expect(outcomeProblems({ ...late, value: false })[0]).toMatchObject({ field: "since", blank: false });
    expect(outcomeProblems({ ...late, value: false, sinceText: "2026-12-31 23:00" })).toEqual([]);
  });
  test("I1 / R54: the form closes 20 minutes after the deadline (the agent attests at +30): too late, use the dispute process", () => {
    expect(outcomeProblems({ ...ok, nowS: deadline + 20 * 60 })).toEqual([]);
    const closed = outcomeProblems({ ...ok, nowS: deadline + 20 * 60 + 1 });
    expect(closed[0]).toEqual({
      field: "window", blank: false, error: "Too late — use the dispute process: an outcome signed now might not reach the agent before it attests.",
    });
    expect(closed[0].error).not.toMatch(/attested/);
  });
});

describe("outcomeWindow / outcomeRecordedText (I1)", () => {
  const deadline = Date.UTC(2026, 11, 31, 23, 0) / 1000;
  test("the agent attests 30 minutes after the deadline; signing closes 10 minutes before that (R54)", () => {
    expect(outcomeWindow(deadline, deadline - 60)).toEqual({ attestAt: deadline + 1800, cutoff: deadline + 1200, closed: false, attested: false, pastDeadline: false });
    expect(outcomeWindow(deadline, deadline + 1201)).toMatchObject({ closed: true, attested: false, pastDeadline: true });
    expect(outcomeWindow(deadline, deadline + 1800)).toMatchObject({ closed: true, attested: true });
  });
  test("the closed form never says the agent attested before it has (R54)", () => {
    const gap = tooLateText(deadline, deadline + 1500, false);
    expect(gap).toMatch(/^The agent attests this market’s outcome at Dec 31, 23:30 UTC/);
    expect(gap).not.toMatch(/attested/);
    expect(gap).toMatch(/settles No/);
    const after = tooLateText(deadline, deadline + 1800, true);
    expect(after).toMatch(/^The agent attested this market’s outcome at Dec 31, 23:30 UTC/);
    expect(after).toMatch(/the outcome recorded here/);
  });
  test("the success notice says when the agent attests and that the market settles after the 12-hour dispute window", () => {
    const t = outcomeRecordedText("pabcdefghij", true, deadline, deadline - 86_400);
    expect(t).toBe(
      "Outcome recorded for pabcdefghij: Yes. The agent picks it up within a few minutes and attests it at Dec 31, 23:30 UTC, 30 minutes after the deadline; the market settles when the 12-hour dispute window after that ends.",
    );
    expect(t).not.toMatch(/settles it after the deadline/);
  });
});

describe("nextNonce (M6)", () => {
  test("the clock, but always above the admin's last nonce", () => {
    expect(nextNonce(1_800_000_000_000, 5n)).toBe(1_800_000_000_000n);
    // a signature from a machine whose clock ran a year ahead no longer locks the admin out
    expect(nextNonce(1_800_000_000_000, 1_831_536_000_000n)).toBe(1_831_536_000_001n);
    expect(nextNonce(1_800_000_000_000, 1_800_000_000_000n)).toBe(1_800_000_000_001n);
  });
});

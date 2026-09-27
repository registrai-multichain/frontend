import { describe, expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import {
  PROPOSAL_DOMAIN, SEED, TREASURY, approvalMessage, approvalTypedData, duplicateOf, newProposalId,
  normalizeQuestion, outcomeTypedData, validateProposal, type Proposal,
} from "./market-proposals";

const NOW = 1_790_500_000; // a fixed unix second
const DAY = 86_400;
const grid = (t: number) => t - (t % 300);
const base = { kind: "event", question: "Will Circle announce native USDC on a new chain before Dec 31, 2026?", rule: "Circle publishes an official announcement.", source: "https://www.circle.com/blog", deadline: grid(NOW + 30 * DAY) };

describe("validateProposal", () => {
  test("accepts a complete yes/no event", () => {
    const v = validateProposal(base, NOW);
    expect(v.ok).toBe(true);
  });
  test("refuses a deadline under 24 h, over 366 days, or off the 5-minute grid", () => {
    expect(validateProposal({ ...base, deadline: grid(NOW + 3600) }, NOW)).toMatchObject({ ok: false, field: "deadline" });
    expect(validateProposal({ ...base, deadline: grid(NOW + 400 * DAY) }, NOW)).toMatchObject({ ok: false, field: "deadline" });
    expect(validateProposal({ ...base, deadline: grid(NOW + 30 * DAY) + 60 }, NOW)).toMatchObject({ ok: false, field: "deadline" });
  });
  test("a price proposal needs a known asset, a comparator and a positive price", () => {
    const price = { kind: "price", question: "Will ETH be at least $3,000?", rule: "", source: "", deadline: base.deadline };
    expect(validateProposal({ ...price, asset: "doge-usd", comparator: 1, price: "3000" }, NOW)).toMatchObject({ ok: false, field: "asset" });
    expect(validateProposal({ ...price, asset: "eth-usd", comparator: 2, price: "3000" }, NOW)).toMatchObject({ ok: false, field: "comparator" });
    expect(validateProposal({ ...price, asset: "eth-usd", comparator: 1, price: "-1" }, NOW)).toMatchObject({ ok: false, field: "price" });
    expect(validateProposal({ ...price, asset: "eth-usd", comparator: 3, price: "3000.5" }, NOW).ok).toBe(true);
  });
  test("price fractional digits must match the asset's decimals", () => {
    const price = { kind: "price", question: "Will ETH be at least $3,000?", rule: "", source: "", deadline: base.deadline };
    expect(validateProposal({ ...price, asset: "eth-usd", comparator: 1, price: "3000.567" }, NOW)).toMatchObject({ ok: false, field: "price" });
    expect(validateProposal({ ...price, asset: "sol-usd", comparator: 1, price: "0.123" }, NOW).ok).toBe(true);
    expect(validateProposal({ ...price, asset: "eth-usd", comparator: 3, price: "3000.5" }, NOW).ok).toBe(true);
  });
  test("an event needs a public https source; the creator payee must be an address or empty", () => {
    expect(validateProposal({ ...base, source: "ftp://x" }, NOW)).toMatchObject({ ok: false, field: "source" });
    expect(validateProposal({ ...base, creatorPayee: "0x123" }, NOW)).toMatchObject({ ok: false, field: "creatorPayee" });
    expect(validateProposal({ ...base, creatorPayee: "" }, NOW).ok).toBe(true);
  });
  test("the honeypot and oversize fields are refused", () => {
    expect(validateProposal({ ...base, website2: "http://spam" }, NOW)).toMatchObject({ ok: false });
    expect(validateProposal({ ...base, question: "x".repeat(301) }, NOW)).toMatchObject({ ok: false, field: "question" });
  });
  test("phase-2 kinds are accepted (queued later), unknown kinds are not", () => {
    expect(validateProposal({ ...base, kind: "wonder" }, NOW).ok).toBe(true);
    expect(validateProposal({ ...base, kind: "lottery" }, NOW)).toMatchObject({ ok: false, field: "kind" });
  });
});

describe("ids and questions", () => {
  test("ids are p + 10 base32 chars", () => {
    expect(newProposalId(new Uint8Array(10).fill(255))).toMatch(/^p[a-z2-7]{10}$/);
  });
  test("normalizeQuestion folds case, punctuation and spaces for duplicate checks", () => {
    expect(normalizeQuestion("  Will the ARC token trade publicly?! ")).toBe(normalizeQuestion("will the arc token trade publicly"));
  });
});

describe("EIP-712", () => {
  const admin = privateKeyToAccount("0x3ec912428587e37069d4d58feb4327017c5cfca8d34399e1b9b10938a4cc709d");
  const p = { ...(base as object), id: "pabcdefghij", createdAt: "2026-09-27T12:00:00.000Z", status: "pending" } as Proposal;
  test("an approval binds chain 5042, MarketsV4, seed 5 USDC and the treasury when no payee", async () => {
    const msg = approvalMessage(p, 1n);
    expect(PROPOSAL_DOMAIN.chainId).toBe(5042);
    expect(msg.seed).toBe(SEED);
    expect(msg.creatorPayee.toLowerCase()).toBe(TREASURY.toLowerCase());
    expect(msg.kind).toBe(1);
    expect(msg.threshold).toBe(1n);
    const td = approvalTypedData(msg);
    const sig = await admin.signTypedData(td);
    expect((await recoverTypedDataAddress({ ...td, signature: sig })).toLowerCase()).toBe(admin.address.toLowerCase());
  });
  test("a price approval scales the threshold by the asset's decimals", () => {
    const msg = approvalMessage({ ...p, kind: "price", asset: "eth-usd", comparator: 3, price: "3000.5" } as Proposal, 2n);
    expect(msg.kind).toBe(2);
    expect(msg.comparator).toBe(3);
    expect(msg.threshold).toBe(300050n); // ETH has 2 decimals
  });
  test("editing any signed field changes the digest", async () => {
    const a = approvalTypedData(approvalMessage(p, 1n));
    const b = approvalTypedData(approvalMessage({ ...p, question: p.question + " " } as Proposal, 1n));
    const sig = await admin.signTypedData(a);
    expect((await recoverTypedDataAddress({ ...b, signature: sig })).toLowerCase()).not.toBe(admin.address.toLowerCase());
  });
  test("an outcome typed-data round-trips", async () => {
    const td = outcomeTypedData({ proposalId: p.id, value: 1n, since: 1_790_600_000n, evidenceUrl: "https://x.test/a", nonce: 3n });
    const sig = await admin.signTypedData(td);
    expect((await recoverTypedDataAddress({ ...td, signature: sig })).toLowerCase()).toBe(admin.address.toLowerCase());
  });
  test("approvalMessage throws when called on a phase-2 kind", () => {
    expect(() => approvalMessage({ ...p, kind: "wonder" } as Proposal, 1n)).toThrow("cannot approve a wonder proposal (phase 2)");
  });
});

describe("duplicateOf", () => {
  const mk = (id: string, q: string) => ({ ...(base as object), id, question: q, createdAt: "", status: "pending" }) as Proposal;
  test("flags a live market or another open proposal with the same normalised question", () => {
    expect(duplicateOf(mk("pa", "Will the Arc token trade publicly?"), [], ["will the arc token trade publicly"])).toBe("live market");
    expect(duplicateOf(mk("pa", "Will X happen?!"), [mk("pb", "will x happen")], [])).toBe("pb");
    expect(duplicateOf(mk("pa", "Will X happen?"), [mk("pa", "Will X happen?")], [])).toBeNull();
  });
});

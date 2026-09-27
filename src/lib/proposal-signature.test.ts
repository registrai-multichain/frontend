import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  PROPOSAL_APPROVERS, approvalMessage, approvalTypedData, outcomeTypedData, toJsonApproval, toJsonOutcome, type Proposal,
} from "./market-proposals";
import { COMPARATOR } from "./perennial-market";
import { verifiedApproval, verifiedOutcome, verifiedProposalInfo } from "./proposal-signature";
import { proposalEventMeta } from "./rounds";

const TEAM = privateKeyToAccount("0x3ec912428587e37069d4d58feb4327017c5cfca8d34399e1b9b10938a4cc709d");
const OTHER = privateKeyToAccount("0xd0da1b16554d9291f766b84ee2688aabf71ba7e15977e5e1a906671e41f3014a");
const APPROVERS = [TEAM.address];
const ID = "pabcdefghij";
const DEADLINE = 1_800_000_000;
const RULE = "Yes if the release is tagged on GitHub.";
const PROPOSAL: Proposal = {
  id: ID, kind: "event", question: "Will X ship by Friday?", rule: RULE, source: "https://example.org/releases", deadline: DEADLINE,
  createdAt: "2026-09-27T12:00:00.000Z", status: "approved",
};
const MARKET = { key: `p-${ID}`, marketId: `0x${"9".repeat(64)}` as `0x${string}`, expiry: DEADLINE, threshold: 1n, comparator: COMPARATOR.GreaterOrEqual };

async function record(opts: { signer?: typeof TEAM; tamper?: (m: ReturnType<typeof toJsonApproval>) => void; noSignature?: boolean; recordQuestion?: string } = {}) {
  const msg = approvalMessage(PROPOSAL, 1_790_000_000_000n);
  const signature = await (opts.signer ?? TEAM).signTypedData(approvalTypedData(msg));
  const message = toJsonApproval(msg);
  opts.tamper?.(message);
  const out = { message: JSON.parse(JSON.stringify(message)), signature, signer: TEAM.address } as Record<string, unknown>;
  if (opts.noSignature) delete out.signature;
  const oc = { proposalId: ID, value: 1n, since: BigInt(DEADLINE - 3600), evidenceUrl: "https://example.org/v1", nonce: 1_790_000_000_001n };
  return {
    proposal: {
      ...PROPOSAL,
      question: opts.recordQuestion ?? message.question,
      approval: out,
      outcome: { message: toJsonOutcome(oc), signature: await TEAM.signTypedData(outcomeTypedData(oc)), signer: TEAM.address },
    },
  };
}
const meta = async (json: unknown) => proposalEventMeta(MARKET, await verifiedProposalInfo(json, ID, APPROVERS));
const fellBack = (m: Awaited<ReturnType<typeof meta>>) => {
  expect(m.question).toBe(`Proposal #${ID}`);
  expect(m.proposal).toMatchObject({ verified: false, rule: undefined, source: undefined });
};

describe("I4: a proposed market shows the API's words only under the team's signature", () => {
  test("a valid approval by an approver shows the question, rule, source and (signed) evidence", async () => {
    const m = await meta(await record());
    expect(m.question).toBe(PROPOSAL.question);
    expect(m.proposal).toMatchObject({ verified: true, rule: RULE, source: "https://example.org/releases" });
    expect(m.evidenceUrl).toBe("https://example.org/v1");
  });
  test("signed by a wallet that is not an approver: Proposal #id, raw terms", async () => {
    fellBack(await meta(await record({ signer: OTHER })));
  });
  test("a question changed after signing (record and message alike): Proposal #id", async () => {
    fellBack(await meta(await record({ tamper: (m) => (m.question = "Will X ship by Monday?"), recordQuestion: "Will X ship by Monday?" })));
  });
  test("a ruleHash changed after signing (to vouch for another rule): Proposal #id", async () => {
    const other = "Yes if anything at all happens.";
    const json = await record({ tamper: (m) => (m.ruleHash = keccak256(toBytes(other))) });
    (json.proposal as { rule: string }).rule = other;
    fellBack(await meta(json));
  });
  test("no signature, no approval, or a malformed one: Proposal #id", async () => {
    fellBack(await meta(await record({ noSignature: true })));
    const none = await record();
    delete (none.proposal as { approval?: unknown }).approval;
    fellBack(await meta(none));
    const extra = await record({ tamper: (m) => Object.assign(m, { note: "x" }) });
    fellBack(await meta(extra));
  });
  test("an unsigned (or tampered) outcome loses its evidence link, and nothing else", async () => {
    const json = await record();
    (json.proposal.outcome.message as { evidenceUrl: string }).evidenceUrl = "https://evil.example/fake";
    const m = await meta(json);
    expect(m.question).toBe(PROPOSAL.question);
    expect(m.evidenceUrl).toBeNull();
  });
  test("verifiedApproval / verifiedOutcome check the proposal id and the approver list", async () => {
    const json = await record();
    expect(await verifiedApproval(json.proposal.approval, ID, APPROVERS)).toMatchObject({ question: PROPOSAL.question });
    expect(await verifiedApproval(json.proposal.approval, "pzzzzzzzzzz", APPROVERS)).toBeNull();
    expect(await verifiedApproval(json.proposal.approval, ID)).toBeNull(); // the compiled list: not the test key
    expect(await verifiedOutcome(json.proposal.outcome, ID, APPROVERS)).toMatchObject({ value: "1" });
    expect(await verifiedOutcome(json.proposal.outcome, ID, [OTHER.address])).toBeNull();
  });
});

describe("PROPOSAL_APPROVERS", () => {
  const root = join(__dirname, "..", "..");
  test("equals the builders-site ADMIN_ADDRESSES (wrangler.toml)", () => {
    const toml = readFileSync(join(root, "builders-site", "wrangler.toml"), "utf8");
    const admins = /^ADMIN_ADDRESSES\s*=\s*"([^"]*)"/m.exec(toml)?.[1] ?? "";
    expect(admins.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean).sort()).toEqual(PROPOSAL_APPROVERS.map((a) => a.toLowerCase()).sort());
  });
  const keeper = join(root, "..", "keeper", "config.arc-mainnet-rounds.json");
  test.skipIf(!existsSync(keeper))("equals the rounds agent's approvers (keeper config.arc-mainnet-rounds.json, when checked out beside)", () => {
    const cfg = JSON.parse(readFileSync(keeper, "utf8")) as { approvers?: string[] };
    expect((cfg.approvers ?? []).map((a) => a.toLowerCase()).sort()).toEqual(PROPOSAL_APPROVERS.map((a) => a.toLowerCase()).sort());
  });
});

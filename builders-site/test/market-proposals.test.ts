import { describe, expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { approvalMessage, approvalTypedData, outcomeTypedData, toJsonApproval, toJsonOutcome, type Proposal } from "../../src/lib/market-proposals";
import type { Env } from "../lib/env";
import {
  handleAdminApprove, handleAdminList, handleAdminOutcome, handleAdminPatch, handleAdminReject,
  handleApprovedFeed, handleOutcomesFeed, handlePreflight, handleStatus, handleSubmit,
} from "../lib/market-proposals";
import { MemoryKV } from "./memory-kv";

const APP = "https://app.registrai.cc";
const T0 = Date.parse("2026-09-27T12:00:00.000Z");
const nowS = Math.floor(T0 / 1000);
const grid = (t: number) => t - (t % 300);
const ADMIN = privateKeyToAccount("0x3ec912428587e37069d4d58feb4327017c5cfca8d34399e1b9b10938a4cc709d");
const OTHER = privateKeyToAccount("0xd0da1b16554d9291f766b84ee2688aabf71ba7e15977e5e1a906671e41f3014a");
const body = { kind: "event", question: "Will Circle announce native USDC on a new chain?", rule: "Official Circle post.", source: "https://www.circle.com/blog", deadline: grid(nowS + 30 * 86400) };

function setup() {
  const kv = new MemoryKV(() => T0);
  const env: Env = { INVITES: kv, SITE_ORIGIN: "https://builder.registrai.cc", NONCE_SECRET: "s", ADMIN_ADDRESSES: ADMIN.address.toLowerCase(), PROPOSALS_ALLOWED_ORIGIN: APP };
  let n = 0;
  const rand = () => new Uint8Array(10).map(() => (n++ * 7) % 256);
  const submit = (b: Record<string, unknown>, ip = "1.1.1.1", origin = APP) =>
    handleSubmit(new Request("https://builder.registrai.cc/api/market-proposals", { method: "POST", headers: { "content-type": "application/json", origin, "cf-connecting-ip": ip }, body: JSON.stringify(b) }), env, { now: T0, rand });
  const adminReq = (url: string, method: string, b?: unknown) => new Request(`https://builder.registrai.cc${url}`, { method, headers: { "content-type": "application/json", origin: "https://builder.registrai.cc" }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { env, kv, submit, adminReq };
}

describe("public submit", () => {
  test("stores a pending proposal and answers with CORS for the app only", async () => {
    const s = setup();
    const r = await s.submit(body);
    expect(r.status).toBe(201);
    expect(r.headers.get("access-control-allow-origin")).toBe(APP);
    const { id } = (await r.json()) as { id: string };
    expect(id).toMatch(/^p[a-z2-7]{10}$/);
    const st = await handleStatus(new Request(`https://x/api/market-proposals/${id}`), s.env, id);
    const { proposal } = (await st.json()) as { proposal: Proposal };
    expect(proposal.status).toBe("pending");
    expect("contact" in proposal).toBe(false);
  });
  test("refuses another origin, invalid input with the field, and the 6th proposal of the day from one IP", async () => {
    const s = setup();
    expect((await s.submit(body, "1.1.1.1", "https://evil.test")).status).toBe(403);
    const bad = await s.submit({ ...body, deadline: 5 });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { field?: string }).field).toBe("deadline");
    for (let i = 0; i < 5; i++) expect((await s.submit(body, "2.2.2.2")).status).toBe(201);
    expect((await s.submit(body, "2.2.2.2")).status).toBe(429);
  });
  test("phase-2 kinds are stored as queued", async () => {
    const s = setup();
    const r = await s.submit({ ...body, kind: "wonder" });
    const { status } = (await r.json()) as { status: string };
    expect(status).toBe("queued");
  });
  test("a filled honeypot (website2) is refused and nothing is stored", async () => {
    const s = setup();
    const r = await s.submit({ ...body, website2: "http://spam.example" });
    expect(r.status).toBe(400);
    expect([...s.kv.store.keys()].some((k) => k.startsWith("mp:"))).toBe(false);
  });
});

describe("GET /api/market-proposals/<id>", () => {
  test("an unknown id and a malformed id both 404, with CORS for the app", async () => {
    const s = setup();
    const unknown = await handleStatus(new Request("https://x"), s.env, "pabcdefghij");
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("access-control-allow-origin")).toBe(APP);
    const malformed = await handleStatus(new Request("https://x"), s.env, "not-an-id");
    expect(malformed.status).toBe(404);
  });
});

describe("OPTIONS preflight", () => {
  test("answers 204 with CORS for the app", () => {
    const s = setup();
    const r = handlePreflight(s.env);
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe(APP);
    expect(r.headers.get("access-control-allow-methods")).toContain("POST");
    expect(r.headers.get("access-control-allow-headers")).toBe("content-type");
  });
});

describe("admin review", () => {
  async function pending(s: ReturnType<typeof setup>) {
    const { id } = (await (await s.submit({ ...body, creatorPayee: OTHER.address })).json()) as { id: string };
    return id;
  }
  async function current(s: ReturnType<typeof setup>, id: string) {
    return ((await (await handleStatus(new Request("https://x"), s.env, id)).json()) as { proposal: Proposal }).proposal;
  }
  async function approve(s: ReturnType<typeof setup>, id: string, nonce = 1n) {
    const msg = approvalMessage(await current(s, id), nonce);
    const signature = await ADMIN.signTypedData(approvalTypedData(msg));
    return { msg, signature, res: await handleAdminApprove(s.adminReq(`/x`, "POST", { message: toJsonApproval(msg), signature }), s.env, id, ADMIN.address) };
  }
  test("approve needs the session admin's signature over exactly the current proposal", async () => {
    const s = setup();
    const id = await pending(s);
    const p = { ...(await current(s, id)), contact: undefined } as Proposal;
    const msg = approvalMessage(p, 1n);
    const signature = await ADMIN.signTypedData(approvalTypedData(msg));
    const wrongSigner = await OTHER.signTypedData(approvalTypedData(msg));
    expect((await handleAdminApprove(s.adminReq(`/api/admin/market-proposals/${id}/approve`, "POST", { message: toJsonApproval(msg), signature: wrongSigner }), s.env, id, ADMIN.address)).status).toBe(403);
    const tampered = toJsonApproval({ ...msg, seed: 6_000_000n });
    expect((await handleAdminApprove(s.adminReq(`/api/admin/market-proposals/${id}/approve`, "POST", { message: tampered, signature }), s.env, id, ADMIN.address)).status).toBe(400);
    const ok = await handleAdminApprove(s.adminReq(`/api/admin/market-proposals/${id}/approve`, "POST", { message: toJsonApproval(msg), signature }), s.env, id, ADMIN.address);
    expect(ok.status).toBe(200);
    const feed = (await (await handleApprovedFeed(new Request("https://x/api/market-proposals/approved"), s.env)).json()) as { approvals: { id: string }[] };
    expect(feed.approvals.map((a) => a.id)).toEqual([id]);
  });
  test("a malformed nonce ('x') is refused with 400, never a 500", async () => {
    const s = setup();
    const id = await pending(s);
    const p = await current(s, id);
    const badMessage = { ...toJsonApproval(approvalMessage(p, 1n)), nonce: "x" };
    const res = await handleAdminApprove(s.adminReq(`/x`, "POST", { message: badMessage, signature: "0x00" }), s.env, id, ADMIN.address);
    expect(res.status).toBe(400);
  });
  test("an approved (or opened) proposal can no longer be edited or rejected (R9): the agent may already be mid-open", async () => {
    const s = setup();
    const id = await pending(s);
    await approve(s, id);
    const before = (await (await handleApprovedFeed(new Request("https://x"), s.env)).json()) as { approvals: unknown[] };

    const patchRes = await handleAdminPatch(s.adminReq(`/x`, "PATCH", { question: "Will Circle announce native USDC on two new chains?" }), s.env, id, ADMIN.address, { now: T0 });
    expect(patchRes.status).toBe(409);
    const rejectRes = await handleAdminReject(s.adminReq(`/x`, "POST", { reason: "changed mind" }), s.env, id);
    expect(rejectRes.status).toBe(409);

    const after = (await (await handleApprovedFeed(new Request("https://x"), s.env)).json()) as { approvals: { id: string }[] };
    expect(after).toEqual(before);
    expect(after.approvals[0].id).toBe(id);
  });
  test("a nonce not above the admin's last one is refused (replay)", async () => {
    const s = setup();
    const a = await pending(s);
    const b = await pending(s);
    const sign = async (id: string, nonce: bigint) => {
      const msg = approvalMessage(await current(s, id), nonce);
      return handleAdminApprove(s.adminReq(`/x`, "POST", { message: toJsonApproval(msg), signature: await ADMIN.signTypedData(approvalTypedData(msg)) }), s.env, id, ADMIN.address);
    };
    expect((await sign(a, 5n)).status).toBe(200);
    expect((await sign(b, 5n)).status).toBe(409);
    expect((await sign(b, 6n)).status).toBe(200);
  });
  test("reject stores the reason; list filters by status", async () => {
    const s = setup();
    const id = await pending(s);
    await handleAdminReject(s.adminReq(`/x`, "POST", { reason: "no single public source" }), s.env, id);
    const list = (await (await handleAdminList(s.adminReq(`/api/admin/market-proposals?status=rejected`, "GET"), s.env)).json()) as { proposals: Proposal[] };
    expect(list.proposals[0]).toMatchObject({ id, status: "rejected", reason: "no single public source" });
  });
  test("patching a rejected proposal back to pending clears the old rejection reason", async () => {
    const s = setup();
    const id = await pending(s);
    await handleAdminReject(s.adminReq(`/x`, "POST", { reason: "no single public source" }), s.env, id);
    const r = await handleAdminPatch(s.adminReq(`/x`, "PATCH", { question: "Will Circle announce native USDC on two new chains?" }), s.env, id, ADMIN.address, { now: T0 });
    const { proposal } = (await r.json()) as { proposal: Proposal };
    expect(proposal.status).toBe("pending");
    expect(proposal.reason).toBeUndefined();
  });
  test("an outcome needs an approved/opened proposal and the admin's signature", async () => {
    const s = setup();
    const id = await pending(s);
    const out = { proposalId: id, value: 1n, since: BigInt(nowS), evidenceUrl: "https://www.circle.com/blog/x", nonce: 9n };
    const sig = await ADMIN.signTypedData(outcomeTypedData(out));
    expect((await handleAdminOutcome(s.adminReq(`/x`, "POST", { message: toJsonOutcome(out), signature: sig }), s.env, id, ADMIN.address)).status).toBe(409);
  });
  test("an outcome on an approved proposal succeeds and appears in the outcomes feed", async () => {
    const s = setup();
    const id = await pending(s);
    expect((await approve(s, id)).res.status).toBe(200);
    const out = { proposalId: id, value: 1n, since: BigInt(nowS), evidenceUrl: "https://www.circle.com/blog/x", nonce: 2n };
    const sig = await ADMIN.signTypedData(outcomeTypedData(out));
    const res = await handleAdminOutcome(s.adminReq(`/x`, "POST", { message: toJsonOutcome(out), signature: sig }), s.env, id, ADMIN.address);
    expect(res.status).toBe(200);
    const feed = (await (await handleOutcomesFeed(new Request("https://x"), s.env)).json()) as { outcomes: { id: string }[] };
    expect(feed.outcomes.map((o) => o.id)).toEqual([id]);
  });
  test("an outcome signed by another wallet is refused", async () => {
    const s = setup();
    const id = await pending(s);
    expect((await approve(s, id)).res.status).toBe(200);
    const out = { proposalId: id, value: 1n, since: BigInt(nowS), evidenceUrl: "https://www.circle.com/blog/x", nonce: 2n };
    const wrongSig = await OTHER.signTypedData(outcomeTypedData(out));
    const res = await handleAdminOutcome(s.adminReq(`/x`, "POST", { message: toJsonOutcome(out), signature: wrongSig }), s.env, id, ADMIN.address);
    expect(res.status).toBe(403);
  });
});

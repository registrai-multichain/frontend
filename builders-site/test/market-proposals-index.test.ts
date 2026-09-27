/**
 * C1 / M1 / M4 / M6 / I3 of the final review: the proposals API's KV budget (feed docs,
 * key metadata, pagination, the global cap, the migration), the outcome rules, CORS on
 * every submit error, the admin's last nonce and approvedAt.
 */
import { describe, expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  OUTCOME_GRACE_S, OUTCOME_PICKUP_S, approvalMessage, newProposalId, approvalTypedData, outcomeTypedData, proposalSummary, toJsonApproval, toJsonOutcome,
  type OutcomeMessage, type Proposal, type ProposalSummary,
} from "../../src/lib/market-proposals";
import type { Env } from "../lib/env";
import {
  ADMIN_PAGE, FEED_APPROVED, FEED_OUTCOMES, MP_GLOBAL_DAILY_LIMIT, feedCacheKey, handleAdminApprove, handleAdminGet, handleAdminList,
  handleAdminOutcome, handleAdminRebuild, handleApprovedFeed, handleOutcomesFeed, handleStatus, handleSubmit,
} from "../lib/market-proposals";
import { MemoryKV } from "./memory-kv";

const APP = "https://app.registrai.cc";
const T0 = Date.parse("2026-09-27T12:00:00.000Z");
const nowS = Math.floor(T0 / 1000);
const grid = (t: number) => t - (t % 300);
const ADMIN = privateKeyToAccount("0x3ec912428587e37069d4d58feb4327017c5cfca8d34399e1b9b10938a4cc709d");
const DEADLINE = grid(nowS + 30 * 86400);
const body = { kind: "event", question: "Will Circle announce native USDC on a new chain?", rule: "Official Circle post.", source: "https://www.circle.com/blog", deadline: DEADLINE };

/** Distinct ids: the counter in base 32, one digit per byte. */
const idBytes = (c: number) => Uint8Array.from({ length: 10 }, (_, i) => Math.floor(c / 32 ** i) % 32);

/** MemoryKV that counts operations. */
class CountingKV extends MemoryKV {
  ops = { get: 0, put: 0, list: 0, delete: 0 };
  reset() {
    this.ops = { get: 0, put: 0, list: 0, delete: 0 };
  }
  override async get(key: string) {
    this.ops.get++;
    return super.get(key);
  }
  override async put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }) {
    this.ops.put++;
    return super.put(key, value, options);
  }
  override async list<M = unknown>(options?: { prefix?: string; cursor?: string; limit?: number }) {
    this.ops.list++;
    return super.list<M>(options);
  }
}

function setup() {
  const kv = new CountingKV(() => T0);
  const env: Env = { INVITES: kv, SITE_ORIGIN: "https://builder.registrai.cc", NONCE_SECRET: "s", ADMIN_ADDRESSES: ADMIN.address.toLowerCase(), PROPOSALS_ALLOWED_ORIGIN: APP };
  let n = 0;
  const rand = () => idBytes(n++);
  const submit = async (b: Record<string, unknown> = body, ip = `10.0.0.${n}`, headers: Record<string, string> = {}, raw?: string) =>
    handleSubmit(
      new Request("https://builder.registrai.cc/api/market-proposals", {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP, "cf-connecting-ip": ip, ...headers },
        body: raw ?? JSON.stringify(b),
      }),
      env,
      { now: T0, rand },
    );
  const adminReq = (url: string, method: string, b?: unknown) =>
    new Request(`https://builder.registrai.cc${url}`, { method, headers: { "content-type": "application/json", origin: "https://builder.registrai.cc" }, body: b === undefined ? undefined : JSON.stringify(b) });
  const newId = async (b: Record<string, unknown> = body) => ((await (await submit(b)).json()) as { id: string }).id;
  const record = async (id: string) => JSON.parse((await kv.get(`mp:${id}`))!) as Proposal;
  const approve = async (id: string, nonce: bigint, now = T0) => {
    const msg = approvalMessage(await record(id), nonce);
    const signature = await ADMIN.signTypedData(approvalTypedData(msg));
    return handleAdminApprove(adminReq("/x", "POST", { message: toJsonApproval(msg), signature }), env, id, ADMIN.address, { now });
  };
  const outcome = async (id: string, m: Partial<OutcomeMessage> & { nonce: bigint }, opts: { now?: number; extra?: Record<string, unknown> } = {}) => {
    const msg: OutcomeMessage = { proposalId: id, value: 1n, since: BigInt(nowS), evidenceUrl: "https://www.circle.com/blog/x", ...m };
    const signature = await ADMIN.signTypedData(outcomeTypedData(msg));
    return handleAdminOutcome(adminReq("/x", "POST", { message: { ...toJsonOutcome(msg), ...opts.extra }, signature }), env, id, ADMIN.address, { now: opts.now ?? T0 });
  };
  const list = async (query = "") => (await handleAdminList(adminReq(`/api/admin/market-proposals${query}`, "GET"), env, ADMIN.address)).json() as Promise<{ proposals: ProposalSummary[]; cursor: string | null; lastNonce: string }>;
  return { env, kv, submit, adminReq, newId, record, approve, outcome, list };
}

/** The feeds as the pre-index code built them: a list of every mp: record, newest first. */
async function oldFeeds(kv: MemoryKV) {
  const all = [...kv.store.entries()].filter(([k]) => k.startsWith("mp:")).map(([, v]) => JSON.parse(v.value) as Proposal);
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    approved: JSON.stringify({ approvals: all.filter((p) => p.approval && (p.status === "approved" || p.status === "opened")).map((p) => ({ id: p.id, approval: p.approval, deadline: p.deadline })) }),
    outcomes: JSON.stringify({ outcomes: all.filter((p) => p.outcome).map((p) => ({ id: p.id, outcome: p.outcome })) }),
  };
}

describe("C1: the agent's feeds are one KV read each", () => {
  test("with many proposals, /approved and /outcomes each make exactly one get and no list, cached 30 s publicly", async () => {
    const s = setup();
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push(await s.newId());
    for (let i = 0; i < 4; i++) expect((await s.approve(ids[i], BigInt(i + 1))).status).toBe(200);
    expect((await s.outcome(ids[0], { nonce: 10n })).status).toBe(200);
    s.kv.reset();
    const a = await handleApprovedFeed(new Request("https://x/api/market-proposals/approved"), s.env);
    expect(s.kv.ops).toEqual({ get: 1, put: 0, list: 0, delete: 0 });
    expect(a.headers.get("cache-control")).toBe("public, max-age=30");
    s.kv.reset();
    const o = await handleOutcomesFeed(new Request("https://x/api/market-proposals/outcomes"), s.env);
    expect(s.kv.ops).toEqual({ get: 1, put: 0, list: 0, delete: 0 });
    expect(o.headers.get("cache-control")).toBe("public, max-age=30");
    expect((await a.json()) as { approvals: unknown[] }).toMatchObject({ approvals: expect.any(Array) });
  });

  test("the feeds' bytes are what the keeper read before the index ({approvals:[{id,approval,deadline}]}, {outcomes:[{id,outcome}]}), newest first", async () => {
    const s = setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await s.newId());
    // different createdAt: rewrite through the store so the order is meaningful
    for (const [i, id] of ids.entries()) {
      const p = await s.record(id);
      await s.kv.put(`mp:${id}`, JSON.stringify({ ...p, createdAt: new Date(T0 + (i % 3) * 60_000 + i).toISOString() }), { metadata: proposalSummary(p) });
    }
    await s.approve(ids[3], 1n);
    await s.approve(ids[0], 2n);
    await s.approve(ids[4], 3n);
    await s.outcome(ids[0], { nonce: 4n, value: 0n });
    await s.outcome(ids[4], { nonce: 5n });
    await s.outcome(ids[0], { nonce: 6n }); // replaces the first outcome of ids[0]
    const want = await oldFeeds(s.kv);
    expect(await (await handleApprovedFeed(new Request("https://x"), s.env)).text()).toBe(want.approved);
    expect(await (await handleOutcomesFeed(new Request("https://x"), s.env)).text()).toBe(want.outcomes);
    const out = JSON.parse(want.outcomes) as { outcomes: Array<{ id: string; outcome: { message: { nonce: string } } }> };
    expect(out.outcomes.find((o) => o.id === ids[0])?.outcome.message.nonce).toBe("6");
  });

  test("the edge cache key ignores the query string (?since= included: the agent sends none, the feed is always whole)", () => {
    expect(feedCacheKey("https://builder.registrai.cc/api/market-proposals/outcomes?since=5")).toBe("https://builder.registrai.cc/api/market-proposals/outcomes");
  });
});

describe("C1: the admin list reads key metadata, one page per call", () => {
  test("no per-key get: one list, the two feed docs and the admin's nonce", async () => {
    const s = setup();
    for (let i = 0; i < 20; i++) await s.newId();
    await s.list(); // the first call of a fresh store writes the (empty) feed docs
    s.kv.reset();
    const r = await s.list();
    expect(r.proposals).toHaveLength(20);
    expect(s.kv.ops.list).toBe(1);
    expect(s.kv.ops.get).toBe(3);
    expect(s.kv.ops.put).toBe(0);
    expect(r.proposals[0]).toMatchObject({ status: "pending", kind: "event", question: body.question, deadline: DEADLINE });
    expect(r.cursor).toBeNull();
  });

  test("pages of ADMIN_PAGE keys with a cursor", async () => {
    const s = setup();
    const base = await s.record(await s.newId());
    for (let i = 0; i < ADMIN_PAGE + 30; i++) {
      const p: Proposal = { ...base, id: newProposalId(idBytes(10_000 + i)) };
      await s.kv.put(`mp:${p.id}`, JSON.stringify(p), { metadata: proposalSummary(p) });
    }
    const total = [...s.kv.store.keys()].filter((k) => k.startsWith("mp:")).length;
    await handleAdminRebuild(s.env);
    s.kv.reset();
    const first = await s.list();
    expect(first.proposals).toHaveLength(ADMIN_PAGE);
    expect(first.cursor).not.toBeNull();
    expect(s.kv.ops.list).toBe(1);
    const second = await s.list(`?cursor=${encodeURIComponent(first.cursor!)}`);
    expect(first.proposals.length + second.proposals.length).toBe(total);
    expect(second.cursor).toBeNull();
    expect(new Set([...first.proposals, ...second.proposals].map((p) => p.id)).size).toBe(total);
  });

  test("a summary always fits KV's 1024-byte metadata cap, even for a 300-character non-ASCII question", () => {
    const p = { id: "pabcdefghij", createdAt: new Date(T0).toISOString(), status: "rejected", kind: "event", question: "€".repeat(300), rule: "", source: "", deadline: DEADLINE, reason: "😀".repeat(300), creatorPayee: ADMIN.address } as Proposal;
    const sum = proposalSummary(p);
    expect(new TextEncoder().encode(JSON.stringify(sum)).length).toBeLessThanOrEqual(1000);
    expect(sum.cut).toBe(true);
    expect(proposalSummary({ ...p, question: "Short question here?", reason: "no" }).cut).toBeUndefined();
  });

  test("GET /<id> gives the admin the full record", async () => {
    const s = setup();
    const id = await s.newId({ ...body, contact: "@me" });
    const { proposal } = (await (await handleAdminGet(s.env, id)).json()) as { proposal: Proposal };
    expect(proposal.contact).toBe("@me");
    expect((await handleAdminGet(s.env, "pzzzzzzzzzz")).status).toBe(404);
  });
});

describe("C1: migrating records written before the index", () => {
  async function legacyStore() {
    const s = setup();
    const ids = [await s.newId(), await s.newId(), await s.newId()];
    await s.approve(ids[0], 1n);
    await s.approve(ids[1], 2n);
    await s.outcome(ids[1], { nonce: 3n });
    // as the old code left KV: records without metadata, no feed docs
    for (const [k, v] of [...s.kv.store.entries()]) if (k.startsWith("mp:")) s.kv.store.set(k, { value: v.value });
    s.kv.store.delete(FEED_APPROVED);
    s.kv.store.delete(FEED_OUTCOMES);
    return { s, ids };
  }

  test("the first feed read rebuilds the docs (and metadata); later reads are one get", async () => {
    const { s, ids } = await legacyStore();
    const want = await oldFeeds(s.kv);
    expect(await (await handleApprovedFeed(new Request("https://x"), s.env)).text()).toBe(want.approved);
    expect(s.kv.store.has(FEED_APPROVED) && s.kv.store.has(FEED_OUTCOMES)).toBe(true);
    for (const id of ids) expect(s.kv.store.get(`mp:${id}`)?.metadata).toMatchObject({ id });
    s.kv.reset();
    expect(await (await handleOutcomesFeed(new Request("https://x"), s.env)).text()).toBe(want.outcomes);
    expect(s.kv.ops).toEqual({ get: 1, put: 0, list: 0, delete: 0 });
  });

  test("POST /rebuild is admin-only work that can run any number of times with the same result", async () => {
    const { s } = await legacyStore();
    const r1 = (await (await handleAdminRebuild(s.env)).json()) as { approved: number; outcomes: number; migrated: number };
    expect(r1).toEqual({ approved: 2, outcomes: 1, migrated: 3 });
    const docs = [s.kv.store.get(FEED_APPROVED)?.value, s.kv.store.get(FEED_OUTCOMES)?.value];
    const r2 = (await (await handleAdminRebuild(s.env)).json()) as { migrated: number };
    expect(r2.migrated).toBe(0);
    expect([s.kv.store.get(FEED_APPROVED)?.value, s.kv.store.get(FEED_OUTCOMES)?.value]).toEqual(docs);
    const want = await oldFeeds(s.kv);
    expect(docs[0]).toBeDefined();
    expect(await (await handleApprovedFeed(new Request("https://x"), s.env)).text()).toBe(want.approved);
  });

  test("the admin list migrates a page of legacy records and rebuilds missing feed docs", async () => {
    const { s, ids } = await legacyStore();
    const r = await s.list();
    expect(r.proposals.map((p) => p.id).sort()).toEqual([...ids].sort());
    expect(r.proposals.find((p) => p.id === ids[1])?.outcome).toEqual({ value: "1", nonce: "3" });
    for (const id of ids) expect(s.kv.store.get(`mp:${id}`)?.metadata).toMatchObject({ id });
    const want = await oldFeeds(s.kv);
    expect(s.kv.store.get(FEED_APPROVED)?.value).toBeDefined();
    expect(await (await handleApprovedFeed(new Request("https://x"), s.env)).text()).toBe(want.approved);
  });

  test("an approval missing from the feed doc (a lost write) is put back by the admin list", async () => {
    const s = setup();
    const a = await s.newId();
    const b = await s.newId();
    await s.approve(a, 1n);
    await s.approve(b, 2n);
    const doc = JSON.parse(s.kv.store.get(FEED_APPROVED)!.value) as Array<{ id: string }>;
    await s.kv.put(FEED_APPROVED, JSON.stringify(doc.filter((e) => e.id !== b)));
    await s.list();
    const feed = (await (await handleApprovedFeed(new Request("https://x"), s.env)).json()) as { approvals: Array<{ id: string }> };
    expect(feed.approvals.map((x) => x.id).sort()).toEqual([a, b].sort());
  });
});

describe("C1: a global daily cap on submissions", () => {
  test(`the ${MP_GLOBAL_DAILY_LIMIT + 1}th proposal of the UTC day is refused whatever the IP, with CORS`, async () => {
    const s = setup();
    const day = `mp-day:${new Date(T0).toISOString().slice(0, 10)}`;
    await s.kv.put(day, String(MP_GLOBAL_DAILY_LIMIT - 1));
    expect((await s.submit(body, "7.7.7.1")).status).toBe(201);
    const full = await s.submit(body, "7.7.7.2");
    expect(full.status).toBe(429);
    expect(full.headers.get("access-control-allow-origin")).toBe(APP);
    expect([...s.kv.store.keys()].filter((k) => k.startsWith("mp:"))).toHaveLength(1);
    // the counter lives two days: the next UTC day starts from 0 under its own key
    expect(s.kv.store.get(day)?.expiresAt).toBe(T0 + 2 * 86400 * 1000);
  });
});

describe("M4: every submit error carries the CORS header", () => {
  test("403, 413, 415, 400 and 429 answers all name the app's origin", async () => {
    const s = setup();
    const cors = (r: Response) => r.headers.get("access-control-allow-origin");
    const forbidden = await s.submit(body, "1.1.1.1", { origin: "https://evil.test" });
    expect(forbidden.status).toBe(403);
    expect(cors(forbidden)).toBe(APP);
    const tooBig = await s.submit(body, "1.1.1.1", {}, JSON.stringify({ ...body, why: "x".repeat(5000) }));
    expect(tooBig.status).toBe(413);
    expect(cors(tooBig)).toBe(APP);
    const badType = await s.submit(body, "1.1.1.1", { "content-type": "text/plain" });
    expect(badType.status).toBe(415);
    expect(cors(badType)).toBe(APP);
    const badJson = await s.submit(body, "1.1.1.1", {}, "{");
    expect(badJson.status).toBe(400);
    expect(cors(badJson)).toBe(APP);
  });
});

describe("M1 + I1: the outcome endpoint takes only what the agent applies", () => {
  async function approvedEvent(s: ReturnType<typeof setup>) {
    const id = await s.newId();
    expect((await s.approve(id, 1n)).status).toBe(200);
    return id;
  }
  test("exact fields, value 0 or 1, since by the deadline", async () => {
    const s = setup();
    const id = await approvedEvent(s);
    expect((await s.outcome(id, { nonce: 2n }, { extra: { note: "hi" } })).status).toBe(400);
    expect((await s.outcome(id, { nonce: 3n, value: 2n })).status).toBe(400);
    expect((await s.outcome(id, { nonce: 4n, since: BigInt(DEADLINE + 60) })).status).toBe(400);
    expect((await s.outcome(id, { nonce: 5n, since: BigInt(DEADLINE), value: 0n })).status).toBe(200);
  });
  test("a price proposal takes no outcome", async () => {
    const s = setup();
    const id = await s.newId({ kind: "price", question: "Will BTC be at least 100000 USD?", rule: "median", source: "", deadline: DEADLINE, asset: "btc-usd", comparator: 1, price: "100000" });
    expect((await s.approve(id, 1n)).status).toBe(200);
    const r = await s.outcome(id, { nonce: 2n });
    expect(r.status).toBe(409);
  });
  test("taken until the deadline + grace − pickup margin, refused after it: use the dispute process", async () => {
    const s = setup();
    const id = await approvedEvent(s);
    const cutoffMs = (DEADLINE + OUTCOME_GRACE_S - OUTCOME_PICKUP_S) * 1000;
    expect((await s.outcome(id, { nonce: 2n, since: BigInt(DEADLINE) }, { now: cutoffMs })).status).toBe(200);
    const late = await s.outcome(id, { nonce: 3n, since: BigInt(DEADLINE) }, { now: cutoffMs + 1000 });
    expect(late.status).toBe(409);
    expect(((await late.json()) as { error: string }).error).toMatch(/too late — use the dispute process/);
  });
});

describe("M6 + I3: the admin's last nonce and approvedAt", () => {
  test("the list gives the signed-in admin's last used nonce", async () => {
    const s = setup();
    const id = await s.newId();
    expect((await s.list()).lastNonce).toBe("0");
    await s.approve(id, 1_900_000_000_000n);
    expect((await s.list()).lastNonce).toBe("1900000000000");
  });
  test("approve stores approvedAt (public on the status record and in the summary); re-signing keeps the first", async () => {
    const s = setup();
    const id = await s.newId();
    await s.approve(id, 1n, T0 + 5_000);
    const { proposal } = (await (await handleStatus(new Request("https://x"), s.env, id)).json()) as { proposal: Proposal };
    expect(proposal.approvedAt).toBe(new Date(T0 + 5_000).toISOString());
    expect((await s.list()).proposals[0].approvedAt).toBe(new Date(T0 + 5_000).toISOString());
    await s.approve(id, 2n, T0 + 60_000);
    expect((await s.record(id)).approvedAt).toBe(new Date(T0 + 5_000).toISOString());
  });
});

"use client";

import { useCallback, useEffect, useId, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useWallet } from "@/components/WalletProvider";
import { ADMIN_SERVICE, adminView, type AdminRole } from "@/lib/builders-admin";
import { adminNav, adminSections, signedOutSections } from "@/lib/admin-sections";
import { shortAddr } from "@/lib/format";
import { humanizeError } from "@/lib/humanize-error";
import { activeProvider } from "@/lib/wallets";
import {
  LIVE_KINDS, MARKETS_V4, PROPOSAL_ASSETS, SEED, approvalMessage, approvalTypedData, approvedAtS, duplicateOf, fromJsonApproval,
  fromJsonOutcome, normalizeQuestion, openingOverdue, outcomeTypedData, proposalSummary, toJsonApproval, toJsonOutcome,
  type Proposal, type ProposalAsset, type ProposalSummary,
} from "@/lib/market-proposals";
import {
  FILTERS, ageLabel, applyDraft, approvalText, draftOf, filterCounts, filterOf, inFilter, isDirty, kindLabel, nextNonce,
  outcomeProblems, outcomeRecordedText, outcomeWindow, parseUtcMinute, tooLateText, patchBody, proposalChecks, shortUtc, wrongChainMessage,
  type Draft, type ProposalFilter,
} from "@/lib/proposals-admin";
import { statusHref } from "@/lib/propose-form";
import mainnetRounds from "@/lib/deployments/arc-mainnet-rounds.json";
import { AdminShell, type AdminNavItem } from "./AdminShell";
import { ADMIN_DEPLOYMENT } from "./deployment";
import a from "./admin.module.css";
import pa from "./proposals-admin.module.css";

/** The shared primitives (admin.module.css) and this page's layout: no class name is in both. */
const s = { ...a, ...pa };

/**
 * builder.registrai.cc/admin/proposals: review, edit, approve (an EIP-712
 * signature by the admin wallet) or reject market proposals, and record the
 * outcome of an approved yes/no event. The page is static; the data is the
 * session-gated /api/admin/market-proposals of the builders-site Functions.
 * Sign-in happens on /admin. An approved proposal is immutable (Ruling R9).
 */

const BUILDERS_SITE = "https://builder.registrai.cc";
const APP_SITE = "https://app.registrai.cc";
const API = "/api/admin/market-proposals";
const ARC_MAINNET = 5042;
const HUMAN = { testnet: false, networkName: "Arc mainnet" };

type Rounds = { events?: Array<{ question?: string }>; contracts?: Record<string, string | null>; agent?: string | null };
const ROUNDS_JSON = mainnetRounds as Rounds;
/** The live markets' questions, for the duplicate check. */
const LIVE_QUESTIONS = (ROUNDS_JSON.events ?? []).map((e) => e.question ?? "").filter(Boolean);
/** Contracts and wallets we control: never a creator payee. USDC is not ours. */
const OWN = [
  MARKETS_V4,
  ...Object.entries(ROUNDS_JSON.contracts ?? {}).filter(([k, v]) => k !== "USDC" && v).map(([, v]) => v as string),
  ...(ROUNDS_JSON.agent ? [ROUNDS_JSON.agent] : []),
];

type ApiState = { state: "checking" } | { state: "unavailable" } | { state: "ready"; address: string | null; role: AdminRole | null };
type Done = (p: Proposal, notice?: string) => void;
/** M6: the next signature's nonce (max(now, the admin's last + 1)), and marking one used. */
type Nonces = { next: () => bigint; used: (n: bigint) => void };
/** The list: every page of summaries (the API pages its KV list), and the admin's last nonce. */
type ListData = { proposals: ProposalSummary[]; lastNonce: bigint };
/** At most this many list pages (ADMIN_PAGE proposals each) are read. */
const MAX_PAGES = 40;

class SignedOut extends Error {}
/** A refusal worded for the admin: shown as is (not through humanizeError). */
class Refusal extends Error {}
const CONNECT_FIRST = "Connect a wallet to sign.";
/** The pane's error line: a refusal, else the wallet's own error (connect / switch failures). */
const shownError = (error: string | null, walletError: string | undefined) =>
  error === CONNECT_FIRST ? (walletError ?? CONNECT_FIRST) : (error ?? walletError ?? null);
const asMessage = (e: unknown) => (e instanceof Refusal ? e.message : humanizeError(e, HUMAN));

type Signer = { address: `0x${string}`; walletClient: NonNullable<ReturnType<typeof useWallet>["walletClient"]> };

/**
 * The wallet, ready to sign for `admin`: connected, the signed-in admin, and on Arc
 * mainnet. WalletProvider's connect() and switchChain() never throw (they set its
 * `error`), so both are checked after the fact; nothing is signed unless all hold.
 * Returns null when a connect just succeeded (the admin clicks again to sign).
 */
function useSigner(admin: string) {
  const { address, walletClient, connect, switchChain } = useWallet();
  return useCallback(async (): Promise<Signer | null> => {
    if (!address || !walletClient) {
      await connect();
      const accounts = ((await activeProvider()?.request({ method: "eth_accounts" }).catch(() => [])) ?? []) as string[];
      if (!accounts.length) throw new Refusal(CONNECT_FIRST);
      return null;
    }
    if (address.toLowerCase() !== admin.toLowerCase()) throw new Refusal(`Sign with the signed-in admin wallet ${shortAddr(admin)}.`);
    const chainOf = () => walletClient.getChainId().catch(() => undefined);
    let chainId = await chainOf();
    if (wrongChainMessage(chainId)) {
      await switchChain(ARC_MAINNET);
      chainId = await chainOf();
    }
    const wrong = wrongChainMessage(chainId);
    if (wrong) throw new Refusal(wrong);
    return { address, walletClient };
  }, [address, walletClient, connect, switchChain, admin]);
}

/** Same-origin JSON call (as AdminApp's): a JSON body (or none) and the parsed reply. */
async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> {
  const method = init.method ?? "GET";
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: method === "GET" ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(init.body ?? {}),
  });
  const body = (await res.json().catch(() => ({}))) as T;
  if (res.status === 401) throw new SignedOut("signed out");
  return { status: res.status, body };
}

const byNewest = (a: ProposalSummary, b: ProposalSummary) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
const idPath = (id: string) => `${API}/${encodeURIComponent(id)}`;

export function ProposalsAdmin() {
  const [api, setApi] = useState<ApiState>({ state: "checking" });
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) throw new Error("no api");
        const me = (await res.json()) as { service?: string; address?: string | null; role?: AdminRole | null };
        if (me.service !== ADMIN_SERVICE) throw new Error("not the admin api");
        if (!off) setApi({ state: "ready", address: me.address ?? null, role: me.role ?? (me.address ? "admin" : null) });
      } catch {
        if (!off) setApi({ state: "unavailable" });
      }
    })();
    return () => {
      off = true;
    };
  }, []);
  const admin = api.state === "ready" ? api.address : null;
  const role: AdminRole = (api.state === "ready" && api.role) || "admin";
  const signOut = useCallback(() => setApi({ state: "ready", address: null, role: null }), []);

  const list = useSWR<ListData>(
    admin ? ["admin-market-proposals", admin] : null,
    async () => {
      const proposals: ProposalSummary[] = [];
      let lastNonce = 0n;
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const r: { status: number; body: { proposals?: ProposalSummary[]; cursor?: string | null; lastNonce?: string; error?: string } } = await call(
          cursor ? `${API}?cursor=${encodeURIComponent(cursor)}` : API,
        );
        if (r.status !== 200 || !r.body.proposals) throw new Error(r.body.error ?? `proposals (${r.status})`);
        proposals.push(...r.body.proposals);
        if (page === 0 && /^\d{1,20}$/.test(r.body.lastNonce ?? "")) lastNonce = BigInt(r.body.lastNonce!);
        cursor = r.body.cursor ?? null;
        if (!cursor) break;
      }
      return { proposals, lastNonce };
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  useEffect(() => {
    if (list.error instanceof SignedOut) signOut();
  }, [list.error, signOut]);

  const [filter, setFilter] = useState<ProposalFilter>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const all = list.data?.proposals ?? [];
  const counts = filterCounts(all);
  const shown = all.filter((p) => inFilter(p, filter)).sort(byNewest);
  const selected = shown.find((p) => p.id === selectedId) ?? shown[0] ?? null;
  // The list carries summaries; the open proposal is read in full.
  const detail = useSWR<Proposal>(
    admin && selected ? ["admin-market-proposal", selected.id] : null,
    async ([, id]: [string, string]) => {
      const r = await call<{ proposal?: Proposal; error?: string }>(idPath(id));
      if (r.status !== 200 || !r.body.proposal) throw new Error(r.body.error ?? `proposal (${r.status})`);
      return r.body.proposal;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  useEffect(() => {
    if (detail.error instanceof SignedOut) signOut();
  }, [detail.error, signOut]);
  const { mutate } = useSWRConfig();

  // M6: never sign a nonce at or below the admin's last one (the API's, or one signed here since).
  const [usedNonce, setUsedNonce] = useState(0n);
  const serverNonce = list.data?.lastNonce ?? 0n;
  const nonces: Nonces = {
    next: () => nextNonce(Date.now(), serverNonce > usedNonce ? serverNonce : usedNonce),
    used: (n) => setUsedNonce((u) => (n > u ? n : u)),
  };

  /** After an action the pane follows the proposal to the filter of its new status. */
  const done: Done = useCallback(
    (p, text) => {
      const sum = proposalSummary(p);
      list.mutate((prev) => prev && { ...prev, proposals: prev.proposals.map((o) => (o.id === p.id ? sum : o)) }, { revalidate: false });
      void mutate(["admin-market-proposal", p.id], p, { revalidate: false });
      setFilter(filterOf(p.status));
      setSelectedId(p.id);
      if (text) setNotice(text);
    },
    [list, mutate],
  );
  const failed = useCallback((e: unknown) => {
    if (e instanceof SignedOut) signOut();
  }, [signOut]);

  return (
    <AdminShell nav={proposalsNav(admin ? role : null, list.data ? counts.pending : null)} active="proposals" who={admin ? { address: admin, role } : null}>
      <div className={s.head}>
        <div>
          <h1 className={s.h1}>Market proposals</h1>
          <p className={s.sub}>
            Approving signs the exact market with your admin wallet; the agent opens only markets carrying a valid admin
            signature.
          </p>
        </div>
        {admin && (
          <div className={s.pills} role="group" aria-label="Filter">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={s.pill} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
                {f.count && list.data ? ` ${counts[f.id]}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {notice && (
        <p className={s.notice} role="status">
          {notice}
        </p>
      )}

      {api.state === "checking" && <p className={s.state}>Checking the admin API…</p>}
      {api.state === "unavailable" && (
        <div className={s.stateBox}>
          <h2 className={s.stateTitle}>Admin runs on builder.registrai.cc</h2>
          <p className={s.state}>
            <a href={`${BUILDERS_SITE}/admin/proposals/`}>Open builder.registrai.cc/admin/proposals →</a>
          </p>
        </div>
      )}
      {api.state === "ready" && !admin && (
        <div className={s.stateBox}>
          <h2 className={s.stateTitle}>Sign in on /admin first</h2>
          <p className={s.state}>
            Proposals are behind the admin session. <a href="/admin/">Sign in on /admin</a>, then come back here.
          </p>
        </div>
      )}
      {admin && list.error && !(list.error instanceof SignedOut) && (
        <p className={s.error} role="alert">
          Could not load proposals: {(list.error as Error).message}{" "}
          <button type="button" className={s.quiet} onClick={() => list.mutate()}>
            Try again
          </button>
        </p>
      )}
      {admin && !list.data && !list.error && <p className={s.state}>Loading proposals…</p>}

      {admin && list.data && (
        <div className={s.grid}>
          <section className={s.list} aria-label={`${FILTERS.find((f) => f.id === filter)?.label} proposals`}>
            {shown.length === 0 && <p className={s.empty}>No {filter === "queued" ? "phase 2" : filter} proposals.</p>}
            {shown.map((p) => (
              <ProposalCard
                key={p.id}
                p={p}
                all={all}
                now={now}
                selected={selected?.id === p.id}
                onSelect={() => {
                  setSelectedId(p.id);
                  setNotice(null);
                }}
              />
            ))}
          </section>
          {selected && detail.data?.id === selected.id && (
            <Detail key={selected.id} p={detail.data} all={all} now={now} admin={admin} role={role} nonces={nonces} onDone={done} onFailed={failed} />
          )}
          {selected && detail.data?.id !== selected.id && (
            <section className={s.detail} aria-label="Proposal detail">
              {detail.error && !(detail.error instanceof SignedOut) ? (
                <p className={s.error} role="alert">
                  Could not load {selected.id}: {(detail.error as Error).message}{" "}
                  <button type="button" className={s.quiet} onClick={() => detail.mutate()}>
                    Try again
                  </button>
                </p>
              ) : (
                <p className={s.state}>Loading {selected.id}…</p>
              )}
            </section>
          )}
        </div>
      )}
    </AdminShell>
  );
}

/** The admin rail: the /admin sections this session sees (links into /admin), then this page. */
function proposalsNav(role: AdminRole | null, pending: number | null): AdminNavItem[] {
  // Signed out (role unknown): only the sections every role has.
  const sections = role ? adminSections(adminView(role), ADMIN_DEPLOYMENT) : signedOutSections(ADMIN_DEPLOYMENT, adminView("onboarder"));
  return adminNav(sections, "/admin/", { proposals: pending });
}

function liveMatchOf(p: Pick<Proposal, "question">): string | null {
  const q = normalizeQuestion(p.question);
  return LIVE_QUESTIONS.find((l) => normalizeQuestion(l) === q) ?? null;
}

function payeeText(p: Pick<Proposal, "creatorPayee">) {
  return p.creatorPayee ? `creator ${shortAddr(p.creatorPayee).toLowerCase()}` : "no creator wallet → treasury";
}

function ProposalCard({ p, all, now, selected, onSelect }: { p: ProposalSummary; all: ProposalSummary[]; now: number; selected: boolean; onSelect: () => void }) {
  const dup = p.status === "rejected" ? null : duplicateOf(p, all, LIVE_QUESTIONS);
  const nowS = Math.floor(now / 1000);
  let line: string;
  if (dup === "live market") line = `Matches the live market “${liveMatchOf(p)}”`;
  else if (dup) line = `Matches proposal ${dup}`;
  else if (p.status === "rejected") line = `Rejected: ${p.reason ?? "no reason given"}`;
  else if (p.kind === "price") line = `Median of Coinbase, Kraken, OKX · ${payeeText(p)}`;
  else line = `Deadline ${shortUtc(p.deadline, nowS)} · ${payeeText(p)}`;
  return (
    <button type="button" className={s.card} aria-current={selected} onClick={onSelect}>
      <span className={s.meta}>
        <span className={s.kindPill}>{kindLabel(p.kind)}</span>
        <span>{ageLabel(p.createdAt, now)}</span>
        {p.status === "opened" && <span>opened</span>}
        {openingOverdue(p, nowS) && <span>approved {ageOf(approvedAtS(p, nowS), now)} · check it opened</span>}
        {p.outcome && <span>outcome recorded</span>}
        {dup && <span className={s.dup}>possible duplicate</span>}
      </span>
      <span className={s.q}>
        {p.question}
      </span>
      <span className={s.line}>
        {line}
      </span>
    </button>
  );
}

/** "2 h ago", "just now" (the list's age wording without "submitted"). */
function ageOf(s: number | null, now: number): string {
  return s === null ? "" : ageLabel(new Date(s * 1000).toISOString(), now).replace(/^submitted /, "");
}

function heading(p: Proposal) {
  if (p.status === "approved" || p.status === "opened") return "Approved and signed";
  if (p.status === "rejected") return "Rejected · edit and approve to reopen";
  if (p.status === "queued") return "Phase 2 proposal · review and edit";
  return "Review and edit before approving";
}

function Detail({
  p, all, now, admin, role, nonces, onDone, onFailed,
}: {
  p: Proposal; all: ProposalSummary[]; now: number; admin: string; role: AdminRole; nonces: Nonces; onDone: Done; onFailed: (e: unknown) => void;
}) {
  const { address, isConnecting, error: walletError } = useWallet();
  const signer = useSigner(admin);
  const deadlineErrId = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(p));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<null | "save" | "approve" | "reject">(null);
  const [error, setError] = useState<string | null>(null);
  // A connect that went through the wallet picker: drop the "connect" prompt once connected.
  useEffect(() => {
    if (address) setError((e) => (e === CONNECT_FIRST ? null : e));
  }, [address]);

  const nowS = Math.floor(now / 1000);
  const locked = p.status === "approved" || p.status === "opened";
  const live = LIVE_KINDS.includes(p.kind);
  const canEdit = !locked && role === "admin";
  /** The outcome form shows the wallet's error itself; the pane does not repeat it. */
  const outcomeForm = locked && p.kind === "event" && role === "admin";
  const { proposal: view, deadlineError } = locked ? { proposal: p, deadlineError: null } : applyDraft(p, draft);
  const dirty = canEdit && isDirty(p, draft);
  const dup = duplicateOf(view, all, LIVE_QUESTIONS);
  const checks = locked ? [] : proposalChecks(view, { nowS, duplicate: dup, liveMatch: dup === "live market" ? liveMatchOf(view) : null, own: OWN });

  let preview: string | null = null;
  if (locked && p.approval) preview = approvalText(fromJsonApproval(p.approval.message), nowS);
  else if (live) {
    try {
      preview = approvalText(approvalMessage(view, 0n), nowS, { nonceAtSigning: true });
    } catch {
      preview = null; // e.g. a price that does not parse yet: the checks say what is wrong
    }
  }

  const wrongWallet = Boolean(address && address.toLowerCase() !== admin.toLowerCase());
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function run(kind: "save" | "approve" | "reject", f: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await f();
    } catch (e) {
      if (e instanceof SignedOut) onFailed(e);
      else setError(asMessage(e));
    } finally {
      setBusy(null);
    }
  }

  /** PATCH the draft. The saved proposal (the API's reply) is what gets signed: the API
   *  compares the signed message with approvalMessage(stored proposal). */
  async function save(): Promise<Proposal> {
    if (deadlineError) throw new Refusal(deadlineError);
    const r = await call<{ proposal?: Proposal; error?: string }>(idPath(p.id), { method: "PATCH", body: patchBody(p, draft) });
    if (r.status !== 200 || !r.body.proposal) throw new Refusal(r.body.error ?? `Could not save (${r.status}).`);
    setDraft(draftOf(r.body.proposal));
    return r.body.proposal;
  }

  async function approve() {
    let saved: Proposal | null = null;
    await run("approve", async () => {
      const w = await signer(); // connected, the admin, on Arc mainnet — before anything is saved
      if (!w) return;
      try {
        saved = await save();
        const nonce = nonces.next(); // above the admin's last nonce: the API refuses a reuse
        const msg = approvalMessage(saved, nonce);
        const signature = await w.walletClient.signTypedData({ account: w.address, ...approvalTypedData(msg) });
        const r = await call<{ proposal?: Proposal; error?: string }>(`${idPath(saved.id)}/approve`, {
          method: "POST",
          body: { message: toJsonApproval(msg), signature },
        });
        if (r.status !== 200 || !r.body.proposal) throw new Refusal(r.body.error ?? `Could not approve (${r.status}).`);
        nonces.used(nonce);
        saved = null;
        onDone(r.body.proposal, `Approved ${p.id}: the agent opens it within a minute; its status page shows “Opened · market 0x…” with a link.`);
      } finally {
        // Saved but not approved (wallet refused, API error): the list shows the saved version.
        if (saved) onDone(saved);
      }
    });
  }

  async function reject() {
    await run("reject", async () => {
      if (!reason.trim()) throw new Refusal("Give a reason: it is shown on the proposal’s status page.");
      const r = await call<{ proposal?: Proposal; error?: string }>(`${idPath(p.id)}/reject`, { method: "POST", body: { reason: reason.trim() } });
      if (r.status !== 200 || !r.body.proposal) throw new Refusal(r.body.error ?? `Could not reject (${r.status}).`);
      onDone(r.body.proposal, `Rejected ${p.id}. The reason is on its status page.`);
    });
  }

  const payee = view.creatorPayee;
  const priceAsset = view.kind === "price" && view.asset ? PROPOSAL_ASSETS[view.asset] : null;

  return (
    <section className={s.detail} aria-label="Proposal detail">
      <div className={s.detailHead}>
        <h2 className={s.h2}>{heading(p)}</h2>
        <a className={s.small} href={`${APP_SITE}${statusHref(p.id)}`} target="_blank" rel="noreferrer">
          Open public status page ↗
        </a>
      </div>

      {locked && p.approval && (
        <p className={s.callout} data-tone="approved">
          <b>{p.status === "opened" ? `Opened${p.marketId ? ` · market ${p.marketId}` : ""}` : "Approved"}.</b> Signed by{" "}
          <span className={s.mono}>{p.approval.signer}</span> with nonce {p.approval.message.nonce}. An approved proposal
          cannot be edited or rejected: the agent may already have accepted it.
        </p>
      )}
      {locked && p.approval && openingOverdue(p, nowS) && (
        <p className={s.callout}>
          <b>Approved {ageOf(approvedAtS(p, nowS), now)}.</b> The agent opens a market within minutes. If the public status
          page does not show “Opened”, the opening is delayed: the agent refused or deferred it (daily cap, float, a check
          it failed) and the team has been told in the agent&#8217;s alerts, which name the reason. The status page reads
          the chain:{" "}
          <a href={`${APP_SITE}${statusHref(p.id)}`} target="_blank" rel="noreferrer">
            check it ↗
          </a>
        </p>
      )}
      {p.status === "rejected" && (
        <p className={s.callout} data-tone="rejected">
          <b>Rejected:</b> {p.reason ?? "no reason given"}. Saving an edit or approving puts it back in review.
        </p>
      )}
      {p.status === "queued" && (
        <p className={s.callout}>
          <b>{kindLabel(p.kind)}</b> (phase 2): collected now, opened when Perennial markets launch. It cannot be approved
          yet; you can edit or reject it.
        </p>
      )}
      {role !== "admin" && !locked && (
        <p className={s.callout}>Read only: onboarders can review proposals; only an admin can edit, approve or reject.</p>
      )}

      {canEdit ? (
        <>
          <label className={s.field}>
            Question (as it will appear)
            <input className={s.input} type="text" value={draft.question} maxLength={300} onChange={(e) => set("question")(e.target.value)} />
          </label>
          <label className={s.field}>
            {p.kind === "price" ? "Rule" : "Resolves Yes if…"}
            <textarea className={s.textarea} rows={2} value={draft.rule} maxLength={1000} onChange={(e) => set("rule")(e.target.value)} />
          </label>
        </>
      ) : (
        <>
          <div className={s.field}>
            Question (as it will appear)
            <div className={s.readonly}>{view.question}</div>
          </div>
          {view.rule && (
            <div className={s.field}>
              {p.kind === "price" ? "Rule" : "Resolves Yes if…"}
              <div className={`${s.readonly} ${s.readonlySm}`}>{view.rule}</div>
            </div>
          )}
        </>
      )}

      <div className={s.tiles}>
        <Tile label="Feed" value={view.kind === "price" ? `Median of Coinbase, Kraken, OKX (${priceAsset?.symbol ?? "?"})` : "Curated (team + evidence)"} />
        <Tile label="Deadline" value={shortUtc(view.deadline, nowS)} />
        <Tile label="Starting pool" value={`${Number(SEED) / 1e6} USDC`} />
        <Tile label="Creator share (30%)" value={payee ? shortAddr(payee).toLowerCase() : "Treasury"} mono={Boolean(payee)} />
      </div>

      {canEdit && (
        <details className={s.more}>
          <summary>
            Edit {p.kind === "price" ? "asset, price" : "answer source"}, deadline or creator wallet
          </summary>
          <div className={s.moreBody}>
            {p.kind === "price" ? (
              <>
                <label className={s.field}>
                  Asset
                  <select className={s.select} value={draft.asset} onChange={(e) => set("asset")(e.target.value as ProposalAsset)}>
                    {(Object.keys(PROPOSAL_ASSETS) as ProposalAsset[]).map((a) => (
                      <option key={a} value={a}>
                        {PROPOSAL_ASSETS[a].symbol}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={s.field}>
                  Resolves Yes if the price is
                  <select className={s.select} value={draft.comparator} onChange={(e) => set("comparator")(Number(e.target.value) as 1 | 3)}>
                    <option value={1}>at least</option>
                    <option value={3}>at most</option>
                  </select>
                </label>
                <label className={s.field}>
                  Price (USD)
                  <input className={s.input} inputMode="decimal" value={draft.price} onChange={(e) => set("price")(e.target.value)} />
                </label>
              </>
            ) : (
              <label className={`${s.field} ${s.wide}`}>
                Where the answer comes from
                <input className={s.input} type="url" value={draft.source} onChange={(e) => set("source")(e.target.value)} />
              </label>
            )}
            <div className={s.fieldBox}>
              <label className={s.field}>
                Deadline (UTC) <span className={s.hint}>YYYY-MM-DD HH:MM, on a 5-minute mark</span>
                <input
                  className={s.input}
                  value={draft.deadlineText}
                  aria-invalid={Boolean(deadlineError)}
                  aria-describedby={deadlineError ? deadlineErrId : undefined}
                  onChange={(e) => set("deadlineText")(e.target.value)}
                />
              </label>
              {deadlineError && (
                <p id={deadlineErrId} className={s.error}>
                  {deadlineError}
                </p>
              )}
            </div>
            <label className={`${s.field} ${s.wide}`}>
              Creator wallet <span className={s.hint}>(empty: the creator share goes to the treasury)</span>
              <input
                className={`${s.input} ${s.mono}`}
                value={draft.creatorPayee}
                spellCheck={false}
                placeholder="0x…"
                onChange={(e) => set("creatorPayee")(e.target.value)}
              />
            </label>
          </div>
        </details>
      )}

      {!locked && (
        <div className={s.checks}>
          <div className={s.boxTitle}>Checks</div>
          <ul>
            {checks.map((c) => (
              <li key={c.text} className={c.ok ? undefined : s.bad}>
                {c.ok ? "✓" : "✗"} {c.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <div className={s.sign}>
          <div className={s.boxTitle}>{locked ? "The signed approval" : "Your wallet will sign exactly this"}</div>
          <pre className={s.pre}>{preview}</pre>
          {!locked && dirty && <p className={s.signedBy}>Approving saves your edits first, then asks your wallet to sign the saved proposal.</p>}
        </div>
      )}

      {canEdit && (
        <>
          <label className={s.field}>
            Reason if rejecting <span className={s.hint}>(shown on the proposal’s status page)</span>
            <input
              className={`${s.input} ${s.inputSm}`}
              type="text"
              value={reason}
              maxLength={300}
              placeholder="e.g. no single public source can settle this"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          <div className={s.actions}>
            {live && (
              <button type="button" className={s.approve} onClick={approve} disabled={busy !== null || isConnecting || wrongWallet}>
                {busy === "approve" ? "Check your wallet…" : !address ? (isConnecting ? "Connecting…" : "Connect wallet to sign") : "Approve & sign"}
              </button>
            )}
            <button type="button" className={s.reject} onClick={reject} disabled={busy !== null}>
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
            {dirty && (
              <button type="button" className={s.quiet} onClick={() => run("save", async () => onDone(await save(), `Saved ${p.id}.`))} disabled={busy !== null || Boolean(deadlineError)}>
                {busy === "save" ? "Saving…" : "Save edits"}
              </button>
            )}
            {live && (
              <span className={s.note}>
                After signing: the agent opens it within a minute; status shows “Opened · market 0x…” with a link.
              </span>
            )}
          </div>
          {wrongWallet && (
            <p className={s.error}>
              Your wallet is {shortAddr(address!)}; switch it to the signed-in admin {shortAddr(admin)} to sign.
            </p>
          )}
        </>
      )}
      {shownError(error, outcomeForm ? undefined : walletError) && (
        <p className={s.error} role="alert">
          {shownError(error, outcomeForm ? undefined : walletError)}
        </p>
      )}

      {outcomeForm && <RecordOutcome p={p} admin={admin} nonces={nonces} onDone={onDone} onFailed={onFailed} />}
    </section>
  );
}

function Tile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={s.tile}>
      <div className={s.tileLabel}>{label}</div>
      <div className={`${s.tileValue} ${mono ? `${s.mono} ${s.tileMono}` : ""}`}>{value}</div>
    </div>
  );
}

function RecordOutcome({ p, admin, nonces, onDone, onFailed }: { p: Proposal; admin: string; nonces: Nonces; onDone: Done; onFailed: (e: unknown) => void }) {
  const { address, error: walletError } = useWallet();
  const signer = useSigner(admin);
  const ids = { evidence: useId(), since: useId(), wallet: useId() };
  const [yes, setYes] = useState<boolean | null>(null);
  const [evidence, setEvidence] = useState("");
  const [since, setSince] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A connect that went through the wallet picker: drop the "connect" prompt once connected.
  useEffect(() => {
    if (address) setError((e) => (e === CONNECT_FIRST ? null : e));
  }, [address]);
  const recorded = p.outcome ? fromJsonOutcome(p.outcome.message) : null;
  const wrongWallet = Boolean(address && address.toLowerCase() !== admin.toLowerCase());
  const nowS = Math.floor(Date.now() / 1000);
  const win = outcomeWindow(p.deadline, nowS);
  const problems = outcomeProblems({ value: yes, evidence, sinceText: since, deadline: p.deadline, nowS });
  const shown = (field: "evidence" | "since") => problems.find((x) => x.field === field && !x.blank) ?? null;
  const missing = problems.filter((x) => x.blank);
  const invalid = { evidence: shown("evidence"), since: shown("since") };

  async function sign() {
    setError(null);
    setBusy(true);
    try {
      const w = await signer();
      if (!w) return;
      const sinceS = parseUtcMinute(since);
      if (problems.length || yes === null || sinceS === null) throw new Refusal(problems[0]?.error ?? "Fill in the outcome first.");
      const msg = { proposalId: p.id, value: yes ? 1n : 0n, since: BigInt(sinceS), evidenceUrl: evidence.trim(), nonce: nonces.next() };
      const signature = await w.walletClient.signTypedData({ account: w.address, ...outcomeTypedData(msg) });
      const r = await call<{ proposal?: Proposal; error?: string }>(`${idPath(p.id)}/outcome`, {
        method: "POST",
        body: { message: toJsonOutcome(msg), signature },
      });
      if (r.status !== 200 || !r.body.proposal) throw new Refusal(r.body.error ?? `Could not record the outcome (${r.status}).`);
      nonces.used(msg.nonce);
      onDone(r.body.proposal, outcomeRecordedText(p.id, yes, p.deadline, Math.floor(Date.now() / 1000)));
    } catch (e) {
      if (e instanceof SignedOut) onFailed(e);
      else setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const describe = (id: string, on: boolean) => [on ? id : null, wrongWallet ? ids.wallet : null].filter(Boolean).join(" ") || undefined;
  const recordedLine = recorded && p.outcome && (
    <p className={s.callout}>
      Recorded: <b>{recorded.value === 1n ? "Yes" : "No"}</b> since {shortUtc(Number(recorded.since), nowS)},{" "}
      <a href={recorded.evidenceUrl} target="_blank" rel="noreferrer">
        evidence ↗
      </a>
      , signed by <span className={s.mono}>{shortAddr(p.outcome.signer)}</span>.{win.closed ? "" : " Signing again replaces it."}
    </p>
  );
  if (win.closed) {
    return (
      <div className={s.outcome}>
        <h3 className={s.h3}>Record outcome</h3>
        {recordedLine}
        <p className={s.callout} data-tone="rejected">
          <b>Too late — use the dispute process.</b> {tooLateText(p.deadline, nowS, Boolean(recorded))}
        </p>
      </div>
    );
  }
  return (
    <div className={s.outcome}>
      <h3 className={s.h3}>Record outcome</h3>
      <p className={s.signedBy}>
        Record by <b>{shortUtc(win.cutoff, nowS)}</b>
        {win.pastDeadline ? " (the deadline has passed)" : ""}: the agent attests the outcome at {shortUtc(win.attestAt, nowS)}, 30 minutes after
        the deadline, and takes only an outcome dated by the deadline that reached it before then. After that, use the dispute process.
      </p>
      {recordedLine}
      <fieldset className={s.radios}>
        <legend>What happened</legend>
        <label>
          <input type="radio" name={`outcome-${p.id}`} checked={yes === true} onChange={() => setYes(true)} /> Yes
        </label>
        <label>
          <input type="radio" name={`outcome-${p.id}`} checked={yes === false} onChange={() => setYes(false)} /> No
        </label>
      </fieldset>
      <div className={s.two}>
        <div className={s.fieldBox}>
          <label className={s.field}>
            Evidence URL
            <input
              className={`${s.input} ${s.inputSm}`}
              type="url"
              value={evidence}
              placeholder="https://…"
              aria-invalid={Boolean(invalid.evidence)}
              aria-describedby={describe(ids.evidence, Boolean(invalid.evidence))}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          {invalid.evidence && (
            <p id={ids.evidence} className={s.error}>
              {invalid.evidence.error}
            </p>
          )}
        </div>
        <div className={s.fieldBox}>
          <label className={s.field}>
            Happened at (UTC)
            <input
              className={`${s.input} ${s.inputSm}`}
              value={since}
              placeholder="2026-12-01 14:30"
              aria-invalid={Boolean(invalid.since)}
              aria-describedby={describe(ids.since, Boolean(invalid.since))}
              onChange={(e) => setSince(e.target.value)}
            />
          </label>
          {invalid.since && (
            <p id={ids.since} className={s.error}>
              {invalid.since.error}
            </p>
          )}
        </div>
      </div>
      <div className={s.actions}>
        <button
          type="button"
          className={s.quiet}
          onClick={sign}
          disabled={busy || wrongWallet || Boolean(address && problems.length)}
          aria-describedby={wrongWallet ? ids.wallet : undefined}
        >
          {busy ? "Check your wallet…" : !address ? "Connect wallet to sign" : "Sign outcome"}
        </button>
        {address && !wrongWallet && missing.length > 0 && <span className={s.note}>{missing.map((x) => x.error).join(" ")}</span>}
      </div>
      {wrongWallet && (
        <p id={ids.wallet} className={s.error}>
          Your wallet is {shortAddr(address!)}; switch it to the signed-in admin {shortAddr(admin)} to sign.
        </p>
      )}
      {shownError(error, walletError) && (
        <p className={s.error} role="alert">
          {shownError(error, walletError)}
        </p>
      )}
    </div>
  );
}

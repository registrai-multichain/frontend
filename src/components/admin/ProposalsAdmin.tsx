"use client";

import { useCallback, useEffect, useId, useState } from "react";
import useSWR from "swr";
import { useWallet } from "@/components/WalletProvider";
import { newsreader } from "@/components/proposals/fonts";
import { ADMIN_SERVICE, type AdminRole } from "@/lib/builders-admin";
import { shortAddr } from "@/lib/format";
import { humanizeError } from "@/lib/humanize-error";
import { activeProvider } from "@/lib/wallets";
import {
  LIVE_KINDS, MARKETS_V4, PROPOSAL_ASSETS, SEED, approvalMessage, approvalTypedData, duplicateOf, fromJsonApproval,
  fromJsonOutcome, normalizeQuestion, outcomeTypedData, toJsonApproval, toJsonOutcome, type Proposal, type ProposalAsset,
} from "@/lib/market-proposals";
import {
  FILTERS, ageLabel, applyDraft, approvalText, draftOf, filterCounts, filterOf, inFilter, isDirty, kindLabel,
  outcomeProblems, parseUtcMinute, patchBody, proposalChecks, shortUtc, wrongChainMessage, type Draft, type ProposalFilter,
} from "@/lib/proposals-admin";
import { statusHref } from "@/lib/propose-form";
import mainnetRounds from "@/lib/deployments/arc-mainnet-rounds.json";
import s from "./proposals-admin.module.css";

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

const byNewest = (a: Proposal, b: Proposal) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
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

  const list = useSWR<Proposal[]>(
    admin ? ["admin-market-proposals", admin] : null,
    async () => {
      const r = await call<{ proposals?: Proposal[]; error?: string }>(API);
      if (r.status !== 200 || !r.body.proposals) throw new Error(r.body.error ?? `proposals (${r.status})`);
      return r.body.proposals;
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

  const all = list.data ?? [];
  const counts = filterCounts(all);
  const shown = all.filter((p) => inFilter(p, filter)).sort(byNewest);
  const selected = shown.find((p) => p.id === selectedId) ?? shown[0] ?? null;

  /** After an action the pane follows the proposal to the filter of its new status. */
  const done: Done = useCallback(
    (p, text) => {
      list.mutate((prev) => (prev ?? []).map((o) => (o.id === p.id ? p : o)), { revalidate: false });
      setFilter(filterOf(p.status));
      setSelectedId(p.id);
      if (text) setNotice(text);
    },
    [list],
  );
  const failed = useCallback((e: unknown) => {
    if (e instanceof SignedOut) signOut();
  }, [signOut]);

  return (
    <div className={`${s.shell} ${newsreader.variable}`}>
      <nav className={s.rail} aria-label="Admin">
        <div className={s.brand}>Registrai admin</div>
        <a className={s.navLink} href="/admin/#invites">Invites</a>
        <a className={s.navLink} href="/admin/#register-requests">Register requests</a>
        <a className={s.navLink} href="/admin/#suggestions">Project suggestions</a>
        <a className={s.navActive} href="/admin/proposals/" aria-current="page">
          Market proposals {list.data && <span className={s.badge}>{counts.pending}</span>}
        </a>
        <div className={s.spacer} />
        <div className={s.who}>
          {admin ? (
            <>
              Signed in as <br />
              <span className={s.mono}>{shortAddr(admin).toLowerCase()}</span> · {role}
            </>
          ) : (
            "Not signed in"
          )}
        </div>
      </nav>

      <main className={s.main}>
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
            {selected && (
              <Detail key={selected.id} p={selected} all={all} now={now} admin={admin} role={role} onDone={done} onFailed={failed} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function liveMatchOf(p: Proposal): string | null {
  const q = normalizeQuestion(p.question);
  return LIVE_QUESTIONS.find((l) => normalizeQuestion(l) === q) ?? null;
}

function payeeText(p: Proposal) {
  return p.creatorPayee ? `creator ${shortAddr(p.creatorPayee).toLowerCase()}` : "no creator wallet → treasury";
}

function ProposalCard({ p, all, now, selected, onSelect }: { p: Proposal; all: Proposal[]; now: number; selected: boolean; onSelect: () => void }) {
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

function heading(p: Proposal) {
  if (p.status === "approved" || p.status === "opened") return "Approved and signed";
  if (p.status === "rejected") return "Rejected · edit and approve to reopen";
  if (p.status === "queued") return "Phase 2 proposal · review and edit";
  return "Review and edit before approving";
}

function Detail({
  p, all, now, admin, role, onDone, onFailed,
}: {
  p: Proposal; all: Proposal[]; now: number; admin: string; role: AdminRole; onDone: Done; onFailed: (e: unknown) => void;
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
        const nonce = BigInt(Date.now()); // strictly increasing per admin; the API refuses a reuse
        const msg = approvalMessage(saved, nonce);
        const signature = await w.walletClient.signTypedData({ account: w.address, ...approvalTypedData(msg) });
        const r = await call<{ proposal?: Proposal; error?: string }>(`${idPath(saved.id)}/approve`, {
          method: "POST",
          body: { message: toJsonApproval(msg), signature },
        });
        if (r.status !== 200 || !r.body.proposal) throw new Refusal(r.body.error ?? `Could not approve (${r.status}).`);
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
          cannot be edited or rejected: the agent may already be opening it.
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

      {outcomeForm && <RecordOutcome p={p} admin={admin} onDone={onDone} onFailed={onFailed} />}
    </section>
  );
}

function Tile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={s.tile}>
      <div className={s.tileLabel}>{label}</div>
      <div className={`${s.tileValue} ${mono ? s.mono : ""}`}>{value}</div>
    </div>
  );
}

function RecordOutcome({ p, admin, onDone, onFailed }: { p: Proposal; admin: string; onDone: Done; onFailed: (e: unknown) => void }) {
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
  const problems = outcomeProblems({ value: yes, evidence, sinceText: since, deadline: p.deadline, nowS: Math.floor(Date.now() / 1000) });
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
      const msg = { proposalId: p.id, value: yes ? 1n : 0n, since: BigInt(sinceS), evidenceUrl: evidence.trim(), nonce: BigInt(Date.now()) };
      const signature = await w.walletClient.signTypedData({ account: w.address, ...outcomeTypedData(msg) });
      const r = await call<{ proposal?: Proposal; error?: string }>(`${idPath(p.id)}/outcome`, {
        method: "POST",
        body: { message: toJsonOutcome(msg), signature },
      });
      if (r.status !== 200 || !r.body.proposal) throw new Refusal(r.body.error ?? `Could not record the outcome (${r.status}).`);
      onDone(r.body.proposal, `Outcome recorded for ${p.id}: ${yes ? "Yes" : "No"}. The agent settles it after the deadline.`);
    } catch (e) {
      if (e instanceof SignedOut) onFailed(e);
      else setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const describe = (id: string, on: boolean) => [on ? id : null, wrongWallet ? ids.wallet : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={s.outcome}>
      <h3 className={s.h3}>Record outcome</h3>
      {recorded && p.outcome && (
        <p className={s.callout}>
          Recorded: <b>{recorded.value === 1n ? "Yes" : "No"}</b> since {shortUtc(Number(recorded.since), Math.floor(Date.now() / 1000))},{" "}
          <a href={recorded.evidenceUrl} target="_blank" rel="noreferrer">
            evidence ↗
          </a>
          , signed by <span className={s.mono}>{shortAddr(p.outcome.signer)}</span>. Signing again replaces it.
        </p>
      )}
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

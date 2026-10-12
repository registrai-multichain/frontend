"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import type { Side } from "@/lib/abi-pilot";
import {
  accountPollMs,
  BOARD_POLL_MS,
  PILOT_PATHS,
  pilotLoginMessage,
  shortWallet,
  type ClosedPositionView,
  type EconomyView,
  type FundingView,
  type LeaderboardRow,
  type OrderView,
  type PilotAccountView,
  type PilotMarket,
  withMarket,
} from "@/lib/abi-pilot-api";
import { PILOT_COPY } from "@/lib/abi-pilot-copy";
import { PilotTables, type PilotTab } from "./PilotTables";
import { Ticket } from "./Ticket";
import "./pilot.css";

const FILL_POLL_MS = 1000;
/** The server refuses an order with no mark within RULES.markMaxAgeS (10 s); stop asking a little later. */
const FILL_WAIT_MS = 14_000;

type Res<T> = { status: number; body: T & { error?: string } };

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<Res<T>> {
  try {
    const r = await fetch(path, {
      method: init.method ?? "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    let body = {} as T & { error?: string };
    try { body = (await r.json()) as T & { error?: string }; } catch { /* empty body */ }
    return { status: r.status, body };
  } catch {
    return { status: 0, body: { error: "Network error. Try again." } as T & { error?: string } };
  }
}

const userError = (e: unknown) => {
  const msg = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? "";
  return /reject|denied|cancel/i.test(msg) ? "Signature cancelled in your wallet." : msg || "Something went wrong. Try again.";
};

/**
 * The points pilot on the terminal page: ticket, positions, history, leaderboard, funding, economy. `market` is the
 * index tab's (ABI, AII or AEI): the ticket trades it and the Funding and Economy tabs show it; positions, history and
 * the leaderboard cover every market. Renders nothing until mounted in the browser, and nothing at all where the pilot
 * API is not deployed (the static page stays data only). Sign-in is a personal_sign message; no transactions.
 */
export function PilotPanel({ market = "abi" }: { market?: PilotMarket }) {
  const { address, connect, isConnecting, walletClient, error: walletError } = useWallet();
  const [view, setView] = useState<PilotAccountView | null>(null);
  const [tab, setTab] = useState<PilotTab>("positions");
  const [history, setHistory] = useState<ClosedPositionView[] | null>(null);
  const [board, setBoard] = useState<LeaderboardRow[] | null>(null);
  const [funding, setFunding] = useState<FundingView | null>(null);
  const [economy, setEconomy] = useState<EconomyView | null>(null);
  const [busy, setBusy] = useState(false);
  const [filling, setFilling] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [closing, setClosing] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const live = useRef(true);

  const refresh = useCallback(async () => {
    const r = await api<PilotAccountView>(withMarket(PILOT_PATHS.account, market));
    if (!live.current) return;
    // a reply for a tab the page has since left is dropped (the next refresh is for the new market)
    if (r.status === 200 && (r.body.market ?? "abi") === market) setView(r.body);
  }, [market]);
  const loadHistory = useCallback(async () => {
    const r = await api<{ history: ClosedPositionView[] }>(PILOT_PATHS.history);
    if (live.current && r.status === 200) setHistory(r.body.history);
  }, []);
  const loadBoard = useCallback(async () => {
    const r = await api<{ rows: LeaderboardRow[] }>(PILOT_PATHS.leaderboard);
    if (live.current && r.status === 200) setBoard(r.body.rows);
  }, []);
  const loadFunding = useCallback(async () => {
    const r = await api<FundingView>(withMarket(PILOT_PATHS.funding, market));
    if (live.current && r.status === 200 && (r.body.market ?? "abi") === market) setFunding(r.body);
  }, [market]);
  const loadEconomy = useCallback(async () => {
    const r = await api<EconomyView>(withMarket(PILOT_PATHS.economy, market));
    if (live.current && r.status === 200 && (r.body.market ?? "abi") === market) setEconomy(r.body);
  }, [market]);
  // another index tab: its funding and economy load afresh (the account view refreshes through `refresh`)
  useEffect(() => { setFunding(null); setEconomy(null); }, [market]);

  useEffect(() => {
    live.current = true;
    void refresh();
    return () => { live.current = false; };
  }, [refresh]);

  // signed in: refresh every 15 s while the page is visible (2 s while an order is pending); a hidden tab polls
  // nothing and refreshes once when it is shown again
  const signedIn = Boolean(view?.address);
  const pollMs = accountPollMs(view);
  useEffect(() => {
    if (pollMs === null) return;
    const t = setTimeout(() => { if (document.visibilityState === "visible") void refresh(); }, pollMs);
    return () => clearTimeout(t);
  }, [view, pollMs, refresh]);
  useEffect(() => {
    if (!signedIn) return;
    const shown = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", shown);
    return () => document.removeEventListener("visibilitychange", shown);
  }, [signedIn, refresh]);

  useEffect(() => {
    if (tab === "history" && signedIn) void loadHistory();
    if (tab === "funding") void loadFunding();
    const poll = tab === "leaderboard" ? loadBoard : tab === "economy" ? loadEconomy : null;
    if (!poll) return;
    void poll();
    const t = setInterval(() => { if (document.visibilityState === "visible") void poll(); }, BOARD_POLL_MS);
    return () => clearInterval(t);
  }, [tab, signedIn, loadHistory, loadBoard, loadFunding, loadEconomy]);

  async function signIn() {
    setError(undefined);
    if (!address || !walletClient) { await connect(); return; }
    setSigningIn(true);
    try {
      const n = await api<{ nonce?: string }>(PILOT_PATHS.auth);
      if (!n.body.nonce) throw new Error(n.body.error ?? "Sign-in is not available right now.");
      const message = pilotLoginMessage({ address: address.toLowerCase(), origin: window.location.origin, nonce: n.body.nonce, issued: new Date().toISOString() });
      const signature = await walletClient.signMessage({ account: address, message });
      const r = await api<{ address?: string }>(PILOT_PATHS.auth, { method: "POST", body: { message, signature } });
      if (r.status !== 200) throw new Error(r.body.error ?? `Sign-in failed (${r.status}).`);
      await refresh();
    } catch (e) {
      setError(userError(e));
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    await api(PILOT_PATHS.auth, { method: "DELETE", body: {} });
    setHistory(null);
    setError(undefined);
    await refresh();
  }

  /** Orders fill at the next mark: wait for the queued order to fill or be refused. */
  async function settle(r: Res<{ order?: OrderView }>): Promise<string | undefined> {
    if (r.status !== 202 || !r.body.order) return r.body.error ?? `Refused (${r.status}).`;
    const id = r.body.order.id;
    const until = Date.now() + FILL_WAIT_MS;
    while (live.current && Date.now() < until) {
      await new Promise((ok) => setTimeout(ok, FILL_POLL_MS));
      const s = await api<{ order?: OrderView }>(`${PILOT_PATHS.order}?id=${id}`);
      const st = s.body.order?.status;
      if (st === "filled") return undefined;
      if (st === "refused") return s.body.order?.error ?? "Refused.";
    }
    return "No fill yet. Check your positions in a moment.";
  }

  async function order(o: { side: Side; margin: number; lev: number }) {
    setBusy(true);
    setFilling(true);
    setError(undefined);
    const err = await settle(await api<{ order?: OrderView }>(PILOT_PATHS.order, { method: "POST", body: { market: view?.market ?? market, ...o } }));
    if (!live.current) return;
    setFilling(false);
    if (err) setError(err);
    else setTab("positions");
    await refresh();
    setBusy(false);
  }

  async function close(id: number) {
    setClosing(id);
    setError(undefined);
    const err = await settle(await api<{ order?: OrderView }>(PILOT_PATHS.close, { method: "POST", body: { id } }));
    if (!live.current) return;
    if (err && err !== "already closed") setError(err);
    await refresh();
    if (tab === "history") await loadHistory();
    else setHistory(null);
    setClosing(null);
  }

  if (!view) return null; // not mounted yet, or the pilot API is not deployed here
  const signInLabel = isConnecting ? PILOT_COPY.signingIn : address ? `${PILOT_COPY.signIn} as ${shortWallet(address)}` : PILOT_COPY.signIn;
  return (
    <div className="abi-row abi-pt-row-wrap">
      <PilotTables
        tab={tab}
        onTab={setTab}
        market={market}
        address={view.address}
        positions={view.positions}
        history={history}
        board={board}
        funding={funding}
        economy={economy}
        closing={closing}
        onClose={(id) => void close(id)}
      />
      <Ticket
        view={view}
        busy={busy}
        filling={filling}
        error={error ?? walletError}
        signInLabel={signInLabel}
        signingIn={signingIn || isConnecting}
        onSignIn={() => void signIn()}
        onSignOut={() => void signOut()}
        onOrder={(o) => void order(o)}
      />
    </div>
  );
}

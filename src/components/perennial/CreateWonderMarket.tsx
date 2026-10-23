"use client";

/**
 * Open a market about a nominated project that has not joined yet (spec
 * 2026-09-25-wonder-markets-design.md, "Site"): on the project's bound
 * milestone feed, so the team's share of the fees is held for it. Moved from
 * the old wonder view into a paper dialog.
 */
import { useState } from "react";
import type { Address, Hex, PublicClient } from "viem";
import { Dialog } from "@/components/paper/Dialog";
import { useWallet } from "@/components/WalletProvider";
import { nanoLedgerAbi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";
import live from "@/lib/live-data.json";
import { readLatestValue, rememberMarket } from "@/lib/perennial-chain";
import { COMPARATOR, formatUsdc, parseDays, parseUsdcInput } from "@/lib/perennial-market";
import { marketQuestion, metricNoun } from "@/lib/plain-words";
import { pushToast } from "@/lib/toast-store";
import { PERENNIAL_WRITES_ENABLED } from "@/lib/perennial";
import { normalizeSource, sourceLabel } from "@/lib/verified-builders";
import { nextHourExpiry, sourceKey, wonderContracts, wonderCreateCheck, wonderFeedFor, wonderMarketsAbi } from "@/lib/wonder";
import { findFeedLive } from "@/lib/wonder-chain";
import type { PerennialData } from "./usePerennialData";
import { D, HUMAN, perennialClient, refreshPerennial } from "./usePerennialTx";

const W = wonderContracts(D);
/** The sync's snapshot of the operator's feeds (description -> feed id) and where it stopped. */
const SNAP = (live as { builderFeeds?: { feeds?: Record<string, string>; registry?: string; operator?: string; lastScannedBlock?: string; chainId?: number } }).builderFeeds;
const FEEDS = SNAP?.chainId === D.chain.id ? SNAP.feeds : undefined;

/** The source's milestone feed: the snapshot's, else one the operator created since (live scan). */
async function milestoneFeed(c: PublicClient, source: string): Promise<Hex | null> {
  const known = wonderFeedFor(FEEDS, source);
  if (known) return known;
  if (!SNAP?.registry || !SNAP.operator || SNAP.chainId !== D.chain.id) return null;
  const head = await c.getBlockNumber();
  return findFeedLive(c as never, SNAP.registry as Address, SNAP.operator as Address, BigInt(SNAP.lastScannedBlock ?? "0") + 1n, head, source);
}

export function CreateWonderMarket({ data, onClose }: { data: PerennialData; onClose: () => void }) {
  const { address, walletClient, walletChainId, switchChain } = useWallet();
  const [raw, setRaw] = useState("");
  const [days, setDays] = useState("30");
  const [liq, setLiq] = useState("20");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const minLiquidity = data.ov?.minLiquidity;
  const attestation = data.ov?.attestation;

  async function create() {
    setError(undefined);
    if (!PERENNIAL_WRITES_ENABLED) return setError("Perennial transactions are paused.");
    if (!W) return setError(`Markets about unclaimed projects are not deployed on ${D.label} yet.`);
    const source = normalizeSource(raw);
    if (!source) return setError("Enter a GitHub repo or domain.");
    if (!D.operator || !attestation || minLiquidity === undefined) return setError("Still reading the markets; try again in a moment.");
    const d = parseDays(days);
    if (!d.ok) return setError(d.error);
    const l = parseUsdcInput(liq, { min: minLiquidity, label: "liquidity" });
    if (!l.ok) return setError(l.error);
    if (!address || !walletClient) return setError("Connect a wallet.");
    setBusy(true);
    try {
      const c = perennialClient();
      const me = address as Address;
      const feed = source.startsWith("domain:") ? null : await milestoneFeed(c, source);
      const [nominated, feedSubject, latest] = await Promise.all([
        c.readContract({ address: W.markets, abi: wonderMarketsAbi, functionName: "nominated", args: [sourceKey(source)] }),
        feed ? c.readContract({ address: W.markets, abi: wonderMarketsAbi, functionName: "feedSubjectOf", args: [feed] }) : Promise.resolve(null),
        feed ? readLatestValue(c, attestation, feed, D.operator) : Promise.resolve(null),
      ]);
      const why = wonderCreateCheck({
        source, feed, feedSubject: feedSubject as { kind: number; sourceKey: Hex } | null, nominated: nominated === true, hasReading: latest !== null,
      });
      if (why) return setError(why);
      const ledger = D.contracts.NanoLedger!;
      const bal = (await c.readContract({ address: ledger, abi: nanoLedgerAbi, functionName: "balanceOf", args: [me] })) as bigint;
      if (bal < l.value) return setError(`Add at least ${formatUsdc(l.value)} USDC to your trading balance first.`);
      if (walletChainId !== D.chain.id) await switchChain(D.chain.id);
      const allowance = (await c.readContract({ address: ledger, abi: nanoLedgerAbi, functionName: "allowance", args: [me, W.markets] })) as bigint;
      if (allowance < l.value) {
        const h = await walletClient.writeContract({ address: ledger, abi: nanoLedgerAbi, functionName: "approveSpender", args: [W.markets, l.value], account: me, chain: D.chain.viemChain });
        if ((await c.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("the approval reverted");
      }
      const threshold = latest!.value + 1n;
      const now = Number((await c.getBlock({ blockTag: "latest" })).timestamp);
      const expiry = nextHourExpiry(now, d.value);
      const args = [source, feed!, D.operator, threshold, COMPARATOR.GreaterOrEqual, expiry, l.value] as const;
      await c.simulateContract({ address: W.markets, abi: wonderMarketsAbi, functionName: "createWonderMarket", args, account: me });
      const hash = await walletClient.writeContract({ address: W.markets, abi: wonderMarketsAbi, functionName: "createWonderMarket", args, account: me, chain: D.chain.viemChain });
      const rc = await c.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("the transaction reverted");
      const id = rc.logs.find((lg) => lg.address.toLowerCase() === W.markets.toLowerCase())?.topics[1];
      if (id) rememberMarket(D, id as Hex);
      pushToast({
        kind: "ok",
        text: `Opened: ${marketQuestion({ subject: sourceLabel(source), metric: metricNoun(source), threshold, comparator: COMPARATOR.GreaterOrEqual, expiry })}`,
      });
      await refreshPerennial();
      onClose();
    } catch (e) {
      setError(humanizeError(e, HUMAN));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Open a market about an unclaimed project" onClose={onClose}>
      <div className="pa-stack">
        <label className="block">
          <span className="pa-label">Nominated project</span>
          <input className="pa-input pu-input" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="github:owner/repo" spellCheck={false} autoCapitalize="off" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="pa-label">Runs for (days)</span>
            <input className="pa-input pu-input" value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" />
          </label>
          <label className="block">
            <span className="pa-label">Your liquidity (USDC)</span>
            <input className="pa-input pu-input" value={liq} onChange={(e) => setLiq(e.target.value)} inputMode="decimal" />
          </label>
        </div>
        <p className="pa-small pa-muted">
          The question is always one more of the project&apos;s milestones by the closing time, on its own milestone feed, so the
          team&apos;s share of the fees is held for it. Markets close on the hour.
        </p>
        {error && <p className="text-down pa-small">{error}</p>}
        <button type="button" className="pa-btn pa-btn--block pu-btn pu-btn--primary" onClick={create} disabled={busy || !raw.trim()}>
          {busy ? "Opening…" : "Open market"}
        </button>
      </div>
    </Dialog>
  );
}

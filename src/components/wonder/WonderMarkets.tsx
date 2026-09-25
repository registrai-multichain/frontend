"use client";

/**
 * Perennial → Wonder markets (spec 2026-09-25-wonder-markets-design.md, "Site"):
 * every market about a nominated project that has not joined yet, grouped by
 * project, with what is held for the team, and a form to open one on the
 * project's bound milestone feed. Markets trade in the main view (?market=<id>).
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { createPublicClient, type Address, type Hex, type PublicClient } from "viem";
import { useWallet } from "@/components/WalletProvider";
import { MarketLabels } from "@/components/wonder/WonderBits";
import { nanoLedgerAbi } from "@/lib/abi";
import { transportFor } from "@/lib/chains";
import { humanizeError } from "@/lib/humanize-error";
import live from "@/lib/live-data.json";
import { readLatestValue, readOverview, rememberMarket, type ChainMarket } from "@/lib/perennial-chain";
import { COMPARATOR, formatUsdc, parseDays, parseUsdcInput, questionText } from "@/lib/perennial-market";
import { PERENNIAL } from "@/lib/perennial-network";
import { normalizeSource, sourceLabel } from "@/lib/verified-builders";
import {
  groupWonderMarkets, nextHourExpiry, sourceKey, SUBJECT, waitingLine, wonderContracts, wonderCreateCheck,
  wonderFeedFor, wonderMarketsAbi,
} from "@/lib/wonder";
import { findFeedLive, readWonderStatus, type WonderReader } from "@/lib/wonder-chain";

const D = PERENNIAL;
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
const HUMAN = { testnet: D.chain.testnet, networkName: D.label };

let client: PublicClient | undefined;
function pc(): PublicClient {
  client ??= createPublicClient({ chain: D.chain.viemChain, transport: transportFor(D.chain, { batch: true }) }) as PublicClient;
  return client;
}

export function WonderMarkets() {
  return (
    <div className="wonder-view">
      {W ? <WonderLive /> : <p className="vf-hint">Wonder markets are not deployed on {D.label} yet.</p>}
    </div>
  );
}

type WonderRow = ChainMarket & { source: string };

function WonderLive() {
  const ov = useSWR(["wonder-overview", D.chain.id], () => readOverview(pc(), D), { revalidateOnFocus: false });
  const rows = useMemo<WonderRow[]>(
    () =>
      (ov.data?.markets ?? [])
        .filter((m) => m.subject?.kind === SUBJECT.Wonder && m.subject.source)
        .map((m) => ({ ...m, source: m.subject!.source! })),
    [ov.data],
  );
  const groups = groupWonderMarkets(rows);
  const status = useSWR(groups.length ? ["wonder-status", groups.map((g) => g.source).join("|")] : null, () =>
    readWonderStatus(pc() as unknown as WonderReader, W!, groups.map((g) => g.source)), { revalidateOnFocus: false });

  return (
    <>
      <CreateWonderMarket minLiquidity={ov.data?.minLiquidity} attestation={ov.data?.attestation} onCreated={() => void ov.mutate()} />
      {ov.error && <p className="vf-error">Could not read markets: {humanizeError(ov.error, HUMAN)}</p>}
      {!ov.data && !ov.error && <p className="vf-hint">Reading markets…</p>}
      {ov.data && groups.length === 0 && <p className="vf-hint">No wonder market yet.</p>}
      {groups.map((g) => {
        const waiting = waitingLine(status.data?.[g.source]?.escrow);
        return (
          <section key={g.source} className="wonder-group pp-card">
            <h2>{sourceLabel(g.source)}</h2>
            {waiting && <p className="wonder-waiting">{waiting}</p>}
            <ul>
              {g.markets.map((m) => (
                <li key={m.id} className="pp-market-row">
                  <Link href={`/perennial/?market=${m.id}`}>
                    {questionText({ subject: sourceLabel(g.source), feedId: m.feedId, threshold: m.threshold, comparator: m.comparator, expiry: m.expiry })}
                  </Link>
                  <MarketLabels subject={m.subject} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function CreateWonderMarket({
  minLiquidity,
  attestation,
  onCreated,
}: {
  minLiquidity?: bigint;
  attestation?: Address;
  onCreated: () => void;
}) {
  const { address, walletClient, walletChainId, switchChain } = useWallet();
  const [raw, setRaw] = useState("");
  const [days, setDays] = useState("30");
  const [liq, setLiq] = useState("20");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  async function create() {
    setMsg({});
    const source = normalizeSource(raw);
    if (!source) return setMsg({ error: "Enter a GitHub repo or domain." });
    if (!D.operator || !attestation || minLiquidity === undefined) return setMsg({ error: "Still reading the markets; try again in a moment." });
    const d = parseDays(days);
    if (!d.ok) return setMsg({ error: d.error });
    const l = parseUsdcInput(liq, { min: minLiquidity, label: "liquidity" });
    if (!l.ok) return setMsg({ error: l.error });
    if (!address || !walletClient) return setMsg({ error: "Connect a wallet." });
    setBusy(true);
    try {
      const c = pc();
      const me = address as Address;
      const feed = source.startsWith("domain:") ? null : await milestoneFeed(c, source);
      const [nominated, feedSubject, latest] = await Promise.all([
        c.readContract({ address: W!.markets, abi: wonderMarketsAbi, functionName: "nominated", args: [sourceKey(source)] }),
        feed ? c.readContract({ address: W!.markets, abi: wonderMarketsAbi, functionName: "feedSubjectOf", args: [feed] }) : Promise.resolve(null),
        feed ? readLatestValue(c, attestation, feed, D.operator) : Promise.resolve(null),
      ]);
      const why = wonderCreateCheck({
        source, feed, feedSubject: feedSubject as { kind: number; sourceKey: Hex } | null, nominated: nominated === true, hasReading: latest !== null,
      });
      if (why) return setMsg({ error: why });
      const ledger = D.contracts.NanoLedger!;
      const bal = (await c.readContract({ address: ledger, abi: nanoLedgerAbi, functionName: "balanceOf", args: [me] })) as bigint;
      if (bal < l.value) return setMsg({ error: `Deposit at least ${formatUsdc(l.value)} USDC to your balance first (in the main markets view).` });
      if (walletChainId !== D.chain.id) await switchChain(D.chain.id);
      const allowance = (await c.readContract({ address: ledger, abi: nanoLedgerAbi, functionName: "allowance", args: [me, W!.markets] })) as bigint;
      if (allowance < l.value) {
        const h = await walletClient.writeContract({ address: ledger, abi: nanoLedgerAbi, functionName: "approveSpender", args: [W!.markets, l.value], account: me, chain: D.chain.viemChain });
        if ((await c.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("the approval reverted");
      }
      const threshold = latest!.value + 1n;
      const now = Number((await c.getBlock({ blockTag: "latest" })).timestamp);
      const expiry = nextHourExpiry(now, d.value);
      const args = [source, feed!, D.operator, threshold, COMPARATOR.GreaterOrEqual, expiry, l.value] as const;
      await c.simulateContract({ address: W!.markets, abi: wonderMarketsAbi, functionName: "createWonderMarket", args, account: me });
      const hash = await walletClient.writeContract({ address: W!.markets, abi: wonderMarketsAbi, functionName: "createWonderMarket", args, account: me, chain: D.chain.viemChain });
      const rc = await c.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("the transaction reverted");
      const id = rc.logs.find((lg) => lg.address.toLowerCase() === W!.markets.toLowerCase())?.topics[1];
      if (id) rememberMarket(D, id as Hex);
      setMsg({ ok: `Opened: ${questionText({ subject: sourceLabel(source), metric: "verified artifacts", feedId: feed!, threshold, comparator: COMPARATOR.GreaterOrEqual, expiry })}` });
      onCreated();
    } catch (e) {
      setMsg({ error: humanizeError(e, HUMAN) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pp-card">
      <div className="pp-card-label">Open a wonder market</div>
      <div className="adm-inline">
        <label className="vf-field">
          <span>Nominated project</span>
          <input value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="github:owner/repo" spellCheck={false} autoCapitalize="off" />
          <em />
        </label>
        <label className="vf-field">
          <span>Days</span>
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" />
          <em />
        </label>
        <label className="vf-field">
          <span>Liquidity (USDC)</span>
          <input value={liq} onChange={(e) => setLiq(e.target.value)} inputMode="decimal" />
          <em />
        </label>
        <button type="button" className="vf-primary" onClick={create} disabled={busy || !raw.trim()}>
          {busy ? "Opening…" : "Open market"}
        </button>
      </div>
      <p className="vf-note">
        The question is always &ldquo;one more verified artifact by the expiry&rdquo; on the project&apos;s milestone feed,
        so the team&apos;s share of the fees is held for it. Expiries fall on the hour.
      </p>
      {msg.ok && <p className="vf-ok">{msg.ok}</p>}
      {msg.error && <p className="vf-error">{msg.error}</p>}
    </div>
  );
}

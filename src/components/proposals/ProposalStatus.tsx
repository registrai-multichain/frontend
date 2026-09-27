"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createPublicClient, getAbiItem, parseAbiItem, type Hex } from "viem";
import { marketsV4Abi, nanoLedgerAbi } from "@/lib/abi";
import { getWalletChain, transportFor, type WalletChain } from "@/lib/chains";
import { shortAddr } from "@/lib/format";
import type { Proposal, ProposalKind } from "@/lib/market-proposals";
import { formatUsdc } from "@/lib/perennial-market";
import {
  PRICE_SOURCE, feesScanEnd, forwardPayee, humanUtc, mergeFeeProgress, mergeScanProgress, parseScanCache, proposalFeedKey, proposalScanStart,
  scanForward, statusChip, sumCreatorFees, type ScanCache,
} from "@/lib/propose-form";
import { PROPOSALS_API } from "@/lib/proposals-api";
import {
  BLOCK_SECS, ROUNDS, mergeFeedLogs, parseMarketLogs, proposedMarketHref, scanLogs, seedFeedBook, sumTransfers, type FeedCreatedLog, type MarketCreatedLog,
} from "@/lib/rounds";
import { newsreader } from "./fonts";
import { HowItWorks } from "./HowItWorks";
import s from "./proposals.module.css";

const ID_RE = /^p[a-z2-7]{10}$/;
const KIND_LABEL: Record<ProposalKind, string> = {
  event: "Yes / no event",
  price: "Price at a deadline",
  builder: "Builder market",
  wonder: "Wonder market",
};

const FEED_CREATED = parseAbiItem(
  "event FeedCreated(bytes32 indexed feedId, address indexed creator, string description, bytes32 methodologyHash, uint256 minBond, uint256 disputeWindow, address resolver)",
);
const MARKET_CREATED = getAbiItem({ abi: marketsV4Abi, name: "MarketCreated" });
const FEES_PAID = getAbiItem({ abi: marketsV4Abi, name: "FeesPaid" });
const INTERNAL_TRANSFER = getAbiItem({ abi: nanoLedgerAbi, name: "InternalTransfer" });

type Loaded =
  | { id: string; kind: "ok"; proposal: Proposal }
  | { id: string; kind: "missing" }
  | { id: string; kind: "error"; message: string };

type OnChain =
  | { kind: "opened"; marketId: Hex; creatorFees: bigint | null; forwarded: bigint | null }
  | { kind: "not-yet"; complete: boolean }
  | { kind: "error" };

const CACHE_KEY = (id: string) => `registrai:proposal-scan:v1:${ROUNDS.chainId}:${ROUNDS.agent.toLowerCase()}:${id}`;
/** sessionStorage may be unavailable (private mode, blocked storage): then every load scans afresh. */
function loadCache(id: string): ScanCache | null {
  try {
    return parseScanCache(window.sessionStorage.getItem(CACHE_KEY(id)));
  } catch {
    return null;
  }
}
function saveCache(id: string, c: ScanCache) {
  try {
    window.sessionStorage.setItem(CACHE_KEY(id), JSON.stringify(c));
  } catch {
    // no storage: nothing to resume from next time
  }
}

/**
 * The API never learns that a market was opened: read it from chain. The rounds
 * agent provisions the feed "registrai-data:p-<id>" (FeedCreated on the Registry,
 * creator = the agent), then opens the market on it (MarketCreated on MarketsV4);
 * the creator share is the sum of that market's FeesPaid.creatorFee, paid only
 * while it trades, so that scan ends shortly after its expiry (R13). What the agent
 * has forwarded is the sum of NanoLedger InternalTransfer(agent -> payee) after the
 * market's block (R37; the transfer names no market, so another payout to the same
 * payee after it opened counts too). Progress is cached per proposal, so a reload
 * only reads the blocks added since.
 */
async function readOnChain(p: Proposal): Promise<OnChain> {
  const chain = getWalletChain(ROUNDS.chainId) as WalletChain;
  const client = createPublicClient({ chain: chain.viemChain, transport: transportFor(chain) });
  const C = ROUNDS.contracts;
  const agent = ROUNDS.agent;
  const block = await client.getBlock({ blockTag: "latest" });
  const head = block.number;
  const headTs = Number(block.timestamp);
  const key = proposalFeedKey(p.id);
  const createdS = Math.floor(Date.parse(p.createdAt) / 1000) || 0;
  const cache: ScanCache = loadCache(p.id) ?? { feed: { scannedTo: (proposalScanStart(head, headTs, createdS, ROUNDS.deployBlock) - 1n).toString() } };

  // 1. The agent's feed for this proposal.
  if (!cache.feed.feedId) {
    const prev = BigInt(cache.feed.scannedTo);
    const from = prev + 1n;
    if (from <= head) {
      const scan = await scanForward(
        (a, b) => client.getLogs({ address: C.Registry, event: FEED_CREATED, args: { creator: agent }, fromBlock: a, toBlock: b }),
        from,
        head,
        (logs) => Boolean(mergeFeedLogs(seedFeedBook({}), logs as unknown as FeedCreatedLog[], agent).byKey[key]),
      );
      const feed = mergeFeedLogs(seedFeedBook({}), scan.logs as unknown as FeedCreatedLog[], agent).byKey[key];
      cache.feed.scannedTo = (mergeScanProgress(prev, from, scan.scannedTo) ?? prev).toString();
      if (feed) {
        cache.feed.feedId = feed.feedId;
        cache.market = { scannedTo: (feed.blockNumber - 1n).toString() };
      }
      saveCache(p.id, cache);
      if (!feed) return { kind: "not-yet", complete: scan.complete };
    }
    if (!cache.feed.feedId) return { kind: "not-yet", complete: true };
  }
  const feedId = cache.feed.feedId as Hex;

  // 2. The market on it.
  // (a cache always records the market scan with the feed; rebuild it from the proposal's start if not)
  const m = (cache.market ??= { scannedTo: (proposalScanStart(head, headTs, createdS, ROUNDS.deployBlock) - 1n).toString() });
  if (!m.marketId) {
    const prev = BigInt(m.scannedTo);
    const from = prev + 1n;
    if (from > head) return { kind: "not-yet", complete: true };
    const book = seedFeedBook({ [key]: { feedId, disputeWindow: 0 } });
    const scan = await scanForward(
      (a, b) => client.getLogs({ address: C.MarketsV4, event: MARKET_CREATED, args: { feedId: [feedId] }, fromBlock: a, toBlock: b }),
      from,
      head,
      (logs) => parseMarketLogs(logs as unknown as MarketCreatedLog[], book, agent).length > 0,
    );
    const market = parseMarketLogs(scan.logs as unknown as MarketCreatedLog[], book, agent)[0];
    m.scannedTo = (mergeScanProgress(prev, from, scan.scannedTo) ?? prev).toString();
    if (market) {
      m.marketId = market.marketId;
      m.blockNumber = market.blockNumber.toString();
      m.expiry = market.expiry;
      m.createdTs = await client.getBlock({ blockNumber: market.blockNumber }).then((b) => Number(b.timestamp), () => undefined);
    }
    saveCache(p.id, cache);
    if (!market) return { kind: "not-yet", complete: scan.complete };
  }
  const marketId = m.marketId as Hex;

  // 3. Its creator fees, up to shortly after expiry.
  const mBlock = BigInt(m.blockNumber ?? "0");
  const createdTs = m.createdTs ?? headTs - Number(head - mBlock) * BLOCK_SECS;
  const end = feesScanEnd(head, mBlock, createdTs, m.expiry ?? headTs);
  const from = cache.fees ? BigInt(cache.fees.scannedTo) + 1n : mBlock;
  if (from <= end) {
    const scan = await scanLogs(
      (a, b) => client.getLogs({ address: C.MarketsV4, event: FEES_PAID, args: { marketId }, fromBlock: a, toBlock: b }),
      from,
      end,
    );
    cache.fees = mergeFeeProgress(cache.fees, from, scan.scannedTo, sumCreatorFees(scan.logs));
    saveCache(p.id, cache);
  }
  const done = cache.fees && BigInt(cache.fees.scannedTo) >= end;

  // 4. What the agent forwarded to the payee since the market opened, up to the head
  //    (it forwards daily while the market trades and once more after it settles).
  const payee = forwardPayee(p);
  if (cache.fwd && cache.fwd.payee !== payee) delete cache.fwd;
  const fFrom = cache.fwd ? BigInt(cache.fwd.scannedTo) + 1n : mBlock + 1n;
  if (fFrom <= head) {
    const scan = await scanLogs(
      (a, b) =>
        client.getLogs({ address: C.NanoLedger, event: INTERNAL_TRANSFER, args: { from: agent, to: payee as Hex }, fromBlock: a, toBlock: b }),
      fFrom,
      head,
    );
    const merged = mergeFeeProgress(cache.fwd, fFrom, scan.scannedTo, sumTransfers(scan.logs));
    if (merged) cache.fwd = { ...merged, payee };
    saveCache(p.id, cache);
  }
  const fwdDone = cache.fwd && BigInt(cache.fwd.scannedTo) >= head;
  return {
    kind: "opened",
    marketId,
    creatorFees: done ? BigInt(cache.fees!.sum) : null,
    forwarded: fwdDone ? BigInt(cache.fwd!.sum) : null,
  };
}

export function ProposalStatus() {
  const id = (useSearchParams().get("id") ?? "").trim();
  const valid = ID_RE.test(id);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [onChain, setOnChain] = useState<{ id: string; result: OnChain } | null>(null);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    fetch(`${PROPOSALS_API}/${encodeURIComponent(id)}`)
      .then(async (res) => {
        const j = (await res.json().catch(() => ({}))) as { proposal?: Proposal; error?: string };
        if (!alive) return;
        if (res.status === 404) setLoaded({ id, kind: "missing" });
        else if (res.ok && j.proposal) setLoaded({ id, kind: "ok", proposal: j.proposal });
        else setLoaded({ id, kind: "error", message: j.error ?? `the service answered ${res.status}` });
      })
      .catch(() => alive && setLoaded({ id, kind: "error", message: "the proposals service could not be reached" }));
    return () => {
      alive = false;
    };
  }, [id, valid]);

  const current = loaded?.id === id ? loaded : null;
  const proposal = current?.kind === "ok" ? current.proposal : null;
  const needsChain = Boolean(proposal && (proposal.status === "approved" || proposal.status === "opened") && ROUNDS.deployed);

  useEffect(() => {
    if (!proposal || !needsChain) return;
    let alive = true;
    readOnChain(proposal)
      .then((result) => alive && setOnChain({ id: proposal.id, result }))
      .catch(() => alive && setOnChain({ id: proposal.id, result: { kind: "error" } }));
    return () => {
      alive = false;
    };
  }, [proposal, needsChain]);

  const chain = proposal && onChain?.id === proposal.id ? onChain.result : null;

  let body: React.ReactNode;
  if (!id || !valid) {
    body = (
      <Notice title={id ? "No proposal with this id." : "This link has no proposal id."}>
        Check the link you were given, or <Link href="/propose/">propose a market</Link>.
      </Notice>
    );
  } else if (!current) {
    body = <Notice title="Loading the proposal…" busy />;
  } else if (current.kind === "missing") {
    body = (
      <Notice title="No proposal with this id.">
        Check the link you were given, or <Link href="/propose/">propose a market</Link>.
      </Notice>
    );
  } else if (current.kind === "error") {
    body = <Notice title="Could not load the proposal.">Reason: {current.message}. Try again in a minute.</Notice>;
  } else {
    body = <ProposalCard p={current.proposal} chain={chain} checking={needsChain && !chain} />;
  }

  return (
    <div className={`${s.root} ${newsreader.variable}`}>
      <div className={s.layout}>
        <div className={s.main}>
          <div>
            <h1 className={s.h1}>Proposal status</h1>
            <p className={s.lede}>
              Every proposal is reviewed by the team. This page shows its final wording and, once it opens, its market and the creator share it has earned.
            </p>
          </div>
          {body}
        </div>
        <HowItWorks />
      </div>
    </div>
  );
}

function Notice({ title, busy, children }: { title: string; busy?: boolean; children?: React.ReactNode }) {
  return (
    <section className={`${s.panel} ${s.done}`} aria-busy={busy || undefined} aria-live="polite">
      <h2 className={s.h2}>{title}</h2>
      {children && <p className={s.doneText}>{children}</p>}
    </section>
  );
}

function ProposalCard({ p, chain, checking }: { p: Proposal; chain: OnChain | null; checking: boolean }) {
  const opened = chain?.kind === "opened" ? chain : null;
  const chip = statusChip(p.status, Boolean(opened));
  const isPrice = p.kind === "price";
  const payee = p.creatorPayee;

  return (
    <section className={`${s.panel} ${s.done}`} aria-labelledby="pp-question">
      <div className={s.statusHead}>
        <span className={s.chip} data-tone={chip.tone}>{chip.label}</span>
        <span className={s.kindLabel}>{KIND_LABEL[p.kind] ?? p.kind}</span>
        <span className={s.idLabel}>{p.id}</span>
      </div>
      <h2 id="pp-question" className={s.question}>{p.question}</h2>
      {isPrice ? (
        <div className={s.ruleBlock}>
          <span className={s.ruleLabel}>Settles on</span>
          <p className={s.ruleText}>{PRICE_SOURCE}.</p>
        </div>
      ) : (
        p.rule && (
          <div className={s.ruleBlock}>
            <span className={s.ruleLabel}>Resolves Yes if</span>
            <p className={s.ruleText}>{p.rule}</p>
          </div>
        )
      )}
      <dl className={s.facts}>
        <div className={s.fact}>
          <dt>Deadline</dt>
          <dd>{humanUtc(p.deadline)}</dd>
        </div>
        {!isPrice && p.source && (
          <div className={s.fact}>
            <dt>Where the answer comes from</dt>
            <dd>
              {/^https:\/\//.test(p.source) ? (
                <a href={p.source} target="_blank" rel="noreferrer noopener">{p.source.replace(/^https:\/\//, "")} ↗</a>
              ) : (
                p.source
              )}
            </dd>
          </div>
        )}
        <div className={s.fact}>
          <dt>Creator share goes to</dt>
          <dd>{payee ? <span className={s.mono} title={payee}>{shortAddr(payee)}</span> : "Registrai treasury"}</dd>
        </div>
        <div className={s.fact}>
          <dt>Proposed</dt>
          <dd>{Number.isFinite(Date.parse(p.createdAt)) ? humanUtc(Math.floor(Date.parse(p.createdAt) / 1000)) : "—"}</dd>
        </div>
      </dl>
      <StatusCallout p={p} chain={chain} checking={checking} />
    </section>
  );
}

function StatusCallout({ p, chain, checking }: { p: Proposal; chain: OnChain | null; checking: boolean }) {
  if (chain?.kind === "opened") {
    return (
      <div className={s.callout} data-tone="opened">
        <p>Opened on {ROUNDS.label} with a 5 USDC starting pool.</p>
        <p>
          <Link className={s.marketLink} href={proposedMarketHref(chain.marketId)}>View the market →</Link>
        </p>
        <p>
          Creator share earned: {chain.creatorFees === null ? "could not be read just now" : `${formatUsdc(chain.creatorFees, 2)} USDC`}
          {" · "}forwarded so far: {chain.forwarded === null ? "could not be read just now" : `${formatUsdc(chain.forwarded, 2)} USDC`}
        </p>
        <p>Registrai&#8217;s agent forwards it to {p.creatorPayee ? "the payee wallet" : "the Registrai treasury"} daily.</p>
      </div>
    );
  }
  switch (p.status) {
    case "rejected":
      return (
        <div className={s.callout} data-tone="rejected">
          <p><b>Why it was not approved:</b> {p.reason || "no reason was given."}</p>
        </div>
      );
    case "queued":
      return (
        <div className={s.callout}>
          <p>Builder and wonder markets open when Perennial markets launch. This proposal waits in the phase 2 queue until then.</p>
        </div>
      );
    case "approved":
    case "opened":
      return (
        <div className={s.callout}>
          <p>Approved and signed by the team. Registrai&#8217;s agent opens it on {ROUNDS.label} within a few minutes; this page finds it on chain.</p>
          {checking && <p>Checking the chain…</p>}
          {chain?.kind === "not-yet" && !chain.complete && <p>Part of the chain history could not be read just now; reload to check again.</p>}
          {chain?.kind === "error" && <p>The chain could not be read just now; reload to check again.</p>}
        </div>
      );
    default:
      return (
        <div className={s.callout}>
          <p>Waiting for review. The team may tighten the wording or deadline before approving; this page always shows the final version.</p>
        </div>
      );
  }
}

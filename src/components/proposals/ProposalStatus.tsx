"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createPublicClient, getAbiItem, parseAbiItem, type Hex } from "viem";
import { marketsV4Abi } from "@/lib/abi";
import { getWalletChain, transportFor, type WalletChain } from "@/lib/chains";
import { shortAddr } from "@/lib/format";
import type { Proposal, ProposalKind } from "@/lib/market-proposals";
import { formatUsdc } from "@/lib/perennial-market";
import {
  PRICE_SOURCE, humanUtc, proposalFeedKey, proposalScanStart, scanForward, statusChip, sumCreatorFees,
} from "@/lib/propose-form";
import { PROPOSALS_API } from "@/lib/proposals-api";
import {
  ROUNDS, mergeFeedLogs, parseMarketLogs, scanLogs, seedFeedBook, type FeedCreatedLog, type MarketCreatedLog,
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

type Loaded =
  | { id: string; kind: "ok"; proposal: Proposal }
  | { id: string; kind: "missing" }
  | { id: string; kind: "error"; message: string };

type OnChain =
  | { kind: "opened"; marketId: Hex; creatorFees: bigint | null }
  | { kind: "not-yet"; complete: boolean }
  | { kind: "error" };

/**
 * The API never learns that a market was opened: read it from chain. The rounds
 * agent provisions the feed "registrai-data:p-<id>" (FeedCreated on the Registry,
 * creator = the agent), then opens the market on it (MarketCreated on MarketsV4);
 * the creator share is the sum of that market's FeesPaid.creatorFee.
 */
async function readOnChain(p: Proposal): Promise<OnChain> {
  const chain = getWalletChain(ROUNDS.chainId) as WalletChain;
  const client = createPublicClient({ chain: chain.viemChain, transport: transportFor(chain) });
  const C = ROUNDS.contracts;
  const agent = ROUNDS.agent;
  const block = await client.getBlock({ blockTag: "latest" });
  const head = block.number;
  const createdS = Math.floor(Date.parse(p.createdAt) / 1000) || 0;
  const from = proposalScanStart(head, Number(block.timestamp), createdS, ROUNDS.deployBlock);
  const key = proposalFeedKey(p.id);

  const feedScan = await scanForward(
    (a, b) => client.getLogs({ address: C.Registry, event: FEED_CREATED, args: { creator: agent }, fromBlock: a, toBlock: b }),
    from,
    head,
    (logs) => Object.values(mergeFeedLogs(seedFeedBook({}), logs as unknown as FeedCreatedLog[], agent).byKey).some((f) => f.key === key),
  );
  const book = mergeFeedLogs(seedFeedBook({}), feedScan.logs as unknown as FeedCreatedLog[], agent);
  const feeds = Object.values(book.byId).filter((f) => f.key === key);
  if (!feeds.length) return { kind: "not-yet", complete: feedScan.complete };

  const feedFrom = feeds.reduce((m, f) => (f.blockNumber < m ? f.blockNumber : m), head);
  const ids = feeds.map((f) => f.feedId);
  const found = (logs: readonly unknown[]) => parseMarketLogs(logs as MarketCreatedLog[], book, agent).length > 0;
  const marketScan = await scanForward(
    (a, b) => client.getLogs({ address: C.MarketsV4, event: MARKET_CREATED, args: { feedId: ids }, fromBlock: a, toBlock: b }),
    feedFrom,
    head,
    found,
  );
  const market = parseMarketLogs(marketScan.logs as unknown as MarketCreatedLog[], book, agent)[0];
  if (!market) return { kind: "not-yet", complete: marketScan.complete };

  const fees = await scanLogs(
    (a, b) => client.getLogs({ address: C.MarketsV4, event: FEES_PAID, args: { marketId: market.marketId }, fromBlock: a, toBlock: b }),
    market.blockNumber,
    head,
  );
  return { kind: "opened", marketId: market.marketId, creatorFees: fees.complete ? sumCreatorFees(fees.logs) : null };
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
  const forwarded = p.forwarded && /^\d+$/.test(p.forwarded) ? BigInt(p.forwarded) : null;

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
      <StatusCallout p={p} chain={chain} checking={checking} forwarded={forwarded} />
    </section>
  );
}

function StatusCallout({ p, chain, checking, forwarded }: { p: Proposal; chain: OnChain | null; checking: boolean; forwarded: bigint | null }) {
  if (chain?.kind === "opened") {
    return (
      <div className={s.callout} data-tone="opened">
        <p>Opened on {ROUNDS.label} with a 5 USDC starting pool.</p>
        <p>
          <Link className={s.marketLink} href={`/rounds/market/?id=${chain.marketId}`}>View the market →</Link>
        </p>
        <p>
          Creator share earned: {chain.creatorFees === null ? "could not be read just now" : `${formatUsdc(chain.creatorFees, 2)} USDC`}
          {forwarded !== null && ` · forwarded so far: ${formatUsdc(forwarded, 2)} USDC`}
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

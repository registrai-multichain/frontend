"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createPublicClient, getAbiItem, parseAbiItem, type Hex } from "viem";
import { marketsV4Abi, nanoLedgerAbi } from "@/lib/abi";
import { getWalletChain, transportFor, type WalletChain } from "@/lib/chains";
import { shortAddr } from "@/lib/format";
import { OPENING_DELAY_S, openingOverdue, type ApprovalMessageJson, type Proposal, type ProposalKind } from "@/lib/market-proposals";
import { UnsignedSource } from "./UnsignedSource";
import { verifiedApproval } from "@/lib/proposal-signature";
import {
  PRICE_SOURCE, feesScanEnd, forwardPayee, forwardedShown, humanUtc, isTreasury, shareExact, shareText, mergeFeeProgress, mergeScanProgress, parseScanCache,
  proposalFeedKey, proposalScanStart, scanForward, statusChip, statusWords, sumCreatorFees, type ApprovalCheck, type ScanCache,
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
  /** null: could not be read just now; forwarded undefined: still reading. */
  | { kind: "opened"; marketId: Hex; creatorFees: bigint | null; forwarded?: bigint | null }
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
async function readOnChain(p: Proposal, emit: (partial: OnChain) => void): Promise<OnChain> {
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

  // 3. Its creator fees, up to shortly after expiry, and 4. what the agent forwarded to
  //    the payee since the market opened, up to the head (it forwards daily while the
  //    market trades and once more after it settles). Read side by side; the earned
  //    total is shown as soon as it is in.
  const mBlock = BigInt(m.blockNumber ?? "0");
  const createdTs = m.createdTs ?? headTs - Number(head - mBlock) * BLOCK_SECS;
  const end = feesScanEnd(head, mBlock, createdTs, m.expiry ?? headTs);
  const readFees = async (): Promise<bigint | null> => {
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
    return cache.fees && BigInt(cache.fees.scannedTo) >= end ? BigInt(cache.fees.sum) : null;
  };
  const readForwarded = async (): Promise<bigint | null> => {
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
    return cache.fwd && BigInt(cache.fwd.scannedTo) >= head ? BigInt(cache.fwd.sum) : null;
  };
  const fwd = readForwarded().catch(() => null);
  const creatorFees = await readFees().catch(() => null);
  emit({ kind: "opened", marketId, creatorFees });
  return { kind: "opened", marketId, creatorFees, forwarded: await fwd };
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
    readOnChain(proposal, (partial) => alive && setOnChain({ id: proposal.id, result: partial }))
      .then((result) => alive && setOnChain({ id: proposal.id, result }))
      .catch(() => alive && setOnChain({ id: proposal.id, result: { kind: "error" } }));
    return () => {
      alive = false;
    };
  }, [proposal, needsChain]);

  const chain = proposal && onChain?.id === proposal.id ? onChain.result : null;

  // I4: an approved proposal's words are the market's: shown only under the team's signature.
  const [signed, setSigned] = useState<{ id: string; message: ApprovalMessageJson | null } | null>(null);
  useEffect(() => {
    if (!proposal?.approval) return;
    let alive = true;
    void verifiedApproval(proposal.approval, proposal.id).then((message) => alive && setSigned({ id: proposal.id, message }));
    return () => {
      alive = false;
    };
  }, [proposal]);
  const signature: ApprovalCheck = !proposal || !(proposal.status === "approved" || proposal.status === "opened")
    ? { state: "unsigned" }
    : signed?.id !== proposal.id
      ? { state: "checking" }
      : signed.message
        ? { state: "ok", message: signed.message }
        : { state: "bad" };

  // "Opening delayed" turns on by the clock (I3), so the page re-renders once a minute.
  const [nowS, setNowS] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowS(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);

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
    body = <ProposalCard p={current.proposal} chain={chain} checking={needsChain && !chain} signature={signature} nowS={nowS} />;
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

/** I3: approved over OPENING_DELAY_S ago and the chain, read to the head, has no market for it. */
const isDelayed = (p: Proposal, chain: OnChain | null, nowS: number) => chain?.kind === "not-yet" && chain.complete && openingOverdue(p, nowS);

function ProposalCard({ p, chain, checking, signature, nowS }: { p: Proposal; chain: OnChain | null; checking: boolean; signature: ApprovalCheck; nowS: number }) {
  const opened = chain?.kind === "opened" ? chain : null;
  const chip = statusChip(p.status, Boolean(opened), isDelayed(p, chain, nowS));
  const isPrice = p.kind === "price";
  // An approved proposal shows the signed question, deadline and payee (where the agent
  // forwards: the treasury for an empty, zero or own-contract payee), the rule only when it
  // hashes to the signed ruleHash; unverified, "Proposal #id" and none of them. The source
  // is never signed: plain text, labelled (R54 F1).
  const words = statusWords(p, signature);
  const payee = words.payee;

  return (
    <section className={`${s.panel} ${s.done}`} aria-labelledby="pp-question">
      <div className={s.statusHead}>
        <span className={s.chip} data-tone={chip.tone}>{chip.label}</span>
        <span className={s.kindLabel}>{KIND_LABEL[p.kind] ?? p.kind}</span>
        <span className={s.idLabel}>{p.id}</span>
      </div>
      <h2 id="pp-question" className={s.question}>{words.question}</h2>
      {signature.state === "bad" && (
        <p className={s.ruleText}>
          The team&#8217;s signature on this proposal could not be verified, so its wording is not shown here. The market&#8217;s terms on
          chain are what counts.
        </p>
      )}
      {isPrice ? (
        <div className={s.ruleBlock}>
          <span className={s.ruleLabel}>Settles on</span>
          <p className={s.ruleText}>{PRICE_SOURCE}.</p>
        </div>
      ) : (
        words.rule && (
          <div className={s.ruleBlock}>
            <span className={s.ruleLabel}>Resolves Yes if</span>
            <p className={s.ruleText}>{words.rule}</p>
          </div>
        )
      )}
      <dl className={s.facts}>
        {words.deadline !== null && (
          <div className={s.fact}>
            <dt>Deadline</dt>
            <dd>{humanUtc(words.deadline)}</dd>
          </div>
        )}
        {!isPrice && words.source && (
          <div className={s.fact}>
            <dt>Where the answer comes from</dt>
            <dd>
              <UnsignedSource source={words.source} />
            </dd>
          </div>
        )}
        {payee !== null && (
          <div className={s.fact}>
            <dt>Creator share goes to</dt>
            <dd>
              {isTreasury(payee) ? (
                "Registrai treasury"
              ) : (
                <>
                  <span className={s.mono} title={payee}>{shortAddr(payee)}</span>&#8217;s Registrai balance on {ROUNDS.label}
                </>
              )}
            </dd>
          </div>
        )}
        <div className={s.fact}>
          <dt>Proposed</dt>
          <dd>{Number.isFinite(Date.parse(p.createdAt)) ? humanUtc(Math.floor(Date.parse(p.createdAt) / 1000)) : "—"}</dd>
        </div>
      </dl>
      <StatusCallout p={p} chain={chain} checking={checking} nowS={nowS} payee={payee} />
    </section>
  );
}

/** An amount to 4 decimals, the exact 6 in its tooltip. */
function Share({ v }: { v: bigint }) {
  return <span title={shareExact(v)}>{shareText(v)}</span>;
}

/** `payee`: the verified approval's (null when it could not be verified: the forwarding
 *  lines are left out). */
function StatusCallout({ p, chain, checking, nowS, payee }: { p: Proposal; chain: OnChain | null; checking: boolean; nowS: number; payee: string | null }) {
  const toTreasury = payee !== null && isTreasury(payee);
  if (chain?.kind === "opened") {
    const shown = forwardedShown(chain.forwarded, chain.creatorFees);
    return (
      <div className={s.callout} data-tone="opened">
        <p>Opened on {ROUNDS.label} with a 5 USDC starting pool.</p>
        <p>
          <Link className={s.marketLink} href={proposedMarketHref(chain.marketId)}>View the market →</Link>
        </p>
        <p>
          Creator share earned: {chain.creatorFees === null ? "could not be read just now" : <Share v={chain.creatorFees} />}
        </p>
        {payee !== null && (
          <p>
            Forwarded to {toTreasury ? "the Registrai treasury" : <span className={s.mono} title={payee}>{shortAddr(payee)}</span>} (up to this
            market&#8217;s share): {chain.forwarded === null ? "could not be read just now" : shown === undefined ? "—" : <Share v={shown} />}
          </p>
        )}
        {payee === null ? null : toTreasury ? (
          <p>Registrai&#8217;s agent forwards it to the Registrai treasury daily.</p>
        ) : (
          <p>
            Registrai&#8217;s agent forwards it daily to the payee&#8217;s Registrai trading balance on {ROUNDS.label} (NanoLedger), not straight
            to the wallet: it shows in the wallet once withdrawn from the balance menu.
          </p>
        )}
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
      if (isDelayed(p, chain, nowS))
        return (
          <div className={s.callout}>
            <p>
              <b>Approved — opening delayed; the team has been told.</b> Registrai&#8217;s agent did not open it within{" "}
              {OPENING_DELAY_S / 60} minutes of the approval: it may be waiting for a free slot (it opens a few new markets a day), or it
              could not open it as signed. This page finds the market on chain once it opens.
            </p>
          </div>
        );
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

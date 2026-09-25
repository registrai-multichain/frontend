"use client";

/**
 * Common markets: Registrai's 5-minute Up/Down rounds and event markets.
 *
 * Every asset shares one round clock (rounds open on wall-clock 5-minute
 * boundaries), so the page leads with that single clock and lets each asset
 * card stay quiet: the live price against the strike, the pool's Up/Down split,
 * and a strip of how the last rounds closed.
 *
 * Reads are pinned to Arc testnet through the official RPC (batched); writes go
 * through the connected wallet on that chain. Collateral lives on NanoLedger:
 * deposit once, then buys pull from the ledger balance (exact-amount spender
 * approvals, never unlimited). Live prices are Coinbase's public ticker, shown
 * for reference only: a round settles on the agent's on-chain reading.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { useWallet } from "./WalletProvider";
import { getWalletChain, transportFor, txUrl as txUrlFor, type WalletChain } from "@/lib/chains";
import { activeProvider } from "@/lib/wallets";
import { attestationAbi, marketsV4Abi, nanoLedgerAbi, usdcAbi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";
import {
  OUTCOME,
  PHASE,
  TRADE_DEADLINE_SECS,
  formatUsdc,
  maxDeposit,
  minOutWithSlippage,
  parseUsdcInput,
  quoteBuy,
  quoteSell,
  utcStamp,
} from "@/lib/perennial-market";
import {
  ROUNDS,
  ROUND_TRADE_WINDOW_SECS,
  claimList,
  clockUtc,
  eventVisible,
  evidenceNote,
  formatPrice,
  formatScaled,
  groupRounds,
  impliedPct,
  latestMarketFor,
  mergeFeedLogs,
  nextBoundary,
  parseCoinbaseTicker,
  parseMarketLogs,
  roundLabel,
  roundStart,
  roundStatus,
  roundTradeDeadline,
  scanLogs,
  scanStart,
  seedFeedBook,
  strikeDelta,
  timeLeft,
  toScaled,
  type AssetMeta,
  type EventMeta,
  type FeedBook,
  type FeedCreatedLog,
  type MarketCreatedLog,
  type Reading,
  type RoundMarket,
  type RoundStatus,
} from "@/lib/rounds";

// ───────────────────────────── chain wiring ─────────────────────────────

const D = ROUNDS;
const C = D.contracts;
const CHAIN = getWalletChain(D.chainId) as WalletChain;
const HUMAN = { testnet: true, networkName: "Arc testnet" };
const txUrl = (h: string) => txUrlFor(CHAIN, h);

const FEED_CREATED = parseAbiItem(
  "event FeedCreated(bytes32 indexed feedId, address indexed creator, string description, bytes32 methodologyHash, uint256 minBond, uint256 disputeWindow, address resolver)",
);
const MARKET_CREATED = parseAbiItem(
  "event MarketCreated(bytes32 indexed marketId, address indexed creator, bytes32 indexed feedId, address agent, int256 threshold, uint8 comparator, uint256 expiry, uint256 liquidity)",
);
const BOUGHT = parseAbiItem(
  "event Bought(bytes32 indexed marketId, address indexed buyer, uint8 outcome, uint256 collateralIn, uint256 sharesOut, uint256 fee)",
);

const SLIPPAGES = [50n, 100n, 200n] as const; // bps
const fmt = (v: bigint, dp = 2) => formatUsdc(v, dp);
const cents = (p: bigint) => `${Math.round(impliedPct(p))}¢`;

type MarketState = {
  phase: number;
  yesWon: boolean;
  threshold: bigint;
  expiry: number;
  yesReserve: bigint;
  noReserve: bigint;
  yesPrice: bigint;
  noPrice: bigint;
};
type Holding = { yes: bigint; no: bigint };
type EventReading = { value: bigint; timestamp: number };

type Snapshot = {
  /** Chain time at the read, and the client clock it was read at. */
  chainNow: number;
  readAt: number;
  markets: RoundMarket[];
  book: FeedBook;
  state: Record<string, MarketState>;
  readings: Record<string, Reading>;
  holdings: Record<string, Holding>;
  redeemable: Record<string, bigint>;
  eventReadings: Record<string, EventReading>;
  /** Event key -> its market id (discovered, else the deploy seed). */
  eventMarkets: Record<string, Hex>;
  ledgerBal?: bigint;
  walletBal?: bigint;
  feeBps?: bigint;
};

const settled = (phase: number | undefined) => phase === PHASE.Resolved || phase === PHASE.Voided;

// ───────────────────────────── data ─────────────────────────────

function useRoundsData(client: PublicClient, address: Address | undefined) {
  const [snap, setSnap] = useState<Snapshot>();
  const [loadError, setLoadError] = useState<string>();
  const disc = useRef({
    book: seedFeedBook(D.feeds),
    markets: new Map<string, RoundMarket>(),
    scannedTo: -1n,
    mine: new Set<string>(),
    mineFor: undefined as Address | undefined,
    mineScannedTo: -1n,
    /** Settled markets never change again: read once. */
    final: new Map<string, MarketState>(),
    feeBps: undefined as bigint | undefined,
  });
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const d = disc.current;
    try {
      const block = await client.getBlock({ blockTag: "latest" });
      const head = block.number;
      const chainNow = Number(block.timestamp);

      // 1. Discovery: the agent's feeds, then markets on them, over the recent
      //    window (first load) or since the last scan. Chunked ≤ 5000 blocks.
      const from = d.scannedTo < 0n ? scanStart(head, D.deployBlock) : d.scannedTo + 1n;
      if (from <= head) {
        // Feeds and markets are scanned side by side (markets filtered to the
        // feeds known so far); a feed first seen in this range gets its own
        // market scan right after, so nothing on it is missed.
        const marketsOn = (ids: Hex[], to: bigint) =>
          scanLogs(
            (a, b) => client.getLogs({ address: C.MarketsV4, event: MARKET_CREATED, args: { feedId: ids }, fromBlock: a, toBlock: b }),
            from,
            to,
          );
        const known = Object.keys(d.book.byId) as Hex[];
        const [feeds, mk] = await Promise.all([
          scanLogs(
            (a, b) => client.getLogs({ address: C.Registry, event: FEED_CREATED, args: { creator: D.agent }, fromBlock: a, toBlock: b }),
            from,
            head,
          ),
          marketsOn(known, head),
        ]);
        d.book = mergeFeedLogs(d.book, feeds.logs as unknown as FeedCreatedLog[], D.agent);
        const fresh = (Object.keys(d.book.byId) as Hex[]).filter((id) => !known.includes(id));
        const extra = fresh.length ? await marketsOn(fresh, head) : { logs: [], scannedTo: head };
        const logs = [...mk.logs, ...extra.logs] as unknown as MarketCreatedLog[];
        for (const m of parseMarketLogs(logs, d.book, D.agent)) d.markets.set(m.marketId, m);
        // Advance only over what every scan covered.
        const covered = [feeds.scannedTo, mk.scannedTo, extra.scannedTo].reduce((x, y) => (y < x ? y : x));
        if (covered >= from) d.scannedTo = covered;
      }

      // 2. The connected wallet's markets (Bought logs) — the only ones that can
      //    hold a claim, so redeemable is read for those alone.
      if (d.mineFor !== address) {
        d.mine = new Set();
        d.mineFor = address;
        d.mineScannedTo = -1n;
      }
      if (address) {
        const mFrom = d.mineScannedTo < 0n ? scanStart(head, D.deployBlock) : d.mineScannedTo + 1n;
        if (mFrom <= head) {
          const r = await scanLogs(
            (a, b) => client.getLogs({ address: C.MarketsV4, event: BOUGHT, args: { buyer: address }, fromBlock: a, toBlock: b }),
            mFrom,
            head,
          );
          for (const lg of r.logs) if (lg.args.marketId) d.mine.add(lg.args.marketId.toLowerCase());
          if (r.scannedTo >= mFrom) d.mineScannedTo = r.scannedTo;
        }
      }

      // 3. Which markets matter now.
      const markets = [...d.markets.values()];
      const knownPhases: Record<string, number> = {};
      for (const [id, s] of d.final) knownPhases[id] = s.phase;
      const groups = groupRounds(markets, D.assets.map((a) => a.key), chainNow, knownPhases);
      const eventMarkets: Record<string, Hex> = {};
      for (const e of D.events) {
        const found = latestMarketFor(markets, e.key)?.marketId ?? (e.marketId ? (e.marketId.toLowerCase() as Hex) : undefined);
        if (found) eventMarkets[e.key] = found;
      }
      const current = Object.values(groups).flatMap((g) => (g.current ? [g.current.marketId] : []));
      const recent = Object.values(groups).flatMap((g) => g.recent);
      const eventIds = Object.values(eventMarkets);
      const mine = [...d.mine];
      const toRead = [...new Set([...current, ...recent.map((m) => m.marketId), ...eventIds, ...mine])].filter((id) => !d.final.has(id));

      // 4. Reads (the batched transport coalesces them into a few requests).
      const readMarket = async (id: string): Promise<[string, MarketState]> => {
        const [m, yp, np] = await Promise.all([
          client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "getMarket", args: [id as Hex] }) as Promise<{
            threshold: bigint; expiry: bigint; yesReserve: bigint; noReserve: bigint; phase: number; yesWon: boolean;
          }>,
          client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "priceOf", args: [id as Hex, OUTCOME.Yes] }) as Promise<bigint>,
          client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "priceOf", args: [id as Hex, OUTCOME.No] }) as Promise<bigint>,
        ]);
        return [id, { phase: Number(m.phase), yesWon: m.yesWon, threshold: m.threshold, expiry: Number(m.expiry), yesReserve: m.yesReserve, noReserve: m.noReserve, yesPrice: yp, noPrice: np }];
      };
      const readingFor = async (m: RoundMarket): Promise<[string, Reading]> => {
        const [found, value, timestamp, finalized] = (await client.readContract({
          address: C.Attestation,
          abi: attestationAbi,
          functionName: "firstInWindow",
          args: [m.feedId, D.agent, BigInt(m.expiry), BigInt(m.expiry + D.settlementWindow)],
        })) as readonly [boolean, bigint, bigint, boolean];
        return [m.marketId, { found, value, timestamp: Number(timestamp), finalized }];
      };
      const holdingFor = async (id: string): Promise<[string, Holding]> => {
        const [yes, no] = await Promise.all([
          client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "yesBalance", args: [id as Hex, address!] }) as Promise<bigint>,
          client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "noBalance", args: [id as Hex, address!] }) as Promise<bigint>,
        ]);
        return [id, { yes, no }];
      };

      const [states, feeBps, eventReadings, ledgerBal, walletBal] = await Promise.all([
        Promise.all(toRead.map(readMarket)),
        d.feeBps ?? (client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "TRADE_FEE_BPS" }) as Promise<bigint>),
        Promise.all(
          D.events.map(async (e): Promise<[string, EventReading] | null> => {
            const feed = d.book.byKey[e.key];
            if (!feed) return null;
            const [value, timestamp] = (await client.readContract({
              address: C.Attestation,
              abi: attestationAbi,
              functionName: "latestValue",
              args: [feed.feedId, D.agent],
            })) as readonly [bigint, bigint, boolean];
            return [e.key, { value, timestamp: Number(timestamp) }];
          }),
        ),
        address ? (client.readContract({ address: C.NanoLedger, abi: nanoLedgerAbi, functionName: "balanceOf", args: [address] }) as Promise<bigint>) : undefined,
        address ? (client.readContract({ address: C.USDC, abi: usdcAbi, functionName: "balanceOf", args: [address] }) as Promise<bigint>) : undefined,
      ]);
      d.feeBps = feeBps;
      const state: Record<string, MarketState> = Object.fromEntries(d.final);
      for (const [id, s] of states) {
        state[id] = s;
        if (settled(s.phase)) d.final.set(id, s);
      }

      // Readings only for closed rounds still waiting to settle.
      const byId = (id: string) => d.markets.get(id);
      const pendingRounds = [...recent, ...eventIds.flatMap((id) => (byId(id) ? [byId(id)!] : []))].filter(
        (m) => m.expiry <= chainNow && !settled(state[m.marketId]?.phase),
      );
      const holdIds = address ? [...new Set([...current, ...eventIds, ...mine.filter((id) => !settled(state[id]?.phase))])] : [];
      const claimIds = address ? [...new Set([...mine, ...eventIds])].filter((id) => settled(state[id]?.phase)) : [];
      const [readings, holdings, redeemable] = await Promise.all([
        Promise.all(pendingRounds.map(readingFor)),
        Promise.all(holdIds.map(holdingFor)),
        Promise.all(
          claimIds.map(async (id): Promise<[string, bigint]> => [
            id,
            (await client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "redeemable", args: [id as Hex, address!] })) as bigint,
          ]),
        ),
      ]);

      setSnap({
        chainNow,
        readAt: Date.now() / 1000,
        markets,
        book: d.book,
        state,
        readings: Object.fromEntries(readings),
        holdings: Object.fromEntries(holdings),
        redeemable: Object.fromEntries(redeemable),
        eventReadings: Object.fromEntries(eventReadings.filter((x): x is [string, EventReading] => x !== null)),
        eventMarkets,
        ledgerBal,
        walletBal,
        feeBps,
      });
      setLoadError(undefined);
    } catch (e) {
      console.error("rounds refresh", e);
      setLoadError(humanizeError(e, HUMAN));
    } finally {
      busy.current = false;
    }
  }, [client, address]);

  return { snap, loadError, refresh };
}

/** Coinbase public ticker, polled from the browser every 2 s (paused when hidden). */
function useLivePrices(assets: AssetMeta[]) {
  const [prices, setPrices] = useState<Record<string, { price: number; dir: "up" | "down" | "flat" }>>({});
  useEffect(() => {
    let alive = true;
    const poll = async (force = false) => {
      if (!force && typeof document !== "undefined" && document.hidden) return;
      const got = await Promise.all(
        assets.map(async (a) => {
          try {
            const r = await fetch(`https://api.exchange.coinbase.com/products/${a.product}/ticker`, { cache: "no-store" });
            return [a.key, parseCoinbaseTicker(await r.json())] as const;
          } catch {
            return [a.key, undefined] as const;
          }
        }),
      );
      if (!alive) return;
      setPrices((prev) => {
        const next = { ...prev };
        for (const [k, p] of got) {
          if (p === undefined) continue;
          const last = prev[k]?.price;
          next[k] = { price: p, dir: last === undefined || last === p ? prev[k]?.dir ?? "flat" : p > last ? "up" : "down" };
        }
        return next;
      });
    };
    void poll(true);
    const id = setInterval(() => void poll(), 2_000);
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [assets]);
  return prices;
}

// ───────────────────────────── transactions ─────────────────────────────

type TxState = { pending: string; error?: string; hash?: Hex; done?: string; scope?: string };

function useTx(client: PublicClient, refresh: () => Promise<void>) {
  const { address, walletChainId } = useWallet();
  const onChain = walletChainId === D.chainId;
  const wallet = useMemo(() => {
    const eth = activeProvider();
    if (!eth || !address || !onChain) return undefined;
    return createWalletClient({ chain: CHAIN.viemChain, transport: custom(eth), account: address });
  }, [address, onChain]);
  const [st, setSt] = useState<TxState>({ pending: "" });

  const run = useCallback(
    async (scope: string, label: string, steps: () => Promise<Hex>, doneText: string) => {
      if (!wallet || !address) {
        setSt({ pending: "", scope, error: "Connect a wallet on Arc testnet first." });
        return false;
      }
      setSt({ pending: label, scope });
      try {
        const hash = await steps();
        setSt({ pending: label, scope, hash });
        const r = await client.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error("transaction reverted");
        setSt({ pending: "", scope, hash, done: doneText });
        await refresh();
        return true;
      } catch (e) {
        setSt((s) => ({ pending: "", scope, hash: s.hash, error: humanizeError(e, HUMAN) }));
        return false;
      }
    },
    [wallet, address, client, refresh],
  );

  const send = useCallback(
    async (to: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]) => {
      await client.simulateContract({ address: to, abi: abi as never, functionName: functionName as never, args: args as never, account: address! });
      return wallet!.writeContract({ address: to, abi: abi as never, functionName: functionName as never, args: args as never, chain: CHAIN.viemChain, account: address! });
    },
    [client, wallet, address],
  );

  const waitOk = useCallback(
    async (hash: Hex) => {
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("approval reverted");
    },
    [client],
  );

  /** Exact-amount NanoLedger allowance for MarketsV4 (never unlimited). */
  const ensureSpender = useCallback(
    async (needed: bigint) => {
      const a = (await client.readContract({ address: C.NanoLedger, abi: nanoLedgerAbi, functionName: "allowance", args: [address!, C.MarketsV4] })) as bigint;
      if (a >= needed) return;
      await waitOk(await send(C.NanoLedger, nanoLedgerAbi, "approveSpender", [C.MarketsV4, needed]));
    },
    [client, address, send, waitOk],
  );

  return { client, st, setSt, run, send, ensureSpender, waitOk };
}

type Tx = ReturnType<typeof useTx>;

// ───────────────────────────── page ─────────────────────────────

export function CommonMarkets() {
  const { address, walletChainId, connect, switchChain } = useWallet();
  const client = useMemo(
    () => createPublicClient({ chain: CHAIN.viemChain, transport: transportFor(CHAIN, { batch: true }) }) as PublicClient,
    [],
  );
  const { snap, loadError, refresh } = useRoundsData(client, address);
  const prices = useLivePrices(D.assets);
  const tx = useTx(client, refresh);

  // Client clock, corrected to chain time at the last read.
  const [clientNow, setClientNow] = useState(0);
  useEffect(() => {
    setClientNow(Date.now() / 1000);
    const id = setInterval(() => setClientNow(Date.now() / 1000), 250);
    return () => clearInterval(id);
  }, []);
  const skew = snap ? snap.chainNow - snap.readAt : 0;
  const now = clientNow ? clientNow + skew : 0;

  // Chain state every 5 s, and right after each round boundary (the agent opens
  // the new round a few seconds after it, so look again shortly after).
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(id);
  }, [refresh]);
  const boundary = now ? Math.floor(now / D.roundSecs) : 0;
  const lastBoundary = useRef(0);
  useEffect(() => {
    if (!boundary) return;
    if (lastBoundary.current && boundary !== lastBoundary.current) {
      void refresh();
      const t1 = setTimeout(() => void refresh(), 4_000);
      const t2 = setTimeout(() => void refresh(), 10_000);
      lastBoundary.current = boundary;
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    lastBoundary.current = boundary;
  }, [boundary, refresh]);

  const [open, setOpen] = useState<{ id: string; side: "yes" | "no"; mode: "buy" | "sell" }>();

  const groups = useMemo(() => {
    if (!snap) return undefined;
    const phases: Record<string, number> = {};
    for (const [id, s] of Object.entries(snap.state)) phases[id] = s.phase;
    return groupRounds(snap.markets, D.assets.map((a) => a.key), now || snap.chainNow, phases);
    // Regroup on each read and at each boundary, not every clock tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, boundary]);

  const roundEnd = now ? nextBoundary(now) : 0;
  const onChain = walletChainId === D.chainId;

  return (
    <div className="pt-10 sm:pt-14 fade-up">
      <Header now={now} roundEnd={roundEnd} />

      <LedgerBar snap={snap} tx={tx} address={address} onChain={onChain} connect={connect} switchChain={() => switchChain(D.chainId)} />

      {loadError && !snap && (
        <p className="mb-6 border border-down bg-bg-elev px-4 py-3 text-[13px] text-down">
          Could not read the markets from Arc testnet: {loadError} Retrying every 5 seconds.
        </p>
      )}

      <section aria-label="Five-minute rounds" className="space-y-px">
        {D.assets.map((a) => (
          <AssetCard
            key={a.key}
            asset={a}
            snap={snap}
            current={groups?.[a.key]?.current}
            recent={groups?.[a.key]?.recent ?? []}
            live={prices[a.key]}
            now={now}
            open={open}
            setOpen={setOpen}
            tx={tx}
            canTrade={Boolean(address && onChain)}
          />
        ))}
      </section>
      <p className="mt-3 max-w-[72ch] text-2xs leading-relaxed text-fg-dim">
        Prices are live · Coinbase, for reference — the round settles on the agent&apos;s on-chain reading of the
        1-minute close at the end of the round. Up wins only if that reading is strictly higher than the strike; a tie is
        Down. The reading becomes final after a 10-minute challenge window and the agent resolves the round right after,
        about 10–11 minutes after the close; in the last-rounds strip, a countdown is the time left until that round&apos;s
        reading is final.
      </p>

      {address && <Claims snap={snap} tx={tx} now={now} />}

      <EventMarkets snap={snap} now={now} open={open} setOpen={setOpen} tx={tx} canTrade={Boolean(address && onChain)} address={address} />

      <p className="mt-12 border-t border-line pt-4 text-2xs leading-relaxed text-fg-dim">
        Markets read live from{" "}
        <a className="text-fg-mute underline" href={`${D.explorer}/address/${C.MarketsV4}`} target="_blank" rel="noreferrer">
          MarketsV4 on Arc testnet
        </a>
        . Rounds are opened and settled by Registrai&apos;s agent{" "}
        <a className="text-fg-mute underline" href={`${D.explorer}/address/${D.agent}`} target="_blank" rel="noreferrer">
          {D.agent.slice(0, 6)}…{D.agent.slice(-4)}
        </a>
        , which seeds each pool with 5 USDC. Every buy and sell pays a {snap?.feeBps !== undefined ? `${Number(snap.feeBps) / 100}%` : "1%"}{" "}
        trading fee; nothing is charged at settlement. Testnet USDC only.
      </p>
    </div>
  );
}

// ───────────────────────────── header ─────────────────────────────

function Header({ now, roundEnd }: { now: number; roundEnd: number }) {
  const left = now ? roundEnd - now : 0;
  const progress = now ? 1 - left / D.roundSecs : 0;
  const closing = now > 0 && left <= 30;
  return (
    <header className="mb-8 grid gap-6 border-b border-line pb-6 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
        <h1 className="font-serif text-[40px] leading-none tracking-tightest sm:text-[52px]">Common markets</h1>
        <p className="mt-3 max-w-[56ch] text-[13px] leading-relaxed text-fg-mute">
          Will it be higher in five minutes? A new Up/Down round opens on BTC, ETH, SOL, ZEC and HYPE every five
          minutes, struck at the price when it opens. Trade in and out until the close.
        </p>
      </div>
      <div className="sm:w-[240px]" aria-live="off">
        <div className="flex items-baseline justify-between gap-4 text-2xs text-fg-dim">
          <span>{now ? `Round ${roundLabel(roundEnd - D.roundSecs, roundEnd)}` : "Round"}</span>
          <span>closes in</span>
        </div>
        <div
          className={`tnum mt-1 text-right font-serif text-[56px] leading-none tracking-tightest ${closing ? "text-down" : "text-fg"}`}
          role="timer"
          aria-label="Time left in the current round"
        >
          {now ? timeLeft(left) : "–:––"}
        </div>
        <div className="mt-2 h-[3px] w-full overflow-hidden bg-line">
          <div
            className={`h-full transition-[width] duration-300 ease-linear ${closing ? "bg-down" : "bg-accent"}`}
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        </div>
      </div>
    </header>
  );
}

// ───────────────────────────── ledger ─────────────────────────────

function LedgerBar({
  snap,
  tx,
  address,
  onChain,
  connect,
  switchChain,
}: {
  snap?: Snapshot;
  tx: Tx;
  address?: Address;
  onChain: boolean;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
}) {
  const [amt, setAmt] = useState("");
  const scope = "ledger";
  const walletBal = snap?.walletBal ?? 0n;
  const ledgerBal = snap?.ledgerBal ?? 0n;
  const depositMax = maxDeposit(walletBal);

  async function deposit() {
    const p = parseUsdcInput(amt, { max: depositMax, label: "deposit" });
    if (!p.ok) {
      tx.setSt({ pending: "", scope, error: depositMax === 0n ? "Your wallet needs to keep a little USDC for gas; nothing left to deposit." : p.error });
      return;
    }
    const value = p.value;
    const ok = await tx.run(scope, "depositing", () => depositSteps(tx, address!, value), `Deposited ${fmt(value)} USDC.`);
    if (ok) setAmt("");
  }
  async function withdraw() {
    if (ledgerBal === 0n) return tx.setSt({ pending: "", scope, error: "Nothing to withdraw." });
    await tx.run(scope, "withdrawing", () => tx.send(C.NanoLedger, nanoLedgerAbi, "withdraw", [ledgerBal]), `Withdrew ${fmt(ledgerBal)} USDC to your wallet.`);
  }

  if (!address) {
    return (
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-line bg-bg-elev px-4 py-3">
        <p className="text-[13px] text-fg-mute">Connect a wallet to trade. Prices and results are public.</p>
        <button onClick={() => void connect()} className="bg-accent px-4 py-2 text-[13px] text-bg transition-colors hover:bg-accent-deep">
          Connect wallet
        </button>
      </div>
    );
  }
  if (!onChain) {
    return (
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-line bg-bg-elev px-4 py-3">
        <p className="text-[13px] text-fg-mute">These markets run on Arc testnet. Your wallet is on another network.</p>
        <button onClick={() => void switchChain()} className="bg-accent px-4 py-2 text-[13px] text-bg transition-colors hover:bg-accent-deep">
          Switch to Arc testnet
        </button>
      </div>
    );
  }
  const busy = Boolean(tx.st.pending);
  return (
    <div className="mb-6 border border-line bg-bg-elev px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <div className="text-2xs text-fg-dim">Trading balance</div>
          <div className="tnum font-serif text-[22px] leading-tight">{snap?.ledgerBal !== undefined ? `${fmt(ledgerBal)} USDC` : "…"}</div>
        </div>
        <div className="text-2xs text-fg-dim">
          Wallet <span className="tnum text-fg-mute">{fmt(walletBal)} USDC</span>
          <br />
          Buys draw from the trading balance; winnings land there too.
        </div>
        <div className="ml-auto flex items-stretch gap-2">
          <input
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
            inputMode="decimal"
            placeholder="USDC"
            aria-label="Amount to deposit"
            className="tnum w-[110px] border border-line bg-bg px-3 py-2 text-[14px] outline-none focus:border-accent"
          />
          <button onClick={deposit} disabled={busy} className="bg-accent px-4 text-[13px] text-bg transition-colors hover:bg-accent-deep disabled:opacity-50">
            {tx.st.pending === "depositing" ? "Depositing…" : "Deposit"}
          </button>
          <button
            onClick={withdraw}
            disabled={busy || ledgerBal === 0n}
            className="border border-line px-3 text-[13px] text-fg-mute transition-colors hover:border-accent hover:text-fg disabled:opacity-40"
          >
            {tx.st.pending === "withdrawing" ? "Withdrawing…" : "Withdraw all"}
          </button>
        </div>
      </div>
      <TxLine tx={tx} scope={scope} />
    </div>
  );
}

/** USDC approve (exact) then NanoLedger.deposit; returns the deposit tx hash. */
async function depositSteps(tx: Tx, address: Address, value: bigint): Promise<Hex> {
  const a = (await tx.client.readContract({ address: C.USDC, abi: usdcAbi, functionName: "allowance", args: [address, C.NanoLedger] })) as bigint;
  if (a < value) await tx.waitOk(await tx.send(C.USDC, usdcAbi, "approve", [C.NanoLedger, value]));
  return tx.send(C.NanoLedger, nanoLedgerAbi, "deposit", [value]);
}

function TxLine({ tx, scope }: { tx: Tx; scope: string }) {
  const st = tx.st;
  if (st.scope !== scope || (!st.error && !st.hash && !st.done && !st.pending)) return null;
  return (
    <div className="mt-2 text-2xs" aria-live="polite">
      {st.pending && <span className="text-fg-dim">Confirm in your wallet, then wait for the block… </span>}
      {st.done && <span className="text-up">{st.done} </span>}
      {st.error && <span className="text-down">{st.error} </span>}
      {st.hash && (
        <a href={txUrl(st.hash)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          View transaction ↗
        </a>
      )}
    </div>
  );
}

// ───────────────────────────── asset card ─────────────────────────────

type OpenTrade = { id: string; side: "yes" | "no"; mode: "buy" | "sell" } | undefined;

function AssetCard({
  asset,
  snap,
  current,
  recent,
  live,
  now,
  open,
  setOpen,
  tx,
  canTrade,
}: {
  asset: AssetMeta;
  snap?: Snapshot;
  current?: RoundMarket;
  recent: RoundMarket[];
  live?: { price: number; dir: "up" | "down" | "flat" };
  now: number;
  open: OpenTrade;
  setOpen: (o: OpenTrade) => void;
  tx: Tx;
  canTrade: boolean;
}) {
  const st = current ? snap?.state[current.marketId] : undefined;
  const strike = current?.threshold;
  const liveScaled = live ? toScaled(live.price, asset.decimals) : undefined;
  const delta = liveScaled !== undefined && strike !== undefined ? strikeDelta(liveScaled, strike) : undefined;
  const upPct = st ? impliedPct(st.yesPrice) : 50;
  const left = current && now ? current.expiry - now : 0;
  const trading = Boolean(current && st && st.phase === PHASE.Trading && left > 0);
  const hold = current ? snap?.holdings[current.marketId] : undefined;
  const isOpen = current && open?.id === current.marketId;

  return (
    <article className="border border-line bg-bg-elev p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="font-serif text-[26px] leading-none">{asset.symbol}</h2>
          <span className="truncate text-2xs text-fg-dim">{asset.name}</span>
        </div>
        <div
          className={`tnum font-serif text-[30px] leading-none tracking-tightest transition-colors duration-300 ${
            live?.dir === "up" ? "text-up" : live?.dir === "down" ? "text-down" : "text-fg"
          }`}
        >
          {live ? formatPrice(live.price, asset.decimals) : "—"}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-2xs text-fg-dim">
        <div className="min-w-0">
          {current ? (
            <>
              Round {roundLabel(roundStart(current.expiry), current.expiry)} · strike{" "}
              <span className="tnum text-fg-mute">{formatScaled(current.threshold, asset.decimals)}</span>
              {trading && (
                <>
                  {" "}
                  · closes in <span className="tnum text-fg-mute">{timeLeft(left)}</span>
                </>
              )}
            </>
          ) : snap && now ? (
            // The agent opens a round only while at least 2 minutes of trading remain.
            now - Math.floor(now / D.roundSecs) * D.roundSecs < D.roundSecs - 120 ? (
              <>Waiting for the agent to open the {roundLabel(nextBoundary(now) - D.roundSecs, nextBoundary(now))} round…</>
            ) : (
              <>No round this period. The next one opens at {clockUtc(nextBoundary(now))} UTC.</>
            )
          ) : (
            "Reading the current round…"
          )}
        </div>
        <div className="sm:text-right">
          {delta && current ? (
            <span className={delta.dir === "above" ? "text-up" : delta.dir === "below" ? "text-down" : "text-fg-mute"}>
              {delta.dir === "at"
                ? "live · at the strike (a tie is Down)"
                : `live ${delta.dir === "above" ? "▲" : "▼"} ${formatScaled(delta.diff < 0n ? -delta.diff : delta.diff, asset.decimals)} ${delta.dir} strike (${delta.pct >= 0 ? "+" : ""}${delta.pct.toFixed(3)}%)`}
            </span>
          ) : (
            "live · Coinbase"
          )}
        </div>
      </div>

      {current && st && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-2xs">
            <span className="text-up">Up {upPct.toFixed(0)}%</span>
            <span className="text-fg-dim">pool odds</span>
            <span className="text-down">{(100 - upPct).toFixed(0)}% Down</span>
          </div>
          <div className="flex h-2 w-full overflow-hidden bg-down">
            <div className="h-full bg-up transition-[width] duration-500" style={{ width: `${upPct}%` }} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {trading ? (
              <>
                <SideButton
                  label={`Buy Up · ${cents(st.yesPrice)}`}
                  tone="up"
                  active={Boolean(isOpen && open?.mode === "buy" && open.side === "yes")}
                  onClick={() => setOpen(isOpen && open?.mode === "buy" && open.side === "yes" ? undefined : { id: current.marketId, side: "yes", mode: "buy" })}
                />
                <SideButton
                  label={`Buy Down · ${cents(st.noPrice)}`}
                  tone="down"
                  active={Boolean(isOpen && open?.mode === "buy" && open.side === "no")}
                  onClick={() => setOpen(isOpen && open?.mode === "buy" && open.side === "no" ? undefined : { id: current.marketId, side: "no", mode: "buy" })}
                />
                {hold && (hold.yes > 0n || hold.no > 0n) && (
                  <button
                    onClick={() => setOpen(isOpen && open?.mode === "sell" ? undefined : { id: current.marketId, side: hold.yes > 0n ? "yes" : "no", mode: "sell" })}
                    className={`border px-3 py-1.5 text-[13px] transition-colors ${isOpen && open?.mode === "sell" ? "border-accent text-accent" : "border-line text-fg-mute hover:border-accent hover:text-fg"}`}
                  >
                    Sell
                  </button>
                )}
              </>
            ) : (
              <span className="text-2xs text-fg-dim">Trading closed at {clockUtc(current.expiry)} UTC.</span>
            )}
            {hold && (hold.yes > 0n || hold.no > 0n) && (
              <span className="tnum ml-auto text-2xs text-fg-dim">
                You hold {fmt(hold.yes)} Up · {fmt(hold.no)} Down
              </span>
            )}
          </div>

          {isOpen && trading && (
            <TradeBox
              market={current}
              st={st}
              hold={hold ?? { yes: 0n, no: 0n }}
              ledgerBal={snap?.ledgerBal ?? 0n}
              feeBps={snap?.feeBps}
              labels={["Up", "Down"]}
              open={open!}
              setOpen={setOpen}
              tx={tx}
              canTrade={canTrade}
              windowSecs={ROUND_TRADE_WINDOW_SECS}
            />
          )}
        </div>
      )}

      <RecentStrip asset={asset} recent={recent} snap={snap} now={now} />
    </article>
  );
}

function SideButton({ label, tone, active, onClick }: { label: string; tone: "up" | "down"; active: boolean; onClick: () => void }) {
  const on = tone === "up" ? "bg-up text-bg-elev border-up" : "bg-down text-bg-elev border-down";
  const off = tone === "up" ? "border-up text-up hover:bg-bg" : "border-down text-down hover:bg-bg";
  return (
    <button onClick={onClick} aria-pressed={active} className={`tnum border px-3 py-1.5 text-[13px] transition-colors ${active ? on : off}`}>
      {label}
    </button>
  );
}

// ───────────────────────────── trade box ─────────────────────────────

function TradeBox({
  market,
  st,
  hold,
  ledgerBal,
  feeBps,
  labels,
  open,
  setOpen,
  tx,
  canTrade,
  windowSecs,
}: {
  market: RoundMarket;
  st: MarketState;
  hold: Holding;
  ledgerBal: bigint;
  feeBps?: bigint;
  labels: [string, string];
  open: NonNullable<OpenTrade>;
  setOpen: (o: OpenTrade) => void;
  tx: Tx;
  canTrade: boolean;
  windowSecs: bigint;
}) {
  const [amt, setAmt] = useState("");
  const [slip, setSlip] = useState<bigint>(100n);
  const scope = `trade:${market.marketId}`;
  const outcome = open.side === "yes" ? OUTCOME.Yes : OUTCOME.No;
  const label = open.side === "yes" ? labels[0] : labels[1];
  const held = open.side === "yes" ? hold.yes : hold.no;
  const parsed = amt.trim() ? parseUsdcInput(amt, { label: open.mode === "buy" ? "amount" : "number of shares" }) : undefined;
  const value = parsed?.ok ? parsed.value : undefined;
  const buyQ = open.mode === "buy" && value && feeBps !== undefined ? quoteBuy(st, outcome, value, feeBps) : null;
  const sellQ = open.mode === "sell" && value && value <= held && feeBps !== undefined ? quoteSell(st, outcome, value, feeBps) : null;
  const floor = buyQ ? minOutWithSlippage(buyQ.sharesOut, slip) : sellQ ? minOutWithSlippage(sellQ.collateralOut, slip) : undefined;
  const busy = Boolean(tx.st.pending);
  const fail = (error: string) => tx.setSt({ pending: "", scope, error });

  async function submit() {
    if (!canTrade) return fail("Connect a wallet on Arc testnet first.");
    if (!parsed) return fail(open.mode === "buy" ? "Enter an amount in USDC." : "Enter how many shares to sell.");
    if (!parsed.ok) return fail(parsed.error);
    const v = parsed.value;
    if (open.mode === "buy" && v > ledgerBal) return fail("That is more than your trading balance. Deposit first (above).");
    if (open.mode === "sell" && v > held) return fail(`You hold ${fmt(held)} ${label} shares.`);
    const verb = open.mode === "buy" ? `Bought ${label}` : `Sold ${label}`;
    const ok = await tx.run(
      scope,
      open.mode,
      async () => {
        // The contract's own quote at click time sets the floor; the page's
        // mirror is only the preview.
        const client = tx.client;
        const block = await client.getBlock({ blockTag: "latest" });
        if (block.timestamp >= BigInt(market.expiry)) throw new Error("Trading on this round has closed.");
        const deadline = roundTradeDeadline(block.timestamp, BigInt(market.expiry), windowSecs);
        if (open.mode === "buy") {
          const [out] = (await client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "quoteBuy", args: [market.marketId, outcome, v] })) as readonly [bigint, bigint];
          if (out === 0n) throw new Error("That amount is too small to buy any shares.");
          await tx.ensureSpender(v);
          return tx.send(C.MarketsV4, marketsV4Abi, "buy", [market.marketId, outcome, v, minOutWithSlippage(out, slip), deadline]);
        }
        const [out] = (await client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "quoteSell", args: [market.marketId, outcome, v] })) as readonly [bigint, bigint];
        if (out === 0n) throw new Error("That is too few shares to sell.");
        return tx.send(C.MarketsV4, marketsV4Abi, "sell", [market.marketId, outcome, v, minOutWithSlippage(out, slip), deadline]);
      },
      `${verb}.`,
    );
    if (ok) setAmt("");
  }

  const presets = open.mode === "buy" ? ["1", "5", "10"] : [];
  return (
    <div className="mt-3 border border-line bg-bg p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-2xs">
        <div className="inline-flex border border-line" role="group" aria-label="Buy or sell">
          {(["buy", "sell"] as const).map((m) => (
            <button
              key={m}
              aria-pressed={open.mode === m}
              onClick={() => setOpen({ ...open, mode: m })}
              className={`px-3 py-1 ${open.mode === m ? "bg-fg text-bg" : "text-fg-dim hover:text-fg"}`}
            >
              {m === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>
        <div className="inline-flex border border-line" role="group" aria-label="Side">
          {(["yes", "no"] as const).map((s) => (
            <button
              key={s}
              aria-pressed={open.side === s}
              onClick={() => setOpen({ ...open, side: s })}
              className={`px-3 py-1 ${open.side === s ? (s === "yes" ? "bg-up text-bg-elev" : "bg-down text-bg-elev") : "text-fg-dim hover:text-fg"}`}
            >
              {s === "yes" ? labels[0] : labels[1]}
            </button>
          ))}
        </div>
        <span className="ml-auto text-fg-dim">
          {open.mode === "buy" ? (
            <>Trading balance <span className="tnum text-fg-mute">{fmt(ledgerBal)} USDC</span></>
          ) : (
            <>You hold <span className="tnum text-fg-mute">{fmt(held, 4)} {label}</span></>
          )}
        </span>
      </div>

      <div className="flex items-stretch gap-2">
        <div className="flex flex-1 items-center border border-line bg-bg-elev px-3 focus-within:border-accent">
          <input
            value={amt}
            onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            placeholder="0.00"
            aria-label={open.mode === "buy" ? "USDC to spend" : `${label} shares to sell`}
            className="tnum w-full bg-transparent py-2 font-serif text-[22px] outline-none"
          />
          <span className="text-2xs text-fg-dim">{open.mode === "buy" ? "USDC" : "shares"}</span>
        </div>
        {presets.map((p) => (
          <button key={p} onClick={() => setAmt(p)} className="tnum border border-line px-3 text-[13px] text-fg-mute hover:border-line-strong hover:text-fg">
            {p}
          </button>
        ))}
        {open.mode === "sell" && (
          <button onClick={() => setAmt(formatUsdc(held, 6))} disabled={held === 0n} className="border border-line px-3 text-[13px] text-fg-mute hover:border-line-strong hover:text-fg disabled:opacity-40">
            All
          </button>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs text-fg-dim sm:grid-cols-4">
        <div>
          <dt>You get about</dt>
          <dd className="tnum text-[13px] text-fg">
            {buyQ ? `${fmt(buyQ.sharesOut, 4)} ${label}` : sellQ ? `${fmt(sellQ.collateralOut, 4)} USDC` : "—"}
          </dd>
        </div>
        <div>
          <dt>{open.mode === "buy" ? `Pays if ${label}` : "Avg price"}</dt>
          <dd className="tnum text-[13px] text-fg">
            {buyQ ? `${fmt(buyQ.sharesOut, 2)} USDC` : sellQ ? `${(sellQ.avgPrice * 100).toFixed(1)}¢` : "—"}
          </dd>
        </div>
        <div>
          <dt>Fee</dt>
          <dd className="tnum text-[13px] text-fg-mute">{buyQ ? `${fmt(buyQ.fee, 4)} USDC` : sellQ ? `${fmt(sellQ.fee, 4)} USDC` : "—"}</dd>
        </div>
        <div>
          <dt>Minimum accepted</dt>
          <dd className="tnum text-[13px] text-fg-mute">
            {floor !== undefined ? `${fmt(floor, 4)} ${open.mode === "buy" ? label : "USDC"}` : "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 text-2xs text-fg-dim" role="group" aria-label="Slippage tolerance">
          Slippage
          {SLIPPAGES.map((s) => (
            <button
              key={String(s)}
              aria-pressed={slip === s}
              onClick={() => setSlip(s)}
              className={`tnum border px-1.5 py-0.5 ${slip === s ? "border-accent text-accent" : "border-line hover:text-fg"}`}
            >
              {Number(s) / 100}%
            </button>
          ))}
        </div>
        <span className="text-2xs text-fg-dim">
          {windowSecs === ROUND_TRADE_WINDOW_SECS
            ? "Fills within 2 minutes and before the close, or not at all."
            : `Fills within ${Number(windowSecs) / 60} minutes, or not at all.`}
        </span>
        <button
          onClick={submit}
          disabled={busy || !canTrade}
          className={`ml-auto px-5 py-2 text-[13px] text-bg-elev transition-opacity disabled:opacity-40 ${open.side === "yes" ? "bg-up" : "bg-down"}`}
        >
          {tx.st.pending === open.mode && tx.st.scope === scope
            ? open.mode === "buy"
              ? "Buying…"
              : "Selling…"
            : open.mode === "buy"
              ? `Buy ${label}${value ? ` for ${fmt(value)} USDC` : ""}`
              : `Sell ${label}`}
        </button>
      </div>
      {!canTrade && <p className="mt-2 text-2xs text-fg-dim">Connect a wallet on Arc testnet to trade.</p>}
      <TxLine tx={tx} scope={scope} />
    </div>
  );
}

// ───────────────────────────── recent rounds ─────────────────────────────

function statusFor(m: RoundMarket, snap: Snapshot | undefined, now: number): RoundStatus | undefined {
  const st = snap?.state[m.marketId];
  if (!st) return undefined;
  return roundStatus({
    phase: st.phase,
    yesWon: st.yesWon,
    expiry: m.expiry,
    now,
    reading: snap?.readings[m.marketId],
    disputeWindow: snap?.book.byId[m.feedId]?.disputeWindow ?? 600,
    threshold: m.threshold,
    comparator: m.comparator,
  });
}

function RecentStrip({ asset, recent, snap, now }: { asset: AssetMeta; recent: RoundMarket[]; snap?: Snapshot; now: number }) {
  if (!snap) return null;
  const cells = [...recent].reverse(); // oldest → newest, ending at now
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-1.5 text-2xs text-fg-dim">Last rounds</div>
      {cells.length === 0 ? (
        <p className="text-2xs text-fg-dim">No closed rounds in the last two hours yet.</p>
      ) : (
        <ol className="grid grid-cols-3 gap-1 sm:grid-cols-6">
          {cells.map((m) => {
            const s = statusFor(m, snap, now);
            const rd = snap.readings[m.marketId];
            const settleVal = rd?.found ? formatScaled(rd.value, asset.decimals) : undefined;
            const title = [
              roundLabel(roundStart(m.expiry), m.expiry),
              `strike ${formatScaled(m.threshold, asset.decimals)}${settleVal ? ` → close ${settleVal}` : ""}`,
              s?.detail,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={m.marketId} className="border border-line px-2 py-1.5" title={title}>
                <div className="tnum text-2xs text-fg-dim">{clockUtc(roundStart(m.expiry))}</div>
                <StatusCell s={s} now={now} />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function StatusCell({ s, now }: { s?: RoundStatus; now: number }) {
  if (!s) return <div className="text-[13px] text-fg-dim">…</div>;
  switch (s.key) {
    case "resolved-up":
      return <div className="text-[13px] text-up">▲ Up</div>;
    case "resolved-down":
      return <div className="text-[13px] text-down">▼ Down</div>;
    case "voided":
      return <div className="text-[13px] text-fg-dim line-through">Voided</div>;
    case "awaiting-reading":
      return <div className="text-[13px] text-fg-dim">{s.voidable ? "No reading" : "Closed…"}</div>;
    case "settling":
      return (
        <div className={`tnum text-[13px] ${s.provisional === "up" ? "text-up" : "text-down"}`}>
          {s.provisional === "up" ? "▲" : "▼"}{" "}
          {s.final || (s.finalAt ?? 0) <= now ? <span className="text-fg-mute">final</span> : <span className="text-accent">{timeLeft((s.finalAt ?? 0) - now)}</span>}
        </div>
      );
    default:
      return <div className="text-[13px] text-accent">Live</div>;
  }
}

// ───────────────────────────── claims ─────────────────────────────

function Claims({ snap, tx, now }: { snap?: Snapshot; tx: Tx; now: number }) {
  if (!snap) return null;
  const known = snap.markets.filter((m) => snap.redeemable[m.marketId] !== undefined);
  const claims = claimList(known, snap.redeemable);
  const assetOf = (key: string) => D.assets.find((a) => a.key === key);
  const eventOf = (key: string) => D.events.find((e) => e.key === key);
  return (
    <section className="mt-10" aria-labelledby="claims-h">
      <h2 id="claims-h" className="mb-3 font-serif text-[24px] leading-none">
        Your claims
      </h2>
      {claims.length === 0 ? (
        <p className="border border-line bg-bg-elev px-4 py-3 text-[13px] text-fg-dim">
          Nothing to redeem. Winning shares from settled rounds you traded in the last two hours show up here, and pay
          into your trading balance.
        </p>
      ) : (
        <ul className="border border-line bg-bg-elev">
          {claims.map(({ market: m, amount }) => {
            const a = assetOf(m.key);
            const ev = eventOf(m.key);
            const s = statusFor(m, snap, now);
            const scope = `claim:${m.marketId}`;
            return (
              <li key={m.marketId} className="border-b border-line px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px]">{a ? `${a.symbol} · ${roundLabel(roundStart(m.expiry), m.expiry)}` : ev?.question ?? m.key}</div>
                    <div className="text-2xs text-fg-dim">
                      {s?.key === "voided" ? "Voided: your net cost comes back." : s?.key === "resolved-up" ? (a ? "Closed Up." : "Resolved Yes.") : a ? "Closed Down." : "Resolved No."}
                    </div>
                  </div>
                  <button
                    disabled={Boolean(tx.st.pending)}
                    onClick={() => void tx.run(scope, "redeem", () => tx.send(C.MarketsV4, marketsV4Abi, "redeem", [m.marketId]), `Redeemed ${fmt(amount)} USDC.`)}
                    className="tnum bg-accent px-4 py-2 text-[13px] text-bg transition-colors hover:bg-accent-deep disabled:opacity-50"
                  >
                    {tx.st.pending === "redeem" && tx.st.scope === scope ? "Redeeming…" : `Redeem ${fmt(amount)} USDC`}
                  </button>
                </div>
                <TxLine tx={tx} scope={scope} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ───────────────────────────── events ─────────────────────────────

function EventMarkets({
  snap,
  now,
  open,
  setOpen,
  tx,
  canTrade,
  address,
}: {
  snap?: Snapshot;
  now: number;
  open: OpenTrade;
  setOpen: (o: OpenTrade) => void;
  tx: Tx;
  canTrade: boolean;
  address?: Address;
}) {
  const visible = D.events.filter((e) => {
    const id = snap?.eventMarkets[e.key];
    const st = id ? snap?.state[id] : undefined;
    return eventVisible(e, st?.phase, e.expiry, now || e.expiry);
  });
  return (
    <section className="mt-12" aria-labelledby="events-h">
      <h2 id="events-h" className="font-serif text-[30px] leading-none tracking-tightest">
        Event markets
      </h2>
      <p className="mb-4 mt-2 max-w-[60ch] text-[13px] text-fg-mute">
        Longer questions on a curated feed. The team records the outcome with evidence when it happens; the market
        settles on the feed&apos;s reading at the deadline.
      </p>
      <div className="space-y-px">
        {visible.map((e) => (
          <EventCard key={e.key} ev={e} snap={snap} now={now} open={open} setOpen={setOpen} tx={tx} canTrade={canTrade} address={address} />
        ))}
      </div>
    </section>
  );
}

function EventCard({
  ev,
  snap,
  now,
  open,
  setOpen,
  tx,
  canTrade,
  address,
}: {
  ev: EventMeta;
  snap?: Snapshot;
  now: number;
  open: OpenTrade;
  setOpen: (o: OpenTrade) => void;
  tx: Tx;
  canTrade: boolean;
  address?: Address;
}) {
  const id = snap?.eventMarkets[ev.key];
  const st = id ? snap?.state[id] : undefined;
  const feed = snap?.book.byKey[ev.key];
  const market: RoundMarket | undefined =
    id && feed && st
      ? snap?.markets.find((m) => m.marketId === id) ?? {
          marketId: id,
          feedId: feed.feedId,
          key: ev.key,
          agent: D.agent,
          threshold: st.threshold,
          comparator: 1,
          expiry: st.expiry,
          liquidity: 0n,
          blockNumber: 0n,
        }
      : undefined;
  const reading = snap?.eventReadings[ev.key];
  const expiry = st?.expiry ?? ev.expiry;
  const trading = Boolean(st && st.phase === PHASE.Trading && now && now < expiry);
  const yesPct = st ? impliedPct(st.yesPrice) : 50;
  const hold = id ? snap?.holdings[id] : undefined;
  const isOpen = Boolean(id && open?.id === id);
  const status = market ? statusFor(market, snap, now) : undefined;
  const redeemable = id ? snap?.redeemable[id] ?? 0n : 0n;
  const scope = `event:${id}`;

  const result =
    st?.phase === PHASE.Resolved
      ? st.yesWon
        ? "Resolved Yes."
        : "Resolved No."
      : st?.phase === PHASE.Voided
        ? "Voided: every trader gets their net cost back."
        : status?.key === "settling"
          ? status.final
            ? `The deadline reading is final (${status.provisional === "up" ? "Yes" : "No"}); resolving next.`
            : `Deadline reading says ${status.provisional === "up" ? "Yes" : "No"}; final in ${timeLeft((status.finalAt ?? 0) - now)}.`
          : status?.key === "awaiting-reading"
            ? "Past the deadline, waiting for the agent's reading."
            : undefined;

  return (
    <article className="border border-line bg-bg-elev p-4 sm:p-5">
      {ev.rehearsal && <div className="mb-2 text-2xs text-accent">Testnet rehearsal of the settlement flow, short-dated.</div>}
      <h3 className="max-w-[40ch] font-serif text-[22px] leading-snug">{ev.question}</h3>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-2xs text-fg-dim sm:grid-cols-3">
        <div>
          <dt>Deadline</dt>
          <dd className="tnum text-[13px] text-fg-mute">
            {utcStamp(expiry)}
            {now && now < expiry ? <span className="text-fg-dim"> · {timeLeft(expiry - now)} left</span> : null}
          </dd>
        </div>
        <div>
          <dt>Feed reading</dt>
          <dd className="tnum text-[13px] text-fg-mute">
            {reading ? (
              <>
                {reading.value.toString()} {reading.value > 0n ? "(happened)" : "(not yet)"}
                {reading.timestamp > 0 && <span className="text-fg-dim"> · updated {utcStamp(reading.timestamp)}</span>}
              </>
            ) : (
              "…"
            )}
          </dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd className="text-[13px] text-fg-mute">
            {evidenceNote(reading?.value, ev.evidenceUrl)}{" "}
            {reading && reading.value > 0n && ev.evidenceUrl && (
              <a href={ev.evidenceUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                source ↗
              </a>
            )}
          </dd>
        </div>
      </dl>

      {!id && snap && <p className="mt-3 text-2xs text-fg-dim">This market has not been opened yet.</p>}

      {st && market && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-2xs">
            <span className="text-up">Yes {yesPct.toFixed(0)}%</span>
            <span className="text-down">{(100 - yesPct).toFixed(0)}% No</span>
          </div>
          <div className="flex h-2 w-full overflow-hidden bg-down">
            <div className="h-full bg-up transition-[width] duration-500" style={{ width: `${yesPct}%` }} />
          </div>

          {trading ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SideButton
                label={`Buy Yes · ${cents(st.yesPrice)}`}
                tone="up"
                active={isOpen && open?.mode === "buy" && open.side === "yes"}
                onClick={() => setOpen(isOpen && open?.mode === "buy" && open.side === "yes" ? undefined : { id: market.marketId, side: "yes", mode: "buy" })}
              />
              <SideButton
                label={`Buy No · ${cents(st.noPrice)}`}
                tone="down"
                active={isOpen && open?.mode === "buy" && open.side === "no"}
                onClick={() => setOpen(isOpen && open?.mode === "buy" && open.side === "no" ? undefined : { id: market.marketId, side: "no", mode: "buy" })}
              />
              {hold && (hold.yes > 0n || hold.no > 0n) && (
                <>
                  <button
                    onClick={() => setOpen(isOpen && open?.mode === "sell" ? undefined : { id: market.marketId, side: hold.yes > 0n ? "yes" : "no", mode: "sell" })}
                    className={`border px-3 py-1.5 text-[13px] transition-colors ${isOpen && open?.mode === "sell" ? "border-accent text-accent" : "border-line text-fg-mute hover:border-accent hover:text-fg"}`}
                  >
                    Sell
                  </button>
                  <span className="tnum ml-auto text-2xs text-fg-dim">
                    You hold {fmt(hold.yes)} Yes · {fmt(hold.no)} No
                  </span>
                </>
              )}
            </div>
          ) : (
            result && <p className="mt-3 text-[13px] text-fg-mute">{result}</p>
          )}

          {isOpen && trading && (
            <TradeBox
              market={market}
              st={st}
              hold={hold ?? { yes: 0n, no: 0n }}
              ledgerBal={snap?.ledgerBal ?? 0n}
              feeBps={snap?.feeBps}
              labels={["Yes", "No"]}
              open={open!}
              setOpen={setOpen}
              tx={tx}
              canTrade={canTrade}
              windowSecs={TRADE_DEADLINE_SECS}
            />
          )}

          {settled(st.phase) && address && (
            <div className="mt-3">
              <button
                disabled={Boolean(tx.st.pending) || redeemable === 0n}
                onClick={() => void tx.run(scope, "redeem", () => tx.send(C.MarketsV4, marketsV4Abi, "redeem", [market.marketId]), `Redeemed ${fmt(redeemable)} USDC.`)}
                className="tnum w-full bg-accent py-2 text-[13px] text-bg transition-colors hover:bg-accent-deep disabled:opacity-50"
              >
                {redeemable === 0n ? "Nothing to redeem" : tx.st.pending === "redeem" && tx.st.scope === scope ? "Redeeming…" : `Redeem ${fmt(redeemable)} USDC`}
              </button>
              <TxLine tx={tx} scope={scope} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

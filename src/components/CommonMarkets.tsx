"use client";

/**
 * Common markets: Registrai's 5-minute Up/Down rounds and event markets.
 *
 * "Bet now on the next 5 minutes": every asset shares one round clock
 * (wall-clock 5-minute boundaries). At each boundary the agent opens the NEXT
 * round, and betting on it closes as it starts, so nobody trades a round whose
 * move is already on the chart. The page leads with that clock (time left to
 * bet); each card shows the round taking bets, the round in play (its move
 * since it started), and a strip of how the last rounds settled.
 *
 * Reads are pinned to Arc testnet through the official RPC (batched); writes go
 * through the connected wallet on that chain. Collateral lives on NanoLedger:
 * deposit once, then buys pull from the ledger balance (exact-amount spender
 * approvals, never unlimited). Live prices are Coinbase's public ticker, shown
 * for reference only: a round settles on the agent's on-chain reading.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createPublicClient,
  createWalletClient,
  custom,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
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
  BLOCK_SECS,
  ROUNDS,
  ROUND_TRADE_WINDOW_SECS,
  candleCloseAt,
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
  parseMarketLogs,
  roundLabel,
  roundStatus,
  roundWindow,
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
  assetHref,
  eventHref,
  formatChange,
  type AssetRounds,
} from "@/lib/rounds";
import { cashOutValue, pnl, poolPrices, replayPool, type Trade } from "@/lib/rounds-chart";
import { OddsChart, PriceChart, usePriceStream, type PriceStream } from "./RoundCharts";
import { ROUNDS_TABS, parseRoundsTab, type RoundsTab } from "@/lib/perennial-view";
import {
  SESSION_CAP,
  SESSION_GAS,
  SESSION_SECS,
  clearSession,
  loadSession,
  saveSession,
  sessionCovers,
  sessionStatus,
  type LocalSession,
  type SessionChain,
  type SessionStatus,
} from "@/lib/session";

// ───────────────────────────── chain wiring ─────────────────────────────

const D = ROUNDS;
const C = D.contracts;
const CHAIN = getWalletChain(D.chainId) as WalletChain;
const HUMAN = { testnet: ROUNDS.testnet, networkName: ROUNDS.label };
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
const SOLD = parseAbiItem(
  "event Sold(bytes32 indexed marketId, address indexed seller, uint8 outcome, uint256 sharesIn, uint256 collateralOut, uint256 fee)",
);

const SLIPPAGES = [50n, 100n, 200n] as const; // bps
/** First paint scans only this many recent blocks (~11 min on Arc): enough for
 *  the round taking bets and the one in play. */
const FIRST_PAINT_BLOCKS = 1_200n;
/** Trading pauses when the newest chain read is older than this. */
const STALE_SECS = 20;
/** Multicall3 at its canonical address (deployed on Arc testnet and mainnet). */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;
const fmt = (v: bigint, dp = 2) => formatUsdc(v, dp);
const cents = (p: bigint) => `${Math.round(impliedPct(p))}¢`;

type MarketState = {
  phase: number;
  yesWon: boolean;
  threshold: bigint;
  comparator: number;
  expiry: number;
  yesReserve: bigint;
  noReserve: bigint;
  yesPrice: bigint;
  noPrice: bigint;
};
/** Shares held, and the net cost the contract records (what a void refunds). */
type Holding = { yes: bigint; no: bigint; cost: bigint };
type EventReading = { value: bigint; timestamp: number };

type Snapshot = {
  /** Chain time at the read, and the client clock it was read at. */
  chainNow: number;
  readAt: number;
  head: bigint;
  markets: RoundMarket[];
  /** Bought / Sold logs of the rounds taking bets and in play (for the odds chart). */
  trades: Record<string, Trade[]>;
  book: FeedBook;
  state: Record<string, MarketState>;
  readings: Record<string, Reading>;
  holdings: Record<string, Holding>;
  redeemable: Record<string, bigint>;
  /** The wallet's markets that anyone may settle right now (the agent is late or down). */
  settleable: Record<string, "resolve" | "void">;
  eventReadings: Record<string, EventReading>;
  /** Event key -> its market id (discovered, else the deploy seed). */
  eventMarkets: Record<string, Hex>;
  ledgerBal?: bigint;
  walletBal?: bigint;
  feeBps?: bigint;
};

const settled = (phase: number | undefined) => phase === PHASE.Resolved || phase === PHASE.Voided;

// The markets this browser's wallet traded, remembered locally: the log scan only
// looks back ~2 hours, and a position must not vanish from "Your claims" after that.
const mineKey = (a: Address) => `registrai.rounds.mine.${D.chainId}.${a.toLowerCase()}`;
function loadMine(a: Address): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(mineKey(a)) || "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^0x[0-9a-f]{64}$/.test(x)).slice(-300) : [];
  } catch {
    return [];
  }
}
function saveMine(a: Address, ids: Set<string>) {
  try {
    localStorage.setItem(mineKey(a), JSON.stringify([...ids].slice(-300)));
  } catch {
    /* private mode: the 2-hour scan still covers recent trades */
  }
}

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
    /** Trade logs per tracked market, and how far each was scanned. */
    trades: new Map<string, Map<string, Trade>>(),
    tradeCursor: new Map<string, bigint>(),
  });
  const busy = useRef(false);
  const again = useRef(false);

  // First paint: before the full read (two hours of logs, readings, holdings,
  // claims: several round trips), show the rounds people can act on now. One
  // log query over the last few minutes on the known feeds finds the round
  // taking bets and the one in play; one batched read gets their pools. The
  // full refresh replaces this snapshot when it lands.
  const painted = useRef(false);
  useEffect(() => {
    if (painted.current) return;
    painted.current = true;
    let alive = true;
    const d = disc.current;
    void (async () => {
      try {
        const block = await client.getBlock({ blockTag: "latest" });
        const head = block.number;
        const chainNow = Number(block.timestamp);
        const logs = await client.getLogs({
          address: C.MarketsV4,
          event: MARKET_CREATED,
          args: { feedId: Object.keys(d.book.byId) as Hex[] },
          fromBlock: head > FIRST_PAINT_BLOCKS ? head - FIRST_PAINT_BLOCKS : 0n,
          toBlock: head,
        });
        const markets = parseMarketLogs(logs as unknown as MarketCreatedLog[], d.book, D.agent);
        const groups = groupRounds(markets, D.assets.map((a) => a.key), chainNow);
        const want = Object.values(groups).flatMap((g) => [g.current, g.inPlay].filter((m): m is RoundMarket => Boolean(m)));
        const rows = await Promise.all(
          want.map(async (m): Promise<[string, MarketState]> => {
            const [mk, yp, np] = await Promise.all([
              client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "getMarket", args: [m.marketId] }) as Promise<{
                threshold: bigint; comparator: number; expiry: bigint; yesReserve: bigint; noReserve: bigint; phase: number; yesWon: boolean;
              }>,
              client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "priceOf", args: [m.marketId, OUTCOME.Yes] }) as Promise<bigint>,
              client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "priceOf", args: [m.marketId, OUTCOME.No] }) as Promise<bigint>,
            ]);
            return [m.marketId, { phase: Number(mk.phase), yesWon: mk.yesWon, threshold: mk.threshold, comparator: Number(mk.comparator), expiry: Number(mk.expiry), yesReserve: mk.yesReserve, noReserve: mk.noReserve, yesPrice: yp, noPrice: np }];
          }),
        );
        if (!alive) return;
        const eventMarkets: Record<string, Hex> = {};
        for (const e of D.events) if (e.marketId) eventMarkets[e.key] = e.marketId.toLowerCase() as Hex;
        setSnap((prev) =>
          prev ?? {
            chainNow, readAt: Date.now() / 1000, head, markets, trades: {}, book: d.book, state: Object.fromEntries(rows),
            readings: {}, holdings: {}, redeemable: {}, settleable: {}, eventReadings: {}, eventMarkets,
          },
        );
      } catch {
        /* the full refresh follows anyway */
      }
    })();
    return () => {
      alive = false;
    };
  }, [client]);

  const refresh = useCallback(async () => {
    if (busy.current) {
      again.current = true; // e.g. right after a trade: run once more when this one ends
      return;
    }
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
        d.mine = new Set(address ? loadMine(address) : []);
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
          saveMine(address, d.mine);
        }
        // Markets remembered from earlier visits (older than the scan): describe
        // them from the chain, on the agent's known feeds only.
        const older = [...d.mine].filter((id) => !d.markets.has(id));
        if (older.length) {
          const rows = await Promise.all(
            older.map((id) =>
              (client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "getMarket", args: [id as Hex] }) as Promise<{
                feedId: Hex; agent: Address; threshold: bigint; comparator: number; expiry: bigint;
              }>).catch(() => undefined),
            ),
          );
          older.forEach((id, i) => {
            const m = rows[i];
            const feed = m && d.book.byId[m.feedId.toLowerCase()];
            if (!m || !feed || m.agent.toLowerCase() !== D.agent.toLowerCase()) return;
            d.markets.set(id, {
              marketId: id as Hex, feedId: feed.feedId, key: feed.asset, change: feed.change, agent: m.agent,
              threshold: m.threshold, comparator: Number(m.comparator), expiry: Number(m.expiry), liquidity: 0n, blockNumber: 0n,
            });
          });
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
      const current = Object.values(groups).flatMap((g) => [g.current?.marketId, g.inPlay?.marketId].filter((x): x is Hex => Boolean(x)));
      const recent = Object.values(groups).flatMap((g) => g.recent);
      const eventIds = Object.values(eventMarkets);
      const mine = [...d.mine];
      const toRead = [...new Set([...current, ...recent.map((m) => m.marketId), ...eventIds, ...mine])].filter((id) => !d.final.has(id));

      // 3b. Trades on the rounds taking bets and in play: the odds chart replays
      //     the pool from them. Each market is scanned from its creation block.
      const tracked = Object.values(groups).flatMap((g) => [g.current, g.inPlay].filter((m): m is RoundMarket => Boolean(m)));
      for (const id of [...d.trades.keys()]) if (!tracked.some((m) => m.marketId === id)) {
        d.trades.delete(id);
        d.tradeCursor.delete(id);
      }
      for (const m of tracked) {
        if (!d.trades.has(m.marketId)) d.trades.set(m.marketId, new Map());
        if (!d.tradeCursor.has(m.marketId)) d.tradeCursor.set(m.marketId, m.blockNumber - 1n);
      }
      if (tracked.length) {
        const ids = tracked.map((m) => m.marketId);
        const tFrom = tracked.reduce((x, m) => (d.tradeCursor.get(m.marketId)! < x ? d.tradeCursor.get(m.marketId)! : x), head) + 1n;
        if (tFrom <= head) {
          const [bs, ss] = await Promise.all([
            scanLogs((a, b) => client.getLogs({ address: C.MarketsV4, event: BOUGHT, args: { marketId: ids }, fromBlock: a, toBlock: b }), tFrom, head),
            scanLogs((a, b) => client.getLogs({ address: C.MarketsV4, event: SOLD, args: { marketId: ids }, fromBlock: a, toBlock: b }), tFrom, head),
          ]);
          const put = (lg: { args: { marketId?: Hex; outcome?: number }; blockNumber: bigint | null; logIndex: number | null }, t: Omit<Trade, "block" | "logIndex" | "outcome">) => {
            const id = lg.args.marketId?.toLowerCase();
            const book = id ? d.trades.get(id) : undefined;
            if (!book || lg.blockNumber === null) return;
            book.set(`${lg.blockNumber}:${lg.logIndex}`, { ...t, block: lg.blockNumber, logIndex: lg.logIndex ?? 0, outcome: Number(lg.args.outcome ?? 0) });
          };
          for (const lg of bs.logs) put(lg, { kind: "buy", collateral: lg.args.collateralIn ?? 0n, shares: lg.args.sharesOut ?? 0n, fee: lg.args.fee ?? 0n });
          for (const lg of ss.logs) put(lg, { kind: "sell", collateral: lg.args.collateralOut ?? 0n, shares: lg.args.sharesIn ?? 0n, fee: lg.args.fee ?? 0n });
          const reached = bs.scannedTo < ss.scannedTo ? bs.scannedTo : ss.scannedTo;
          for (const id of ids) if (d.tradeCursor.get(id)! < reached) d.tradeCursor.set(id, reached);
        }
      }

      // 4. Reads (the batched transport coalesces them into a few requests).
      const readMarket = async (id: string): Promise<[string, MarketState]> => {
        const [m, yp, np] = await Promise.all([
          client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "getMarket", args: [id as Hex] }) as Promise<{
            threshold: bigint; comparator: number; expiry: bigint; yesReserve: bigint; noReserve: bigint; phase: number; yesWon: boolean;
          }>,
          client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "priceOf", args: [id as Hex, OUTCOME.Yes] }) as Promise<bigint>,
          client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "priceOf", args: [id as Hex, OUTCOME.No] }) as Promise<bigint>,
        ]);
        return [id, { phase: Number(m.phase), yesWon: m.yesWon, threshold: m.threshold, comparator: Number(m.comparator), expiry: Number(m.expiry), yesReserve: m.yesReserve, noReserve: m.noReserve, yesPrice: yp, noPrice: np }];
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
        const [yes, no, cost] = await Promise.all([
          client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "yesBalance", args: [id as Hex, address!] }) as Promise<bigint>,
          client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "noBalance", args: [id as Hex, address!] }) as Promise<bigint>,
          client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "netCost", args: [id as Hex, address!] }) as Promise<bigint>,
        ]);
        return [id, { yes, no, cost }];
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
      // The wallet's past-expiry markets still unsettled: can anyone settle them now?
      const unsettledMine = address
        ? mine.filter((id) => !settled(state[id]?.phase) && (d.markets.get(id)?.expiry ?? Infinity) <= chainNow)
        : [];
      const [readings, holdings, redeemable, settleStates] = await Promise.all([
        Promise.all(pendingRounds.map(readingFor)),
        Promise.all(holdIds.map(holdingFor)),
        Promise.all(
          claimIds.map(async (id): Promise<[string, bigint]> => [
            id,
            (await client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "redeemable", args: [id as Hex, address!] })) as bigint,
          ]),
        ),
        Promise.all(
          unsettledMine.map(async (id): Promise<[string, number]> => {
            try {
              const [st] = (await client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "settlementState", args: [id as Hex] })) as readonly [number, bigint];
              return [id, Number(st)];
            } catch {
              return [id, -1];
            }
          }),
        ),
      ]);
      // SettlementPolicy: 2 = Resolvable, 3 = Voidable
      const settleable: Record<string, "resolve" | "void"> = {};
      for (const [id, st] of settleStates) if (st === 2 || st === 3) settleable[id] = st === 2 ? "resolve" : "void";

      setSnap({
        chainNow,
        readAt: Date.now() / 1000,
        head,
        markets,
        trades: Object.fromEntries([...d.trades].map(([id, m]) => [id, [...m.values()]])),
        book: d.book,
        state,
        readings: Object.fromEntries(readings),
        holdings: Object.fromEntries(holdings),
        redeemable: Object.fromEntries(redeemable),
        settleable,
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
      if (again.current) {
        again.current = false;
        setTimeout(() => void refreshRef.current?.(), 0);
      }
    }
  }, [client, address]);
  const refreshRef = useRef<() => Promise<void>>(undefined);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  return { snap, loadError, refresh };
}

/**
 * The live lane: the pools people can trade right now (rounds taking bets, open
 * event markets), re-read every second in one batched request. Buttons, share
 * quotes, odds and position values follow every trade within about a second,
 * while the full refresh (discovery, readings, claims) keeps its slower pace.
 */
type LivePool = { yesReserve: bigint; noReserve: bigint; phase: number; at: number };
function useLivePools(client: PublicClient, ids: readonly Hex[], paused: boolean) {
  const [pools, setPools] = useState<Record<string, LivePool>>({});
  const key = ids.join(",");
  // While a wallet transaction is in flight, stay off the RPC: the wallet's own
  // gas-price / estimate / send calls share the user's IP and its rate limit.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    if (!ids.length) return;
    let alive = true;
    let busy = false;
    const read = async () => {
      if (busy || pausedRef.current || (typeof document !== "undefined" && document.hidden)) return;
      busy = true;
      try {
        // One eth_call for every pool, whatever their number.
        const rows = (await client.multicall({
          contracts: ids.map((id) => ({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "getMarket" as const, args: [id] as const })),
          allowFailure: false,
          multicallAddress: MULTICALL3,
        })) as unknown as Array<{ yesReserve: bigint; noReserve: bigint; phase: number }>;
        if (!alive) return;
        const at = Date.now() / 1000;
        setPools((prev) => {
          const next = { ...prev };
          ids.forEach((id, i) => {
            const m = rows[i];
            const old = prev[id];
            // Keep the object identity when nothing moved: no re-render for a quiet pool.
            if (old && old.yesReserve === m.yesReserve && old.noReserve === m.noReserve && old.phase === Number(m.phase)) {
              next[id] = { ...old, at };
            } else {
              next[id] = { yesReserve: m.yesReserve, noReserve: m.noReserve, phase: Number(m.phase), at };
            }
          });
          return next;
        });
      } catch {
        /* next second */
      } finally {
        busy = false;
      }
    };
    void read();
    const t = setInterval(() => void read(), 1_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);
  return pools;
}

/** The snapshot with the live lane's newer pool reads laid over it. */
function withLivePools(snap: Snapshot | undefined, pools: Record<string, LivePool>): Snapshot | undefined {
  if (!snap) return snap;
  let state: Record<string, MarketState> | undefined;
  for (const [id, p] of Object.entries(pools)) {
    const cur = snap.state[id];
    if (!cur || p.at <= snap.readAt) continue;
    if (cur.yesReserve === p.yesReserve && cur.noReserve === p.noReserve && cur.phase === p.phase) continue;
    state ??= { ...snap.state };
    state[id] = { ...cur, yesReserve: p.yesReserve, noReserve: p.noReserve, phase: p.phase, ...poolPrices({ yes: p.yesReserve, no: p.noReserve }) };
  }
  return state ? { ...snap, state } : snap;
}

/** The price each in-play round started at: Coinbase's 1-minute close ending at
 *  the round's start (what the agent reads), fetched once per round. */
function useStartPrices(rounds: Array<{ asset: AssetMeta; start: number }>) {
  const [got, setGot] = useState<Record<string, number>>({});
  const want = rounds.map((r) => `${r.asset.product}@${r.start}`).join(",");
  useEffect(() => {
    if (!want) return;
    let alive = true;
    const fetchMissing = async () => {
      for (const r of rounds) {
        const k = `${r.asset.product}@${r.start}`;
        if (got[k] !== undefined) continue;
        try {
          const iso = (t: number) => new Date(t * 1000).toISOString();
          const res = await fetch(
            `https://api.exchange.coinbase.com/products/${r.asset.product}/candles?granularity=60&start=${iso(r.start - 300)}&end=${iso(r.start)}`,
            { cache: "no-store" },
          );
          const close = candleCloseAt(await res.json(), r.start);
          if (alive && close !== undefined) setGot((prev) => ({ ...prev, [k]: close }));
        } catch {
          /* retried below */
        }
      }
    };
    void fetchMissing();
    const id = setInterval(() => void fetchMissing(), 5_000); // the minute is published a few seconds late
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, got]);
  return got;
}

// ───────────────────────────── transactions ─────────────────────────────

/** `oneClick`: sent from the session key, so no wallet confirmation is coming. */
type TxState = { pending: string; error?: string; hash?: Hex; done?: string; scope?: string; oneClick?: boolean };

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
    async (scope: string, label: string, steps: () => Promise<Hex>, doneText: string, oneClick = false) => {
      if (!wallet || !address) {
        setSt({ pending: "", scope, error: `Connect a wallet on ${D.label} first.` });
        return false;
      }
      setSt({ pending: label, scope, oneClick });
      try {
        const hash = await steps();
        setSt({ pending: label, scope, hash, oneClick });
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
    async (to: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[], value?: bigint) => {
      await client.simulateContract({ address: to, abi: abi as never, functionName: functionName as never, args: args as never, account: address!, value } as never);
      return wallet!.writeContract({ address: to, abi: abi as never, functionName: functionName as never, args: args as never, chain: CHAIN.viemChain, account: address!, value } as never);
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

// ───────────────────────────── one-click sessions ─────────────────────────────

/** The owner's session key for one-click betting (lib/session.ts): its stored key,
 *  its on-chain grant, the owner's ledger allowance, and a sender that trades
 *  through MarketsV4's *For functions without the wallet. */
function useSession(client: PublicClient, address: Address | undefined, tx: Tx) {
  const [local, setLocal] = useState<LocalSession>();
  const [chain, setChain] = useState<SessionChain>();
  const [allowance, setAllowance] = useState(0n);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    setLocal(address ? loadSession(D.chainId, address) : undefined);
    setChain(undefined);
  }, [address]);

  const read = useCallback(async () => {
    if (!address) return;
    try {
      const [allow, grant, gas, block] = await Promise.all([
        client.readContract({ address: C.NanoLedger, abi: nanoLedgerAbi, functionName: "allowance", args: [address, C.MarketsV4] }) as Promise<bigint>,
        local
          ? (client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: "sessions", args: [address, local.delegate] }) as Promise<readonly [bigint, bigint]>)
          : undefined,
        local ? client.getBalance({ address: local.delegate }) : undefined,
        client.getBlock({ blockTag: "latest" }),
      ]);
      setAllowance(allow);
      setClock(Number(block.timestamp));
      setChain(grant && gas !== undefined ? { spendLeft: grant[0], expiry: Number(grant[1]), gas } : undefined);
    } catch {
      /* next read */
    }
  }, [client, address, local]);
  useEffect(() => {
    void read();
    const id = setInterval(() => void read(), 5_000);
    return () => clearInterval(id);
  }, [read]);

  const wallet = useMemo(
    () => (local ? createWalletClient({ chain: CHAIN.viemChain, transport: transportFor(CHAIN), account: privateKeyToAccount(local.pk) }) : undefined),
    [local],
  );
  const status: SessionStatus = sessionStatus(local, chain, clock || Date.now() / 1000);
  const covers = (mode: "buy" | "sell" | "redeem", amount: bigint) => Boolean(wallet) && sessionCovers(status, chain, mode, amount, allowance);

  /** Send a MarketsV4 call from the session key (no wallet pop-up). */
  const send = useCallback(
    async (functionName: "buyFor" | "sellFor" | "redeemFor", args: readonly unknown[]) => {
      if (!wallet) throw new Error("No one-click session in this browser.");
      await client.simulateContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName, args: args as never, account: wallet.account });
      const hash = await wallet.writeContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName, args: args as never, chain: CHAIN.viemChain, account: wallet.account });
      setTimeout(() => void read(), 1_500);
      return hash;
    },
    [client, wallet, read],
  );

  /** Two wallet confirmations: the ledger allowance, then setSession (with gas for the key). */
  const enable = useCallback(async () => {
    if (!address) return;
    await tx.run(
      "session",
      "session",
      async () => {
        const block = await client.getBlock({ blockTag: "latest" });
        // Renewing keeps this browser's key (and whatever gas it still has).
        const pk = local?.pk ?? generatePrivateKey();
        const acct = privateKeyToAccount(pk);
        const s: LocalSession = { pk, delegate: acct.address, owner: address, chainId: D.chainId, expiry: Number(block.timestamp) + SESSION_SECS };
        saveSession(s); // before any transaction: gas sent to the key is never orphaned
        setLocal(s);
        if (allowance < SESSION_CAP) await tx.waitOk(await tx.send(C.NanoLedger, nanoLedgerAbi, "approveSpender", [C.MarketsV4, SESSION_CAP]));
        return tx.send(C.MarketsV4, marketsV4Abi, "setSession", [acct.address, SESSION_CAP, BigInt(s.expiry)], SESSION_GAS);
      },
      `One-click betting is on for 24 hours (up to ${fmt(SESSION_CAP)} USDC of bets).`,
    );
    void read();
  }, [address, client, local, allowance, tx, read]);

  /** Revoke on chain, send the key's leftover gas back, forget the key. */
  const end = useCallback(async () => {
    if (!address || !local) return;
    const ok = await tx.run(
      "session",
      "ending",
      () => tx.send(C.MarketsV4, marketsV4Abi, "revokeSession", [local.delegate]),
      "One-click betting is off.",
    );
    if (!ok) return;
    // Send the key's leftover gas back; the session is revoked either way, so the
    // key is forgotten even if this fails (it then keeps a few cents).
    try {
      if (wallet) {
        const [bal, gasPrice] = await Promise.all([client.getBalance({ address: local.delegate }), client.getGasPrice()]);
        const fee = 21_000n * gasPrice * 2n;
        if (bal > fee) await wallet.sendTransaction({ to: address, value: bal - fee, gas: 21_000n, chain: CHAIN.viemChain, account: wallet.account });
      }
    } catch {
      /* a few cents stay on the retired key */
    }
    clearSession(D.chainId, address);
    setLocal(undefined);
    setChain(undefined);
  }, [address, local, wallet, client, tx]);

  /** Shares of `outcome` in `marketId` this session key bought for the owner and
   *  may therefore sell (the contract caps a delegate's sells to exactly these). */
  const sellable = useCallback(
    async (marketId: Hex, outcome: number): Promise<bigint> =>
      address && local
        ? ((await client.readContract({
            address: C.MarketsV4,
            abi: marketsV4Abi,
            functionName: "sessionShares",
            args: [address, local.delegate, marketId, outcome],
          })) as bigint)
        : 0n,
    [client, address, local],
  );

  return { status, chain, allowance, covers, send, enable, end, sellable, owner: address };
}

type Session = ReturnType<typeof useSession>;
const SessionCtx = createContext<Session | undefined>(undefined);

// ───────────────────────────── page ─────────────────────────────

/** Which page: the overview grid, one asset's market page, or one event's page. */
export type RoundsView = { kind: "overview" } | { kind: "asset"; key: string } | { kind: "event"; key: string };

export function CommonMarkets({ view = { kind: "overview" } }: { view?: RoundsView }) {
  const { address, walletChainId, connect, switchChain } = useWallet();
  const client = useMemo(
    () =>
      // Reads in the same tick go out as ONE Multicall3 eth_call (the official RPC
      // rate-limits per IP; a refresh is dozens of reads).
      createPublicClient({
        chain: { ...CHAIN.viemChain, contracts: { ...CHAIN.viemChain.contracts, multicall3: { address: MULTICALL3 } } },
        transport: transportFor(CHAIN, { batch: true }),
        batch: { multicall: { wait: 16 } },
      }) as PublicClient,
    [],
  );
  const { snap: fullSnap, loadError, refresh } = useRoundsData(client, address);
  const stream = usePriceStream(useMemo(() => D.assets.map((a) => a.product), []));
  const tx = useTx(client, refresh);
  // A wallet transaction in flight (not a one-click one, which uses no wallet).
  const walletBusy = useRef(false);
  useEffect(() => {
    walletBusy.current = Boolean(tx.st.pending) && !tx.st.oneClick;
  }, [tx.st.pending, tx.st.oneClick]);
  const session = useSession(client, address, tx);

  // Client clock, corrected to chain time at the last read.
  const [clientNow, setClientNow] = useState(0);
  useEffect(() => {
    setClientNow(Date.now() / 1000);
    const id = setInterval(() => setClientNow(Date.now() / 1000), 250);
    return () => clearInterval(id);
  }, []);
  const skew = fullSnap ? fullSnap.chainNow - fullSnap.readAt : 0;
  const now = clientNow ? clientNow + skew : 0;

  // Chain state every 5 s, and right after each round boundary (the agent opens
  // the new round a few seconds after it, so look again shortly after).
  useEffect(() => {
    void refresh();
    // The live lane (useLivePools) keeps prices, odds and positions current every
    // second; the full read (discovery, readings, holdings, claims) runs every 10 s,
    // except while a wallet transaction is in flight (the wallet needs the RPC).
    const id = setInterval(() => {
      if (!walletBusy.current) void refresh();
    }, 10_000);
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
    if (!fullSnap) return undefined;
    const phases: Record<string, number> = {};
    for (const [id, s] of Object.entries(fullSnap.state)) phases[id] = s.phase;
    return groupRounds(fullSnap.markets, D.assets.map((a) => a.key), now || fullSnap.chainNow, phases);
    // Regroup on each read and at each boundary, not every clock tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullSnap, boundary]);

  // The live lane: pools people can trade now, re-read every second.
  const liveIds = useMemo(() => {
    const ids = new Set<Hex>();
    for (const g of Object.values(groups ?? {})) if (g.current) ids.add(g.current.marketId);
    for (const id of Object.values(fullSnap?.eventMarkets ?? {})) {
      const ph = fullSnap?.state[id]?.phase;
      if (ph === undefined || ph === PHASE.Trading) ids.add(id);
    }
    return [...ids].sort();
  }, [groups, fullSnap]);
  const livePools = useLivePools(client, liveIds, Boolean(tx.st.pending) && !tx.st.oneClick);
  const snap = useMemo(() => withLivePools(fullSnap, livePools), [fullSnap, livePools]);
  // No trading on stale numbers: the newest chain read (full or live pool) is
  // older than STALE_SECS, e.g. the RPC is rate-limiting or down.
  const lastRead = Math.max(fullSnap?.readAt ?? 0, ...Object.values(livePools).map((p) => p.at));
  const stale = Boolean(fullSnap) && clientNow > 0 && clientNow - lastRead > STALE_SECS;

  // Betting on the next round closes at the next boundary.
  const roundEnd = now ? nextBoundary(now) : 0;
  const onChain = walletChainId === D.chainId;
  const inPlay = useMemo(
    () =>
      D.assets.flatMap((a) => {
        const m = groups?.[a.key]?.inPlay;
        return m?.change ? [{ asset: a, start: m.expiry }] : [];
      }),
    [groups],
  );
  const startPrices = useStartPrices(inPlay);

  // Price rounds or event markets, as tabs (#events links straight to the events).
  const [tab, setTab] = useState<RoundsTab>("price");
  useEffect(() => setTab(parseRoundsTab(window.location.hash)), []);
  const pickTab = (t: RoundsTab) => {
    setTab(t);
    window.history.replaceState(null, "", t === "events" ? "#events" : window.location.pathname + window.location.search);
  };

  const canTrade = Boolean(address && onChain && !stale);
  const pageAsset = view.kind === "asset" ? D.assets.find((a) => a.key === view.key) : undefined;
  const pageEvent = view.kind === "event" ? D.events.find((e) => e.key === view.key) : undefined;

  return (
    <SessionCtx.Provider value={session}>
    <div className="fade-up pu-bridge">
      {view.kind === "overview" ? (
        <Header now={now} roundEnd={roundEnd} showTimer={tab === "price"} />
      ) : (
        <Link href="/rounds/" className="mb-4 inline-block text-[13px] text-fg-dim hover:text-fg">
          ← All markets
        </Link>
      )}

      <LedgerBar snap={snap} tx={tx} address={address} onChain={onChain} connect={connect} switchChain={() => switchChain(D.chainId)} />

      {stale && (
        <p className="mb-4 rounded-xl border border-down bg-bg-elev px-4 py-3 text-[13px] text-down" role="status">
          The market data is {Math.round(clientNow - lastRead)} s old (the chain is not answering). Trading is paused until it
          refreshes.
        </p>
      )}
      {loadError && !snap && (
        <p className="mb-6 rounded-xl border border-down bg-bg-elev px-4 py-3 text-[13px] text-down">
          Could not read the markets from {D.label}: {loadError} Retrying every 10 seconds.
        </p>
      )}

      {pageAsset && (
        <AssetPage
          asset={pageAsset}
          snap={snap}
          groups={groups?.[pageAsset.key]}
          startPrice={groups?.[pageAsset.key]?.inPlay ? startPrices[`${pageAsset.product}@${groups[pageAsset.key].inPlay!.expiry}`] : undefined}
          live={stream.last[pageAsset.product]}
          stream={stream}
          skew={skew}
          now={now}
          open={open}
          setOpen={setOpen}
          tx={tx}
          canTrade={canTrade}
        />
      )}
      {pageEvent && (
        <div className="max-w-[760px]">
          <EventCard ev={pageEvent} snap={snap} now={now} open={open} setOpen={setOpen} tx={tx} canTrade={canTrade} address={address} page />
          <EventRules />
        </div>
      )}
      {view.kind !== "overview" && !pageAsset && !pageEvent && <p className="text-fg-mute">This market does not exist.</p>}

      {address && <Claims snap={snap} tx={tx} now={now} />}

      {view.kind === "overview" && (
      <>
      <nav className="pa-tabs mb-5" aria-label="Market categories">
        {ROUNDS_TABS.map((t) => (
          <button key={t.key} type="button" className="pa-tab" aria-pressed={tab === t.key} onClick={() => pickTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "price" && (
      <>
      <p className="mb-4 max-w-[72ch] text-fg-mute">
        Up or down over the next five minutes? Bet on the next round of BTC, ETH, SOL, ZEC and HYPE; betting closes as
        the round starts, so nobody trades on a move already on the chart. Buy and sell until then.
      </p>
      <section aria-label="Five-minute rounds" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {D.assets.map((a) => (
          <AssetCard
            key={a.key}
            asset={a}
            snap={snap}
            current={groups?.[a.key]?.current}
            inPlay={groups?.[a.key]?.inPlay}
            running={Boolean(groups?.[a.key] && (groups[a.key].current || groups[a.key].inPlay || groups[a.key].recent.length))}
            startPrice={groups?.[a.key]?.inPlay ? startPrices[`${a.product}@${groups[a.key].inPlay!.expiry}`] : undefined}
            live={stream.last[a.product]}
            stream={stream}
            skew={skew}
            now={now}
            open={open}
            setOpen={setOpen}
            tx={tx}
            canTrade={canTrade}
          />
        ))}
      </section>
      <p className="mt-3 max-w-[72ch] text-[13px] leading-relaxed text-fg-dim">
        Prices are live · Coinbase, for reference. You bet on the next round; betting closes the moment it starts. When
        it ends, the agent attests the round&apos;s change on chain: the median of the changes on Coinbase, Kraken and
        OKX (each the 1-minute close at the end minus the one at the start), so no single exchange decides a round. Up
        wins only if the change is above zero; no change is Down. The reading becomes final after a 10-minute
        challenge window and the agent resolves the round right after, about 10–11 minutes after the round ends; in the
        meantime your position shows what it pays if the round ended now.
      </p>
      </>
      )}

      {tab === "events" && (
        <EventMarkets snap={snap} now={now} open={open} setOpen={setOpen} tx={tx} canTrade={canTrade} address={address} />
      )}
      </>
      )}

      <p className="mt-12 border-t border-line pt-4 text-[13px] leading-relaxed text-fg-dim">
        Markets read live from{" "}
        <a className="text-fg-mute underline" href={`${D.explorer}/address/${C.MarketsV4}`} target="_blank" rel="noreferrer">
          MarketsV4 on {D.label}
        </a>
        . Rounds are opened and settled by Registrai&apos;s agent{" "}
        <a className="text-fg-mute underline" href={`${D.explorer}/address/${D.agent}`} target="_blank" rel="noreferrer">
          {D.agent.slice(0, 6)}…{D.agent.slice(-4)}
        </a>
        , which seeds each pool with 5 USDC. Every buy and sell pays a {snap?.feeBps !== undefined ? `${Number(snap.feeBps) / 100}%` : "1%"}{" "}
        trading fee; nothing is charged at settlement.{D.testnet ? " Testnet USDC only." : ""}
      </p>
    </div>
    </SessionCtx.Provider>
  );
}

// ───────────────────────────── header ─────────────────────────────

function Header({ now, roundEnd, showTimer }: { now: number; roundEnd: number; showTimer: boolean }) {
  const left = now ? roundEnd - now : 0;
  const progress = now ? 1 - left / D.roundSecs : 0;
  const closing = now > 0 && left <= 30;
  return (
    <header className="mb-8 grid gap-6 border-b border-line pb-6 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
        <h1 className="pa-h1 pu-h">Common markets</h1>
        <p className="pa-lede">
          Quick price rounds and longer event questions, open to anyone and settled on chain in USDC.
        </p>
      </div>
      {showTimer && (
      <div className="sm:w-[240px]" aria-live="off">
        <div className="flex items-baseline justify-between gap-4 text-[13px] text-fg-dim">
          <span>{now ? `Next round ${roundLabel(roundEnd, roundEnd + D.roundSecs)}` : "Next round"}</span>
          <span>betting closes in</span>
        </div>
        <div
          className={`tnum pu-h mt-1 text-right text-[56px] leading-none ${closing ? "text-down" : "text-fg"}`}
          role="timer"
          aria-label="Time left to bet on the next round"
        >
          {now ? timeLeft(left) : "–:––"}
        </div>
        <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-line">
          <div
            className={`h-full transition-[width] duration-300 ease-linear ${closing ? "bg-down" : "bg-accent"}`}
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        </div>
      </div>
      )}
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
      <div className="pu-card pu-card--compact mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-fg-mute">Connect a wallet to trade. Prices and results are public.</p>
        <button onClick={() => void connect()} className="pa-btn pu-btn pu-btn--primary">
          Connect wallet
        </button>
      </div>
    );
  }
  if (!onChain) {
    return (
      <div className="pu-card pu-card--compact mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-fg-mute">These markets run on {D.label}. Your wallet is on another network.</p>
        <button onClick={() => void switchChain()} className="pa-btn pu-btn pu-btn--primary">
          Switch to {D.label}
        </button>
      </div>
    );
  }
  const busy = Boolean(tx.st.pending);
  return (
    <div className="pu-card pu-card--compact mb-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <div className="text-[13px] text-fg-dim">Trading balance</div>
          <div className="tnum pu-h text-[22px] leading-tight">{snap?.ledgerBal !== undefined ? `${fmt(ledgerBal)} USDC` : "…"}</div>
        </div>
        <div className="text-[13px] text-fg-dim">
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
            className="pu-input tnum w-[110px] text-[14px] outline-none"
          />
          <button onClick={deposit} disabled={busy} className="pa-btn pu-btn pu-btn--primary">
            {tx.st.pending === "depositing" ? "Depositing…" : "Deposit"}
          </button>
          <button
            onClick={withdraw}
            disabled={busy || ledgerBal === 0n}
            className="pu-btn pu-btn--quiet text-[13px] disabled:opacity-40"
          >
            {tx.st.pending === "withdrawing" ? "Withdrawing…" : "Withdraw all"}
          </button>
        </div>
      </div>
      <TxLine tx={tx} scope={scope} />
      <SessionRow tx={tx} />
    </div>
  );
}

/** One-click betting: on/off, what is left of the session, and why it paused. */
function SessionRow({ tx }: { tx: Tx }) {
  const ses = useContext(SessionCtx);
  if (!ses) return null;
  const busy = Boolean(tx.st.pending);
  const on = ses.status === "active" || ses.status === "spent";
  const note: Record<SessionStatus, string> = {
    none: "Approve once, then bet without a wallet pop-up for 24 hours (up to 50 USDC of bets). Positions and winnings stay in your wallet's balance.",
    pending: "Waiting for the session to land on chain…",
    active: "",
    spent: "This session's 50 USDC of bets is used up; cash-outs and claims still go through. Renew to bet more.",
    expired: "The session ended. Renew to keep betting without pop-ups.",
    "low-gas": "The session key is almost out of gas. Renew to top it up.",
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-[13px]">
      <span className={`inline-flex items-center gap-1.5 ${on ? "text-up" : "text-fg-mute"}`}>
        <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${on ? "bg-up" : "bg-line-strong"}`} />
        One-click betting {on ? "on" : "off"}
      </span>
      {on && ses.chain ? (
        <span className="tnum text-fg-dim">
          {fmt(ses.chain.spendLeft)} of {fmt(SESSION_CAP)} USDC left · ends {timeLeft(ses.chain.expiry - Date.now() / 1000)}
        </span>
      ) : (
        <span className="text-fg-dim">{note[ses.status]}</span>
      )}
      <span className="ml-auto flex gap-2">
        {ses.status !== "active" && (
          <button
            onClick={() => void ses.enable()}
            disabled={busy}
            className="pa-chip disabled:opacity-50"
          >
            {tx.st.pending === "session" ? "Confirm in wallet…" : ses.status === "none" ? "Enable" : "Renew"}
          </button>
        )}
        {ses.status !== "none" && (
          <button
            onClick={() => void ses.end()}
            disabled={busy}
            className="pa-chip disabled:opacity-50"
          >
            {tx.st.pending === "ending" ? "Ending…" : "End"}
          </button>
        )}
      </span>
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
    <div className="mt-2 text-[13px]" aria-live="polite">
      {st.pending && <span className="text-fg-dim">{st.oneClick ? "Sending (one-click)… " : "Confirm in your wallet, then wait for the block… "}</span>}
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

/** Everything a card or a market page shows about an asset's rounds, from the
 *  snapshot, the live price and the clock. */
function useAssetRound({
  asset,
  snap,
  current,
  inPlay,
  startPrice,
  live,
  now,
  open,
}: {
  asset: AssetMeta;
  snap?: Snapshot;
  current?: RoundMarket;
  inPlay?: RoundMarket;
  startPrice?: number;
  live?: { price: number; dir: "up" | "down" | "flat" };
  now: number;
  open: OpenTrade;
}) {
  const st = current ? snap?.state[current.marketId] : undefined;
  const liveScaled = live ? toScaled(live.price, asset.decimals) : undefined;
  // A legacy price round compares the live price with its strike; the round in
  // play compares it with the price the round started at.
  const legacy = current && !current.change ? current : undefined;
  const ref = legacy ? legacy.threshold : inPlay?.change && startPrice !== undefined ? toScaled(startPrice, asset.decimals) : undefined;
  const delta = liveScaled !== undefined && ref !== undefined ? strikeDelta(liveScaled, ref) : undefined;
  const playLeft = inPlay && now ? roundWindow(inPlay).end - now : 0;
  const playHold = inPlay ? snap?.holdings[inPlay.marketId] : undefined;
  const upPct = st ? impliedPct(st.yesPrice) : 50;
  const left = current && now ? current.expiry - now : 0;
  const trading = Boolean(current && st && st.phase === PHASE.Trading && left > 0);
  const hold = current ? snap?.holdings[current.marketId] : undefined;
  const isOpen = Boolean(current && open?.id === current.marketId);
  const odds = useMemo(() => {
    if (!current || !snap || !st) return undefined;
    const at = (block: bigint) => snap.chainNow - Number(snap.head - block) * BLOCK_SECS;
    const pts = replayPool(current.liquidity, current.blockNumber, snap.trades[current.marketId] ?? []).map((q) => ({ t: at(q.block), up: q.up }));
    pts.push({ t: snap.chainNow, up: impliedPct(st.yesPrice) / 100 }); // the live pool
    return { pts, open: at(current.blockNumber) };
  }, [current, snap, st]);
  const played = inPlay?.change ? roundWindow(inPlay) : undefined;
  const upPrice = st ? cents(st.yesPrice) : "—";
  const downPrice = st ? cents(st.noPrice) : "—";
  return { st, delta, playLeft, playHold, upPct, left, trading, hold, isOpen, odds, played, upPrice, downPrice };
}

/** A click on the card itself (not on its buttons, inputs or links) opens the
 *  market's page; the Up/Down buttons stay quick bets on the card. */
function useCardLink(href: string) {
  const router = useRouter();
  return (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button, a, input, label, select, textarea, [role=group]")) return;
    router.push(href);
  };
}

function AssetCard({
  asset,
  snap,
  current,
  inPlay,
  running,
  startPrice,
  live,
  stream,
  skew,
  now,
  open,
  setOpen,
  tx,
  canTrade,
}: {
  asset: AssetMeta;
  snap?: Snapshot;
  current?: RoundMarket;
  inPlay?: RoundMarket;
  /** The agent has run rounds on this asset recently (else: not started / paused). */
  running: boolean;
  /** The in-play round's start price (Coinbase, the minute the agent reads). */
  startPrice?: number;
  live?: { price: number; dir: "up" | "down" | "flat" };
  stream: PriceStream;
  skew: number;
  now: number;
  open: OpenTrade;
  setOpen: (o: OpenTrade) => void;
  tx: Tx;
  canTrade: boolean;
}) {
  const { st, delta, playLeft, playHold, upPct, left, trading, hold, isOpen, odds, played, upPrice, downPrice } = useAssetRound({
    asset,
    snap,
    current,
    inPlay,
    startPrice,
    live,
    now,
    open,
  });
  const toggle = (side: "yes" | "no", mode: "buy" | "sell") =>
    current && setOpen(isOpen && open?.mode === mode && open.side === side ? undefined : { id: current.marketId, side, mode });
  const openPage = useCardLink(assetHref(asset));

  return (
    <article
      onClick={openPage}
      className="pu-card flex min-w-0 cursor-pointer flex-col transition-colors"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="pu-h text-[24px] leading-none">
            <Link href={assetHref(asset)} className="hover:underline">
              {asset.symbol}
            </Link>
          </h2>
          <span className="truncate text-[13px] text-fg-dim">{asset.name}</span>
        </div>
        <div
          className={`tnum pu-h text-[24px] leading-none transition-colors duration-300 ${
            live?.dir === "up" ? "text-up" : live?.dir === "down" ? "text-down" : "text-fg"
          }`}
        >
          {live ? formatPrice(live.price, asset.decimals) : "—"}
          {!stream.live && live && <span className="ml-1 align-middle text-[13px] text-fg-dim" title="Live stream reconnecting; polling">·</span>}
        </div>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[13px] text-fg-dim">
        <span className="min-w-0 truncate">
          {current ? (
            <>
              {current.change ? "Next" : "Round"} {roundLabel(roundWindow(current).start, roundWindow(current).end)}
              {!current.change && <> · strike {formatScaled(current.threshold, asset.decimals)}</>}
            </>
          ) : snap && now && !running ? (
            <>No {asset.symbol} rounds running yet · live price only</>
          ) : snap && now ? (
            now - Math.floor(now / D.roundSecs) * D.roundSecs < D.roundSecs - 120 ? (
              <>Opening {roundLabel(nextBoundary(now), nextBoundary(now) + D.roundSecs)}…</>
            ) : (
              <>Next round opens {clockUtc(nextBoundary(now))} UTC</>
            )
          ) : (
            "Reading the rounds…"
          )}
        </span>
        {trading && (
          <span className="shrink-0">
            closes <span className={`tnum ${left <= 30 ? "text-down" : "text-fg-mute"}`}>{timeLeft(left)}</span>
          </span>
        )}
      </div>

      <div className="mt-2 -mx-1">
        <PriceChart
          series={stream.series[asset.product]}
          decimals={asset.decimals}
          skew={skew}
          height={128}
          startPrice={played ? startPrice : undefined}
          roundStart={played?.start}
          roundEnd={played?.end}
        />
      </div>

      {played && (
        <div className="mt-1 flex items-baseline justify-between gap-3 text-[13px] text-fg-dim">
          <span>
            In play · ends <span className="tnum text-fg-mute">{timeLeft(playLeft)}</span>
          </span>
          {delta && (
            <span className={`tnum ${delta.dir === "above" ? "text-up" : "text-down"}`}>
              {delta.dir === "above" ? "▲ Up" : "▼ Down"} {formatScaled(delta.diff < 0n ? -delta.diff : delta.diff, asset.decimals)}
            </span>
          )}
        </div>
      )}
      {played && playHold && (playHold.yes > 0n || playHold.no > 0n) && (
        <Position
          hold={playHold}
          value={delta ? (delta.dir === "above" ? playHold.yes : playHold.no) : undefined}
          valueLabel="Pays if it ends now"
        />
      )}

      {current && st && (
        <div className="mt-3 border-t border-line pt-3">
          {odds && current.change && (
            <div className="mb-2">
              <div className="flex items-baseline justify-between text-[13px] text-fg-dim">
                <span>
                  <span className={upPct >= 50 ? "text-up" : "text-down"}>{upPct.toFixed(0)}% Up</span> · pool odds
                </span>
              </div>
              <OddsChart points={odds.pts} open={odds.open} close={current.expiry} skew={skew} height={48} />
            </div>
          )}
          {trading ? (
            <div className="grid grid-cols-2 gap-2">
              <SideButton label={`Up ${upPrice}`} tone="up" active={Boolean(isOpen && open?.mode === "buy" && open.side === "yes")} onClick={() => toggle("yes", "buy")} />
              <SideButton label={`Down ${downPrice}`} tone="down" active={Boolean(isOpen && open?.mode === "buy" && open.side === "no")} onClick={() => toggle("no", "buy")} />
            </div>
          ) : (
            <p className="text-[13px] text-fg-dim">
              {current.change ? "Betting closed" : "Trading closed"} at {clockUtc(current.expiry)} UTC.
            </p>
          )}
          {hold && (hold.yes > 0n || hold.no > 0n) && (
            <>
              <Position hold={hold} value={trading && snap?.feeBps !== undefined ? cashOutValue({ yes: st.yesReserve, no: st.noReserve }, hold, snap.feeBps) : undefined} />
              {trading && (
                <button
                  onClick={() => toggle(hold.yes > 0n ? "yes" : "no", "sell")}
                  className={`pu-btn pu-btn--quiet mt-2 w-full text-[13px] ${isOpen && open?.mode === "sell" ? "is-active" : ""}`}
                >
                  Cash out
                </button>
              )}
            </>
          )}
          {isOpen && trading && (
            <TradeBox
              market={current}
              st={st}
              hold={hold ?? { yes: 0n, no: 0n, cost: 0n }}
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
    </article>
  );
}

// ───────────────────────────── asset market page ─────────────────────────────

/** One asset's market page (/rounds/<symbol>/): its current round, big; the trade
 *  panel is always open while betting runs; the rules; the latest results. */
function AssetPage({
  asset,
  snap,
  groups,
  startPrice,
  live,
  stream,
  skew,
  now,
  open,
  setOpen,
  tx,
  canTrade,
}: {
  asset: AssetMeta;
  snap?: Snapshot;
  groups?: AssetRounds;
  startPrice?: number;
  live?: { price: number; dir: "up" | "down" | "flat" };
  stream: PriceStream;
  skew: number;
  now: number;
  open: OpenTrade;
  setOpen: (o: OpenTrade) => void;
  tx: Tx;
  canTrade: boolean;
}) {
  const current = groups?.current;
  const inPlay = groups?.inPlay;
  const r = useAssetRound({ asset, snap, current, inPlay, startPrice, live, now, open });
  // The trade panel is open by default here: Up, buy, unless the visitor chose otherwise.
  const trade: OpenTrade = current ? (r.isOpen ? open : { id: current.marketId, side: "yes", mode: "buy" }) : undefined;
  const pick = (side: "yes" | "no", mode: "buy" | "sell") => current && setOpen({ id: current.marketId, side, mode });
  const running = Boolean(groups && (current || inPlay || groups.recent.length));

  return (
    <article>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div className="min-w-0">
          <h1 className="pu-h text-[40px] leading-none">
            {asset.symbol} <span className="text-[22px] text-fg-dim">Up or Down · 5 minutes</span>
          </h1>
          <p className="mt-2 text-[13px] text-fg-mute">
            {current ? (
              <>
                Next round {roundLabel(roundWindow(current).start, roundWindow(current).end)}
                {r.trading && (
                  <>
                    {" "}
                    · betting closes in <span className={`tnum ${r.left <= 30 ? "text-down" : "text-fg"}`}>{timeLeft(r.left)}</span>
                  </>
                )}
              </>
            ) : snap && now && !running ? (
              <>No {asset.symbol} rounds running yet · live price only</>
            ) : snap && now ? (
              <>Next round opens {clockUtc(nextBoundary(now))} UTC</>
            ) : (
              "Reading the rounds…"
            )}
          </p>
        </div>
        <div
          className={`tnum pu-h text-[40px] leading-none transition-colors duration-300 ${
            live?.dir === "up" ? "text-up" : live?.dir === "down" ? "text-down" : "text-fg"
          }`}
        >
          {live ? formatPrice(live.price, asset.decimals) : "—"}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <PriceChart
            series={stream.series[asset.product]}
            decimals={asset.decimals}
            skew={skew}
            height={320}
            startPrice={r.played ? startPrice : undefined}
            roundStart={r.played?.start}
            roundEnd={r.played?.end}
          />
          {r.played && (
            <div className="mt-2 flex items-baseline justify-between gap-3 text-[14px] text-fg-dim">
              <span>
                Round {roundLabel(r.played.start, r.played.end)} in play · ends <span className="tnum text-fg-mute">{timeLeft(r.playLeft)}</span>
              </span>
              {r.delta && (
                <span className={`tnum ${r.delta.dir === "above" ? "text-up" : "text-down"}`}>
                  {r.delta.dir === "above" ? "▲ Up" : "▼ Down"} {formatScaled(r.delta.diff < 0n ? -r.delta.diff : r.delta.diff, asset.decimals)}
                </span>
              )}
            </div>
          )}
          {r.played && r.playHold && (r.playHold.yes > 0n || r.playHold.no > 0n) && (
            <Position
              hold={r.playHold}
              value={r.delta ? (r.delta.dir === "above" ? r.playHold.yes : r.playHold.no) : undefined}
              valueLabel="Pays if it ends now"
            />
          )}

          {r.odds && current?.change && (
            <section className="mt-6" aria-label="Pool odds">
              <div className="mb-1 text-[13px] text-fg-dim">
                <span className={r.upPct >= 50 ? "text-up" : "text-down"}>{r.upPct.toFixed(0)}% Up</span> · pool odds for the next round
              </div>
              <OddsChart points={r.odds.pts} open={r.odds.open} close={current.expiry} skew={skew} height={110} />
            </section>
          )}

          <RoundRules asset={asset} />
          <PastRounds asset={asset} rounds={groups?.recent ?? []} snap={snap} now={now} />
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="pu-card">
            {current && r.st ? (
              r.trading ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <SideButton label={`Up ${r.upPrice}`} tone="up" active={trade?.mode === "buy" && trade.side === "yes"} onClick={() => pick("yes", "buy")} />
                    <SideButton label={`Down ${r.downPrice}`} tone="down" active={trade?.mode === "buy" && trade.side === "no"} onClick={() => pick("no", "buy")} />
                  </div>
                  <TradeBox
                    market={current}
                    st={r.st}
                    hold={r.hold ?? { yes: 0n, no: 0n, cost: 0n }}
                    ledgerBal={snap?.ledgerBal ?? 0n}
                    feeBps={snap?.feeBps}
                    labels={["Up", "Down"]}
                    open={trade!}
                    setOpen={setOpen}
                    tx={tx}
                    canTrade={canTrade}
                    windowSecs={ROUND_TRADE_WINDOW_SECS}
                  />
                </>
              ) : (
                <p className="text-[13px] text-fg-dim">Betting closed at {clockUtc(current.expiry)} UTC. The next round opens shortly.</p>
              )
            ) : (
              <p className="text-[13px] text-fg-dim">No round is taking bets right now.</p>
            )}
            {current && r.st && r.hold && (r.hold.yes > 0n || r.hold.no > 0n) && (
              <>
                <Position
                  hold={r.hold}
                  value={r.trading && snap?.feeBps !== undefined ? cashOutValue({ yes: r.st.yesReserve, no: r.st.noReserve }, r.hold, snap.feeBps) : undefined}
                />
                {r.trading && (
                  <button
                    onClick={() => pick(r.hold!.yes > 0n ? "yes" : "no", "sell")}
                    className={`pu-btn pu-btn--quiet mt-2 w-full text-[13px] ${trade?.mode === "sell" ? "is-active" : ""}`}
                  >
                    Cash out
                  </button>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
    </article>
  );
}

function RoundRules({ asset }: { asset: AssetMeta }) {
  return (
    <section className="mt-8" aria-labelledby="rules-h">
      <h2 id="rules-h" className="pu-h mb-2 text-[24px] leading-none">
        Rules
      </h2>
      <ul className="list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-fg-mute">
        <li>
          Each round is five minutes. You bet on the NEXT round; betting closes the moment it starts, so nobody trades on
          a move already on the chart. Until then you can buy, sell and cash out.
        </li>
        <li>
          <b className="font-medium text-fg">Up</b> wins if {asset.symbol}&apos;s price change over the round is above zero;
          no change is Down. The change is the median of Coinbase, Kraken and OKX, each the 1-minute close at the round&apos;s
          end minus the one at its start, so no single exchange decides a round.
        </li>
        <li>
          The agent posts the change on chain after the round ends. Anyone can challenge it for 10 minutes; a challenged
          reading waits for the dispute resolver&apos;s ruling. Then the round resolves and winning shares pay 1 USDC each.
        </li>
        <li>
          If no valid reading lands within an hour of the round&apos;s start, the round voids and every trader gets their
          net cost back. Every buy and sell pays a 1% trading fee; nothing is charged at settlement.
        </li>
      </ul>
    </section>
  );
}

function PastRounds({ asset, rounds, snap, now }: { asset: AssetMeta; rounds: readonly RoundMarket[]; snap?: Snapshot; now: number }) {
  if (!rounds.length) return null;
  return (
    <section className="mt-8" aria-labelledby="past-h">
      <h2 id="past-h" className="pu-h mb-2 text-[24px] leading-none">
        Latest rounds
      </h2>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-bg-elev text-[14px]">
        {rounds.map((m) => {
          const s = statusFor(m, snap, now);
          const rd = snap?.readings[m.marketId];
          const w = roundWindow(m);
          const tone = s?.key === "resolved-up" ? "text-up" : s?.key === "resolved-down" ? "text-down" : "text-fg-mute";
          return (
            <li key={m.marketId} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="tnum text-fg-mute">{roundLabel(w.start, w.end)}</span>
              <span className="tnum text-fg-dim">{rd?.found ? formatChange(rd.value, asset.decimals) : ""}</span>
              <span className={tone} title={s?.detail}>
                {s?.label ?? "…"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EventRules() {
  return (
    <section className="mt-8" aria-labelledby="erules-h">
      <h2 id="erules-h" className="pu-h mb-2 text-[24px] leading-none">
        Rules
      </h2>
      <ul className="list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-fg-mute">
        <li>The market settles on the curated feed&apos;s reading at the deadline: Yes if it says the event happened by then.</li>
        <li>
          The team records the outcome with evidence when it happens. Anyone can challenge a reading during its dispute
          window; a challenged reading waits for the dispute resolver&apos;s ruling.
        </li>
        <li>If no valid reading lands in time the market voids and every trader gets their net cost back.</li>
        <li>Every buy and sell pays a 1% trading fee; nothing is charged at settlement.</li>
      </ul>
    </section>
  );
}

/** A holding: shares per side, what it is worth now against what it cost (the
 *  contract's net cost), and what each outcome pays. `value` updates with every
 *  pool read (cash-out on the live curve) or, in play, with every price tick. */
function Position({ hold, value, valueLabel = "Value now" }: { hold: Holding; value?: bigint; valueLabel?: string }) {
  const r = value !== undefined ? pnl(value, hold.cost) : undefined;
  const tone = !r || r.diff === 0n ? "text-fg-mute" : r.diff > 0n ? "text-up" : "text-down";
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-line bg-bg px-3 py-2.5 text-[13px] sm:grid-cols-4">
      <div>
        <div className="text-fg-dim">Your shares</div>
        <div className="tnum mt-0.5 text-[13px]">
          {hold.yes > 0n && <span className="text-up">{fmt(hold.yes)} Up</span>}
          {hold.yes > 0n && hold.no > 0n && <span className="text-fg-dim"> · </span>}
          {hold.no > 0n && <span className="text-down">{fmt(hold.no)} Down</span>}
        </div>
      </div>
      <div>
        <div className="text-fg-dim">Cost</div>
        <div className="tnum mt-0.5 text-[13px] text-fg-mute">${fmt(hold.cost)}</div>
      </div>
      <div>
        <div className="text-fg-dim">{valueLabel}</div>
        <div className="tnum mt-0.5 text-[13px] transition-colors duration-300">{value !== undefined ? `$${fmt(value)}` : "—"}</div>
      </div>
      <div>
        <div className="text-fg-dim">P&amp;L</div>
        <div className={`tnum mt-0.5 text-[13px] transition-colors duration-300 ${tone}`}>
          {r ? `${r.diff >= 0n ? "+" : "−"}$${fmt(r.diff < 0n ? -r.diff : r.diff)} (${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}%)` : "—"}
        </div>
      </div>
      <div className="col-span-2 text-fg-dim sm:col-span-4">
        {hold.yes > 0n && <>Up pays ${fmt(hold.yes)}</>}
        {hold.yes > 0n && hold.no > 0n && " · "}
        {hold.no > 0n && <>Down pays ${fmt(hold.no)}</>}
      </div>
    </div>
  );
}

function SideButton({ label, tone, active, onClick }: { label: string; tone: "up" | "down"; active: boolean; onClick: () => void }) {
  // A price that just moved flashes once, so a live change is noticed.
  const ref = useRef<HTMLButtonElement>(null);
  const last = useRef(label);
  useEffect(() => {
    if (last.current !== label && ref.current?.animate) {
      ref.current.animate([{ boxShadow: "0 0 0 3px color-mix(in srgb, currentColor 35%, transparent)" }, { boxShadow: "0 0 0 0 transparent" }], {
        duration: 700,
        easing: "ease-out",
      });
    }
    last.current = label;
  }, [label]);
  // Paper UI: tinted outline, filled while pressed (aria-pressed).
  return (
    <button ref={ref} onClick={onClick} aria-pressed={active} className={`tnum pu-btn pu-btn--${tone} w-full text-[14px]`}>
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
  const ses = useContext(SessionCtx);
  // (a sell goes one-click only for shares the session bought: checked on submit)
  const oneClick = Boolean(open.mode === "buy" && ses?.owner && value !== undefined && ses.covers("buy", value));
  const impact = buyQ ? buyQ.priceImpact : 0;

  async function submit() {
    if (!canTrade) return fail(`Connect a wallet on ${D.label} first.`);
    if (!parsed) return fail(open.mode === "buy" ? "Enter an amount in USDC." : "Enter how many shares to sell.");
    if (!parsed.ok) return fail(parsed.error);
    const v = parsed.value;
    if (open.mode === "buy" && v > ledgerBal) return fail("That is more than your trading balance. Deposit first (above).");
    if (open.mode === "sell" && v > held) return fail(`You hold ${fmt(held)} ${label} shares.`);
    if (floor === undefined) return fail("No quote yet: wait a moment for the pool to load.");
    // The floor the user saw is the floor sent: the trade never fills below the
    // "Minimum accepted" on screen (one-click has no wallet step to catch a move).
    const shownFloor = floor;
    // Decide the path BEFORE sending, so the status line tells the truth: a sell
    // goes one-click only for shares this session key bought.
    let viaSession = false;
    try {
      viaSession = Boolean(
        ses?.owner &&
          ses.covers(open.mode, v) &&
          (open.mode === "buy" || (await ses.sellable(market.marketId, outcome)) >= v),
      );
    } catch {
      viaSession = false;
    }
    const verb = open.mode === "buy" ? `Bought ${label}` : `Sold ${label}`;
    const ok = await tx.run(
      scope,
      open.mode,
      async () => {
        const client = tx.client;
        const block = await client.getBlock({ blockTag: "latest" });
        if (block.timestamp >= BigInt(market.expiry)) throw new Error("Trading on this round has closed.");
        const deadline = roundTradeDeadline(block.timestamp, BigInt(market.expiry), windowSecs);
        const fn = open.mode === "buy" ? "quoteBuy" : "quoteSell";
        const [out] = (await client.readContract({ address: C.MarketsV4, abi: marketsV4Abi, functionName: fn, args: [market.marketId, outcome, v] })) as readonly [bigint, bigint];
        if (out === 0n) throw new Error(open.mode === "buy" ? "That amount is too small to buy any shares." : "That is too few shares to sell.");
        if (out < shownFloor) {
          throw new Error(`The price moved since the quote: you would now get ${fmt(out, 4)}, below the minimum you saw (${fmt(shownFloor, 4)}). Check the new quote and try again.`);
        }
        if (open.mode === "buy") {
          if (viaSession) return ses!.send("buyFor", [ses!.owner!, market.marketId, outcome, v, shownFloor, deadline]);
          await tx.ensureSpender(v);
          return tx.send(C.MarketsV4, marketsV4Abi, "buy", [market.marketId, outcome, v, shownFloor, deadline]);
        }
        if (viaSession) return ses!.send("sellFor", [ses!.owner!, market.marketId, outcome, v, shownFloor, deadline]);
        return tx.send(C.MarketsV4, marketsV4Abi, "sell", [market.marketId, outcome, v, shownFloor, deadline]);
      },
      `${verb}.`,
      viaSession,
    );
    if (ok) setAmt("");
  }

  const presets = open.mode === "buy" ? ["1", "5", "10"] : [];
  return (
    <div className="mt-3 rounded-xl border border-line bg-bg p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <div className="inline-flex overflow-hidden rounded-full border border-line" role="group" aria-label="Buy or sell">
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
        <div className="inline-flex overflow-hidden rounded-full border border-line" role="group" aria-label="Side">
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
        <div className="pu-input flex flex-1 items-center">
          <input
            value={amt}
            onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            placeholder="0.00"
            aria-label={open.mode === "buy" ? "USDC to spend" : `${label} shares to sell`}
            className="tnum pu-h w-full bg-transparent py-2 text-[22px] outline-none"
          />
          <span className="text-[13px] text-fg-dim">{open.mode === "buy" ? "USDC" : "shares"}</span>
        </div>
        {presets.map((p) => (
          <button key={p} onClick={() => setAmt(p)} className="tnum rounded-[10px] border border-line bg-bg-elev px-3 text-[13px] text-fg-mute hover:border-line-strong hover:text-fg">
            {p}
          </button>
        ))}
        {open.mode === "sell" && (
          <button onClick={() => setAmt(formatUsdc(held, 6))} disabled={held === 0n} className="rounded-[10px] border border-line bg-bg-elev px-3 text-[13px] text-fg-mute hover:border-line-strong hover:text-fg disabled:opacity-40">
            All
          </button>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] text-fg-dim sm:grid-cols-4">
        <div>
          <dt>You get about</dt>
          <dd className="tnum text-[13px] text-fg">
            {buyQ ? `${fmt(buyQ.sharesOut, 4)} ${label}` : sellQ ? `${fmt(sellQ.collateralOut, 4)} USDC` : "—"}
          </dd>
        </div>
        <div>
          <dt>Avg price</dt>
          <dd className="tnum text-[13px] text-fg">
            {buyQ ? `${(buyQ.avgPrice * 100).toFixed(1)}¢ · pays ${fmt(buyQ.sharesOut, 2)} if ${label}` : sellQ ? `${(sellQ.avgPrice * 100).toFixed(1)}¢` : "—"}
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
      {buyQ && impact > 0.05 && (
        <p className="mt-2 text-[13px] text-down" role="note">
          Large for this pool: you pay {(buyQ.avgPrice * 100).toFixed(1)}¢ a share on average against {(buyQ.priceBefore * 100).toFixed(0)}¢ now
          (+{(impact * 100).toFixed(0)}%). A smaller amount gets a better price.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 text-[13px] text-fg-dim" role="group" aria-label="Slippage tolerance">
          Slippage
          {SLIPPAGES.map((s) => (
            <button
              key={String(s)}
              aria-pressed={slip === s}
              onClick={() => setSlip(s)}
              className={`tnum rounded-full border px-2 py-0.5 ${slip === s ? "border-accent text-accent" : "border-line hover:text-fg"}`}
            >
              {Number(s) / 100}%
            </button>
          ))}
        </div>
        <span className="text-[13px] text-fg-dim">
          {windowSecs === ROUND_TRADE_WINDOW_SECS
            ? "Fills within 2 minutes and before the close, or not at all."
            : `Fills within ${Number(windowSecs) / 60} minutes, or not at all.`}
        </span>
        <button
          onClick={submit}
          disabled={busy || !canTrade}
          className={`pu-btn is-active ml-auto text-[14px] disabled:opacity-40 ${open.side === "yes" ? "pu-btn--up" : "pu-btn--down"}`}
        >
          {tx.st.pending === open.mode && tx.st.scope === scope
            ? open.mode === "buy"
              ? "Buying…"
              : "Selling…"
            : `${oneClick ? "⚡ " : ""}${open.mode === "buy" ? `Buy ${label}${value ? ` for ${fmt(value)} USDC` : ""}` : `Sell ${label}`}`}
          {oneClick && <span className="sr-only"> (one-click: sends immediately, no wallet confirmation)</span>}
        </button>
      </div>
      {!canTrade && <p className="mt-2 text-[13px] text-fg-dim">Connect a wallet on {D.label} to trade.</p>}
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
    change: m.change,
    roundSecs: D.roundSecs,
  });
}

// ───────────────────────────── claims ─────────────────────────────

function Claims({ snap, tx, now }: { snap?: Snapshot; tx: Tx; now: number }) {
  const ses = useContext(SessionCtx);
  if (!snap) return null;
  const known = snap.markets.filter((m) => snap.redeemable[m.marketId] !== undefined);
  const claims = claimList(known, snap.redeemable);
  const toSettle = snap.markets.filter((m) => snap.settleable[m.marketId]);
  const rows = new Set([...toSettle.map((m) => `settle:${m.marketId}`), ...claims.map((c) => `claim:${c.market.marketId}`)]);
  const orphan = tx.st.scope && /^(claim|settle):/.test(tx.st.scope) && !rows.has(tx.st.scope) ? tx.st.scope : undefined;
  const assetOf = (key: string) => D.assets.find((a) => a.key === key);
  const eventOf = (key: string) => D.events.find((e) => e.key === key);
  return (
    <section className="mt-10" aria-labelledby="claims-h">
      <h2 id="claims-h" className="pu-h mb-3 text-[24px] leading-none">
        Your claims
      </h2>
      {toSettle.length > 0 && (
        <ul className="mb-3 overflow-hidden rounded-2xl border border-accent bg-bg-elev" aria-label="Markets you can settle">
          {toSettle.map((m) => {
            const how = snap.settleable[m.marketId];
            const scope = `settle:${m.marketId}`;
            const a = assetOf(m.key);
            return (
              <li key={m.marketId} className="border-b border-line px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1 text-[14px]">
                    {a ? `${a.symbol} · ${roundLabel(roundWindow(m).start, roundWindow(m).end)}` : eventOf(m.key)?.question ?? m.key}
                    <div className="text-[13px] text-fg-dim">
                      {how === "resolve"
                        ? "Its reading is final but the market is not resolved yet. Anyone may resolve it."
                        : "No reading landed in time: it voids and every trader gets their net cost back. Anyone may void it."}
                    </div>
                  </div>
                  <button
                    disabled={Boolean(tx.st.pending)}
                    onClick={() =>
                      void tx.run(
                        scope,
                        how,
                        () => tx.send(C.MarketsV4, marketsV4Abi, how === "resolve" ? "resolve" : "voidMarket", [m.marketId]),
                        how === "resolve" ? "Resolved: redeem it below." : "Voided: redeem your refund below.",
                      )
                    }
                    className="pu-btn pu-btn--quiet is-active text-[13px] disabled:opacity-50"
                  >
                    {tx.st.pending === how && tx.st.scope === scope ? "Confirm in wallet…" : how === "resolve" ? "Resolve now" : "Void and refund"}
                  </button>
                </div>
                <TxLine tx={tx} scope={scope} />
              </li>
            );
          })}
        </ul>
      )}
      {orphan && (
        // A redeemed claim (or a resolved/voided market) leaves its list: keep its
        // confirmation - or error - on screen here instead of losing it with the row.
        <div className="mb-3 rounded-2xl border border-line bg-bg-elev px-4 py-1">
          <TxLine tx={tx} scope={orphan} />
        </div>
      )}
      {claims.length === 0 ? (
        <p className="pu-card pu-card--compact text-[13px] text-fg-dim">
          Nothing to redeem. Winning shares (and void refunds) from markets you traded show up here once they settle, and
          pay into your trading balance.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-line bg-bg-elev">
          {claims.map(({ market: m, amount }) => {
            const a = assetOf(m.key);
            const ev = eventOf(m.key);
            const s = statusFor(m, snap, now);
            const scope = `claim:${m.marketId}`;
            return (
              <li key={m.marketId} className="border-b border-line px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px]">{a ? `${a.symbol} · ${roundLabel(roundWindow(m).start, roundWindow(m).end)}` : ev?.question ?? m.key}</div>
                    <div className="text-[13px] text-fg-dim">
                      {s?.key === "voided" ? "Voided: your net cost comes back." : s?.key === "resolved-up" ? (a ? "Closed Up." : "Resolved Yes.") : a ? "Closed Down." : "Resolved No."}
                    </div>
                  </div>
                  <button
                    disabled={Boolean(tx.st.pending)}
                    onClick={() =>
                      void tx.run(
                        scope,
                        "redeem",
                        () =>
                          ses?.owner && ses.covers("redeem", 0n)
                            ? ses.send("redeemFor", [ses.owner, m.marketId])
                            : tx.send(C.MarketsV4, marketsV4Abi, "redeem", [m.marketId]),
                        `Redeemed ${fmt(amount)} USDC.`,
                        Boolean(ses?.owner && ses.covers("redeem", 0n)),
                      )
                    }
                    className="tnum pa-btn pu-btn pu-btn--primary"
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
    <section aria-labelledby="events-h">
      <h2 id="events-h" className="pu-h text-[30px] leading-none">
        Event markets
      </h2>
      <p className="mb-4 mt-2 max-w-[60ch] text-[13px] text-fg-mute">
        Longer questions on a curated feed. The team records the outcome with evidence when it happens; the market
        settles on the feed&apos;s reading at the deadline.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
  page = false,
}: {
  ev: EventMeta;
  snap?: Snapshot;
  now: number;
  open: OpenTrade;
  setOpen: (o: OpenTrade) => void;
  tx: Tx;
  canTrade: boolean;
  address?: Address;
  /** On its own page: a larger title, no link to itself. */
  page?: boolean;
}) {
  const openPage = useCardLink(eventHref(ev));
  const id = snap?.eventMarkets[ev.key];
  const st = id ? snap?.state[id] : undefined;
  const feed = snap?.book.byKey[ev.key];
  const market: RoundMarket | undefined =
    id && feed && st
      ? snap?.markets.find((m) => m.marketId === id) ?? {
          marketId: id,
          feedId: feed.feedId,
          key: ev.key,
          change: false,
          agent: D.agent,
          threshold: st.threshold,
          comparator: st.comparator,
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
    <article
      onClick={page ? undefined : openPage}
      className={`pu-card flex min-w-0 flex-col ${page ? "" : "cursor-pointer transition-colors"}`}
    >
      {ev.rehearsal && <div className="mb-2 text-[13px] text-accent">Testnet rehearsal of the settlement flow, short-dated.</div>}
      {page ? (
        <h1 className="pu-h text-[32px] leading-tight">{ev.question}</h1>
      ) : (
        <h3 className="pu-h text-[21px] leading-snug">
          <Link href={eventHref(ev)} className="hover:underline">
            {ev.question}
          </Link>
        </h3>
      )}
      <dl className="mt-3 grid gap-y-2 text-[13px] text-fg-dim">
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

      {!id && snap && <p className="mt-3 text-[13px] text-fg-dim">This market has not been opened yet.</p>}

      {st && market && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-[13px]">
            <span className="text-up">Yes {yesPct.toFixed(0)}%</span>
            <span className="text-down">{(100 - yesPct).toFixed(0)}% No</span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-down">
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
                    className={`pu-btn pu-btn--quiet text-[13px] ${isOpen && open?.mode === "sell" ? "is-active" : ""}`}
                  >
                    Sell
                  </button>
                  <span className="tnum ml-auto text-[13px] text-fg-dim">
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
              hold={hold ?? { yes: 0n, no: 0n, cost: 0n }}
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
                className="tnum pa-btn pa-btn--block pu-btn pu-btn--primary"
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

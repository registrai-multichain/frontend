"use client";

import { useState } from "react";
import useSWR from "swr";
import { parseAbi, type Address, type Hex } from "viem";
import { CopyButton } from "@/components/perennial/CopyButton";
import { useWallet } from "@/components/WalletProvider";
import { buildersClient } from "@/components/verify/useMyBuilder";
import { BUILDERS } from "@/lib/builders-network";
import { usdText } from "@/lib/plain-words";
import { pushToast } from "@/lib/toast-store";
import {
  BUYBACK, BUYBACK_DISCLOSURE, WALLETS, inflowLabel, BUYBACK_LOG_SCAN, LIVE_REFRESH_MS, buybackView, compactNumber, countdown, nextScanRanges, parseBuybackStatus, regiBuybackAbi, regiSplitterAbi,
} from "@/lib/transparency";
import { BIG, Donut } from "./parts";

const EXPLORER = BUILDERS.chain.explorer.url.replace(/\/$/, "");
const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const ledgerAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const USDC = "0x3600000000000000000000000000000000000000" as Address;
const SAFE = WALLETS.find((w) => w.isSafe)!.address;

interface BurnRow { tx: Hex; usdcIn: bigint; regiBurned: bigint; caller: Address; block: bigint }
interface InflowRow { tx: Hex; from: Address; value: bigint; block: bigint }

const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

/** Fast (every 10 s): the contract's status, the splitter's pending 40% and any repoint. A few calls, one batch. */
async function readStatus() {
  const c = buildersClient();
  const raw = await c.readContract({ address: BUYBACK.contract!, abi: regiBuybackAbi, functionName: "status" });
  let incoming = 0n;
  let pending: { next: Address; at: number } | null = null;
  let splitterTarget: Address | null = null;
  let onOwnLedger = 0n;
  if (BUYBACK.ledger) {
    // A NanoLedger payment to the buyback itself waits there until someone sweeps it in.
    onOwnLedger = await c.readContract({ address: BUYBACK.ledger, abi: ledgerAbi, functionName: "balanceOf", args: [BUYBACK.contract!] }).catch(() => 0n);
  }
  if (BUYBACK.splitter) {
    const [held, onLedger, next, since, target] = await Promise.all([
      c.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [BUYBACK.splitter] }).catch(() => 0n),
      BUYBACK.ledger
        ? c.readContract({ address: BUYBACK.ledger, abi: ledgerAbi, functionName: "balanceOf", args: [BUYBACK.splitter] }).catch(() => 0n)
        : Promise.resolve(0n),
      c.readContract({ address: BUYBACK.splitter, abi: regiSplitterAbi, functionName: "pendingBuyback" }),
      c.readContract({ address: BUYBACK.splitter, abi: regiSplitterAbi, functionName: "pendingSince" }),
      c.readContract({ address: BUYBACK.splitter, abi: regiSplitterAbi, functionName: "buyback" }),
    ]);
    splitterTarget = target;
    incoming = ((held + onLedger) * BigInt(BUYBACK.shareOfTreasuryPct)) / 100n;
    if (next !== "0x0000000000000000000000000000000000000000") pending = { next, at: Number(since) + 7 * 86_400 };
  }
  return { status: parseBuybackStatus(raw), incoming: incoming + onOwnLedger, pending, splitterTarget };
}

/**
 * Slow (every 5 min, and right after a press): recent burns and USDC inflows. Scanned
 * incrementally: the first read walks back up to BUYBACK_LOG_SCAN.maxBack windows, later
 * reads only the new blocks. A failed window stops the scan there (no gap, retried next
 * time) and marks the lists partial instead of failing the whole panel.
 */
const history: { scannedTo: bigint | null; burns: BurnRow[]; inflows: InflowRow[] } = { scannedTo: null, burns: [], inflows: [] };

async function readHistory() {
  const c = buildersClient();
  const bb = BUYBACK.contract!;
  const head = await c.getBlockNumber();
  const floor = BUYBACK.deployBlock ?? 0n;
  const first = history.scannedTo === null;
  let partial = false;
  let reached: bigint | null = history.scannedTo;
  for (const [fromBlock, toBlock] of nextScanRanges(head, history.scannedTo, floor, BUYBACK_LOG_SCAN.window, BUYBACK_LOG_SCAN.maxBack)) {
    try {
      const [burns, inflows] = await Promise.all([
        c.getContractEvents({ address: bb, abi: regiBuybackAbi, eventName: "Burned", fromBlock, toBlock }),
        c.getContractEvents({ address: USDC, abi: transferAbi, eventName: "Transfer", args: { to: bb }, fromBlock, toBlock }),
      ]);
      const b = burns.map((l) => ({ tx: l.transactionHash!, usdcIn: l.args.usdcIn!, regiBurned: l.args.regiBurned!, caller: l.args.caller!, block: l.blockNumber! }));
      const f = inflows.map((l) => ({ tx: l.transactionHash!, from: l.args.from!, value: l.args.value!, block: l.blockNumber! }));
      history.burns = [...history.burns, ...b].sort((x, y) => Number(y.block - x.block)).slice(0, 10);
      history.inflows = [...history.inflows, ...f].sort((x, y) => Number(y.block - x.block)).slice(0, 10);
      // First scan goes newest -> oldest: the head is covered once the newest window is in.
      if (first) reached = head;
      else reached = toBlock;
    } catch {
      partial = true;
      break;
    }
  }
  history.scannedTo = reached;
  return { burns: history.burns, inflows: history.inflows, partial };
}

export function BuybackPanel() {
  const opts = { revalidateOnFocus: false, errorRetryCount: 4, errorRetryInterval: 8_000 };
  const { data: live, error, mutate } = useSWR(BUYBACK.contract ? ["buyback-status", BUYBACK.contract] : null, readStatus, {
    ...opts, refreshInterval: LIVE_REFRESH_MS.fast,
  });
  const { data: hist, mutate: mutateHistory } = useSWR(BUYBACK.contract ? ["buyback-history", BUYBACK.contract] : null, readHistory, {
    ...opts, refreshInterval: LIVE_REFRESH_MS.slow,
  });
  const data = live && { ...live, burns: hist?.burns ?? [], inflows: hist?.inflows ?? [] };
  const { address, connect, walletClient, walletChainId, switchChain } = useWallet();
  const [busy, setBusy] = useState<"burn" | "distribute" | null>(null);
  const v = buybackView(data?.status ?? null, Math.floor(Date.now() / 1000), data?.incoming ?? 0n);

  async function send(kind: "burn" | "distribute") {
    if (!address || !walletClient) return connect();
    setBusy(kind);
    try {
      if (walletChainId !== BUILDERS.chainId) await switchChain(BUILDERS.chainId);
      const hash = kind === "burn"
        ? await walletClient.writeContract({ address: BUYBACK.contract!, abi: regiBuybackAbi, functionName: "burnChunk", account: address as Address, chain: BUILDERS.chain.viemChain })
        : await walletClient.writeContract({ address: BUYBACK.splitter!, abi: regiSplitterAbi, functionName: "distribute", account: address as Address, chain: BUILDERS.chain.viemChain });
      // A slow confirmation isn't a failure: the transaction was sent and may still land.
      const rc = await buildersClient().waitForTransactionReceipt({ hash }).catch(() => null);
      pushToast(rc === null
        ? { kind: "info", text: "Sent. Still waiting for it to confirm; the figures update when it does.", href: `${EXPLORER}/tx/${hash}` }
        : rc.status === "success"
          ? { kind: "ok", text: kind === "burn" ? "Bought REGI and burned it." : "Fees distributed: 40% went to the buyback.", href: `${EXPLORER}/tx/${hash}` }
          : { kind: "error", text: "The transaction reverted.", href: `${EXPLORER}/tx/${hash}` });
      await Promise.all([mutate(), mutateHistory()]);
    } catch (e) {
      pushToast({ kind: "error", text: (e as Error).message.split("\n")[0] });
    } finally {
      setBusy(null);
    }
  }

  const ringLabel = v.roundChunk > 0 ? `Chunk ${v.roundChunk} of ${BUYBACK.chunks}` : `${v.progressPct}% of $${BUYBACK.triggerUsdc}`;
  return (
    <section className="pa-stack" aria-labelledby="t-buyback">
      <h2 id="t-buyback" className="pa-h2">REGI buyback</h2>
      {BUYBACK.contract && error && !live && (
        <p className="pa-notice" data-tone="down">Couldn&apos;t read the buyback contract right now. Retrying; the figures below are not live.</p>
      )}
      <div className="pa-card flex flex-col items-center gap-6 sm:flex-row sm:gap-10">
        <Donut label={`Buyback: ${ringLabel}`} size={168} stroke={20}
          parts={[{ key: "in", share: v.progressPct, color: "var(--accent)" }, { key: "left", share: 100 - v.progressPct, color: "var(--line)" }]}>
          <b className="pa-serif tnum" style={{ fontSize: 30, lineHeight: 1, fontWeight: 400 }}>{usdText(v.collected)}</b>
          <span className="pa-muted pa-small">{v.roundChunk > 0 ? `chunk ${v.roundChunk} of ${BUYBACK.chunks}` : `of $${BUYBACK.triggerUsdc}`}</span>
        </Donut>
        <div className="flex w-full flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1"><span className="pa-muted pa-small">Bought back</span><b className="pa-serif tnum" style={BIG}>{usdText(v.spent)}</b></div>
            <div className="flex flex-col gap-1"><span className="pa-muted pa-small">REGI burned</span><b className="pa-serif tnum" style={BIG}>{compactNumber(Number(v.burned / 10n ** 18n))}</b></div>
            <div className="flex flex-col gap-1"><span className="pa-muted pa-small">Buys</span><b className="pa-serif tnum" style={BIG}>{v.chunks}</b></div>
          </div>
          {BUYBACK.contract && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="pa-btn" disabled={v.phase !== "ready" || busy !== null} onClick={() => send("burn")}>
                {busy === "burn" ? "Burning…" : `Buy & burn $${BUYBACK.chunkUsdc}`}
              </button>
              <span className="pa-muted pa-small">
                {v.phase === "ready" && "Ready: anyone can press it."}
                {v.phase === "cooldown" && `Next chunk in ${countdown(v.secondsToNext)}.`}
                {v.phase === "collecting" && `${usdText(v.collected)} of $${BUYBACK.triggerUsdc} collected.`}
                {v.incoming > 0n && ` ${usdText(v.incoming)} on its way in (the splitter's 40% and any ledger payments).`}
              </span>
              {v.incoming > 0n && BUYBACK.splitter && (
                <button type="button" className="pa-btn" data-variant="ghost" disabled={busy !== null} onClick={() => send("distribute")}>
                  {busy === "distribute" ? "Distributing…" : "Distribute"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {BUYBACK.contract ? (
        <p className="pa-muted pa-small break-all">
          Anyone can send USDC to the buyback, <a className="pa-link pa-mono" href={`${EXPLORER}/address/${BUYBACK.contract}`} target="_blank" rel="noreferrer">{BUYBACK.contract}</a>{" "}
          <CopyButton text={BUYBACK.contract} />: every dollar is spent on REGI and burned under the same rules. {BUYBACK_DISCLOSURE}
          {BUYBACK.splitter && (
            <>
              {" "}The splitter is{" "}
              <a className="pa-link pa-mono" href={`${EXPLORER}/address/${BUYBACK.splitter}`} target="_blank" rel="noreferrer">{BUYBACK.splitter}</a>
              {live?.splitterTarget && (
                <>
                  ; it sends its 40% to{" "}
                  {live.splitterTarget.toLowerCase() === BUYBACK.contract.toLowerCase() ? "this buyback" : <span className="pa-mono">{live.splitterTarget}</span>}
                </>
              )}
              .
            </>
          )}
        </p>
      ) : (
        <p className="pa-muted pa-small max-w-[70ch]">
          {BUYBACK.shareOfTreasuryPct}% of the treasury&apos;s income goes to a buyback contract with no owner and no withdraw. Anyone can
          send it more USDC. Once it holds ${BUYBACK.triggerUsdc}, it buys REGI in {BUYBACK.chunks} pieces of ${BUYBACK.chunkUsdc},{" "}
          {BUYBACK.cooldownMin} minutes apart, and every token goes straight to the burn address. Anyone can press the button that runs
          a buy. It starts with common markets on {BUILDERS.label}; until then these read zero. {BUYBACK_DISCLOSURE}
        </p>
      )}
      {hist?.partial && (
        <p className="pa-muted pa-small">Some older history couldn&apos;t be read just now; the lists below may be incomplete.</p>
      )}
      {data && data.burns.length > 0 && (
        <ul className="pa-card">
          {data.burns.map((b) => (
            <li key={b.tx} className="pa-kv">
              <span>{usdText(b.usdcIn)} → {compactNumber(Number(b.regiBurned / 10n ** 18n))} REGI</span>
              <a className="pa-link" href={`${EXPLORER}/tx/${b.tx}`} target="_blank" rel="noreferrer">burn ↗</a>
            </li>
          ))}
        </ul>
      )}
      {data?.pending && (
        <p className="pa-notice" data-tone="down">
          The Safe proposed sending the buyback&apos;s 40% to <span className="pa-mono">{data.pending.next}</span>. It takes effect{" "}
          {new Date(data.pending.at * 1000).toUTCString()} unless cancelled.
        </p>
      )}
      {data && data.inflows.length > 0 && (
        <ul className="pa-card">
          {data.inflows.map((f) => (
            <li key={f.tx} className="pa-kv">
              <span>
                {usdText(f.value)} from{" "}
                {inflowLabel(f.from, { splitter: BUYBACK.splitter, safe: SAFE, ledger: BUYBACK.ledger })}
              </span>
              <a className="pa-link" href={`${EXPLORER}/tx/${f.tx}`} target="_blank" rel="noreferrer">tx ↗</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

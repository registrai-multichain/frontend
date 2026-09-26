"use client";

import { useState } from "react";
import useSWR from "swr";
import { parseAbi, type Address, type Hex } from "viem";
import { useWallet } from "@/components/WalletProvider";
import { buildersClient } from "@/components/verify/useMyBuilder";
import { BUILDERS } from "@/lib/builders-network";
import { usdText } from "@/lib/plain-words";
import { pushToast } from "@/lib/toast-store";
import {
  BUYBACK, buybackView, compactNumber, countdown, logWindows, parseBuybackStatus, regiBuybackAbi, regiSplitterAbi,
} from "@/lib/transparency";
import { BIG, Donut } from "./parts";

const EXPLORER = BUILDERS.chain.explorer.url.replace(/\/$/, "");
const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const ledgerAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const USDC = "0x3600000000000000000000000000000000000000" as Address;

interface BurnRow { tx: Hex; usdcIn: bigint; regiBurned: bigint; caller: Address }

async function readBuyback() {
  const c = buildersClient();
  const bb = BUYBACK.contract!;
  const raw = await c.readContract({ address: bb, abi: regiBuybackAbi, functionName: "status" });
  let incoming = 0n;
  if (BUYBACK.splitter) {
    const held = await c.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [BUYBACK.splitter] }).catch(() => 0n);
    const onLedger = BUYBACK.ledger
      ? await c.readContract({ address: BUYBACK.ledger, abi: ledgerAbi, functionName: "balanceOf", args: [BUYBACK.splitter] }).catch(() => 0n)
      : 0n;
    incoming = ((held + onLedger) * BigInt(BUYBACK.shareOfTreasuryPct)) / 100n;
  }
  // Recent burns: walk back in 5,000-block windows (Arc's RPC caps getLogs), at most 10 windows.
  const head = await c.getBlockNumber();
  const burns: BurnRow[] = [];
  for (const [fromBlock, toBlock] of logWindows(head, BUYBACK.deployBlock ?? head - 50_000n, 5_000n, 10)) {
    const logs = await c.getContractEvents({ address: bb, abi: regiBuybackAbi, eventName: "Burned", fromBlock, toBlock });
    for (const l of logs.reverse()) burns.push({ tx: l.transactionHash!, usdcIn: l.args.usdcIn!, regiBurned: l.args.regiBurned!, caller: l.args.caller! });
    if (burns.length >= 10) break;
  }
  // Recent inflows: USDC Transfer logs INTO the buyback (a native send may not emit one on Arc;
  // those still count in the balance, just not in this list).
  const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
  const inflows: { tx: Hex; from: Address; value: bigint }[] = [];
  for (const [fromBlock, toBlock] of logWindows(head, BUYBACK.deployBlock ?? head - 50_000n, 5_000n, 10)) {
    const logs = await c.getContractEvents({ address: USDC, abi: transferAbi, eventName: "Transfer", args: { to: bb }, fromBlock, toBlock });
    for (const l of logs.reverse()) inflows.push({ tx: l.transactionHash!, from: l.args.from!, value: l.args.value! });
    if (inflows.length >= 10) break;
  }
  let pending: { next: Address; at: number } | null = null;
  if (BUYBACK.splitter) {
    const [next, since] = await Promise.all([
      c.readContract({ address: BUYBACK.splitter, abi: regiSplitterAbi, functionName: "pendingBuyback" }),
      c.readContract({ address: BUYBACK.splitter, abi: regiSplitterAbi, functionName: "pendingSince" }),
    ]);
    if (next !== "0x0000000000000000000000000000000000000000") pending = { next, at: Number(since) + 7 * 86_400 };
  }
  return { status: parseBuybackStatus(raw), incoming, burns: burns.slice(0, 10), inflows: inflows.slice(0, 10), pending };
}

export function BuybackPanel() {
  const { data, mutate } = useSWR(BUYBACK.contract ? ["buyback", BUYBACK.contract] : null, readBuyback, {
    refreshInterval: 30_000, revalidateOnFocus: false, errorRetryCount: 4, errorRetryInterval: 8_000,
  });
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
      const rc = await buildersClient().waitForTransactionReceipt({ hash });
      pushToast(rc.status === "success"
        ? { kind: "ok", text: kind === "burn" ? "Bought REGI and burned it." : "Fees distributed: 40% went to the buyback.", href: `${EXPLORER}/tx/${hash}` }
        : { kind: "error", text: "The transaction reverted.", href: `${EXPLORER}/tx/${hash}` });
      await mutate();
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
                {v.incoming > 0n && ` ${usdText(v.incoming)} on its way from the splitter.`}
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
          Anyone can send USDC to the buyback, <a className="pa-link pa-mono" href={`${EXPLORER}/address/${BUYBACK.contract}`} target="_blank" rel="noreferrer">{BUYBACK.contract}</a>: every dollar is spent on REGI and burned under the same rules.
        </p>
      ) : (
        <p className="pa-muted pa-small max-w-[70ch]">
          {BUYBACK.shareOfTreasuryPct}% of the treasury&apos;s income goes to a buyback contract with no owner and no withdraw. Anyone can
          send it more USDC. Once it holds ${BUYBACK.triggerUsdc}, it buys REGI in {BUYBACK.chunks} pieces of ${BUYBACK.chunkUsdc},{" "}
          {BUYBACK.cooldownMin} minutes apart, and every token goes straight to the burn address. Anyone can press the button that runs
          a buy. It starts with common markets on {BUILDERS.label}; until then these read zero.
        </p>
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
                {f.from.toLowerCase() === BUYBACK.splitter?.toLowerCase() ? "the splitter (40% of treasury income)" : <span className="pa-mono">{f.from}</span>}
              </span>
              <a className="pa-link" href={`${EXPLORER}/tx/${f.tx}`} target="_blank" rel="noreferrer">tx ↗</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, http, type Address, type Hash } from "viem";
import { InfoBubble } from "@/components/InfoBubble";
import { useWallet } from "@/components/WalletProvider";
import { ARC_RPC_URL, fmtRegi, REGI_ADDRESS, type PilotAccountView } from "@/lib/abi-pilot-api";
import { PILOT_COPY } from "@/lib/abi-pilot-copy";
import { defaultLock, LOCK_FACTORY_ABI, leverageUnlocked, NO_CHAIN, parseRegi, REGI_ABI, regiInput, usdOf, VAULT_ABI, type LockChain } from "@/lib/abi-pilot-lock";
import { ARC_MAINNET } from "@/lib/chains";

/** The lock reads refresh this often while the page is visible (and after every transaction). */
const LOCK_POLL_MS = 60_000;
const ZERO = /^0x0{40}$/i;

export type LockAction = "lock" | "withdraw" | "claim";
export interface LockTx {
  action: LockAction;
  /** approve / confirm: waiting for the wallet; waiting: sent, waiting for 1 confirmation. */
  stage: "approve" | "confirm" | "waiting" | "done" | "failed";
  error?: string;
}

export interface RegiLockProps {
  view: PilotAccountView;
  chain: LockChain;
  tx: LockTx | null;
  /** The connected wallet is the signed-in one: transactions are sent from it. */
  walletMatches: boolean;
  onLock: (amount: bigint) => void;
  onWithdraw: () => void;
  onClaim: () => void;
}

const DONE: Record<LockAction, string> = { lock: PILOT_COPY.txLocked, withdraw: PILOT_COPY.txWithdrawn, claim: PILOT_COPY.txClaimed };
function txLine(tx: LockTx): string {
  if (tx.stage === "approve") return PILOT_COPY.txApprove;
  if (tx.stage === "confirm") return PILOT_COPY.txConfirm;
  if (tx.stage === "waiting") return PILOT_COPY.txWaiting;
  if (tx.stage === "done") return DONE[tx.action];
  return tx.error ?? PILOT_COPY.txFailed;
}
export const txBusy = (tx: LockTx | null) => tx !== null && (tx.stage === "approve" || tx.stage === "confirm" || tx.stage === "waiting");

/**
 * The REGI lock box under the ticket (plan 2026-10-13 R6): locked REGI and its dollar amount at the 24 h median,
 * whether leverage is unlocked, and Lock / Withdraw / Claim from the signed-in wallet. The owner's line sits next to
 * the lock button and the withdrawal warning next to Withdraw, always visible.
 */
export function RegiLock({ view, chain, tx, walletMatches, onLock, onWithdraw, onClaim }: RegiLockProps) {
  const [text, setText] = useState<string | null>(null);
  const live = view.lockFactory !== null;
  const need = view.lockRegi === null ? null : BigInt(view.lockRegi);
  const unlocked = leverageUnlocked(view, chain);
  const busy = txBusy(tx);
  const def = defaultLock(view.lockRegi, chain.locked);
  const shown = text ?? (def > 0n ? regiInput(def) : "");
  const amount = parseRegi(shown);
  const short = amount !== null && chain.regi !== null && amount > chain.regi;
  const hasLock = chain.locked !== null && chain.locked > 0n;
  const usd = chain.locked === null ? null : usdOf(chain.locked, view.price);
  const leverage = unlocked ? "Unlocked" : !live ? "1× only" : need === null ? PILOT_COPY.regiPriceUpdating : `Needs ${fmtRegi(need, true)} locked`;
  return (
    <section className="abi-pt abi-pt-lock" aria-label={PILOT_COPY.lockHeading}>
      <div className="abi-pt-row">
        <h3 className="abi-pt-h3">{PILOT_COPY.lockHeading}</h3>
        <InfoBubble label="About the REGI lock">{PILOT_COPY.lockTip(view.lockUsd)}</InfoBubble>
      </div>
      <dl className="abi-kv abi-pt-kv">
        <dt>Locked</dt>
        <dd>{chain.locked === null ? "–" : `${fmtRegi(chain.locked)}${usd ? ` ${usd}` : ""}`}</dd>
        <dt>Leverage</dt>
        <dd>{leverage}</dd>
      </dl>
      {!live ? (
        <p className="abi-pt-note">{PILOT_COPY.lockNotLive}</p>
      ) : (
        <>
          <label className="abi-pt-field">
            <span>Amount</span>
            <span className="abi-pt-input">
              <input type="text" inputMode="decimal" value={shown} onChange={(e) => setText(e.target.value)} aria-label="REGI to lock" />
              <span className="u">REGI</span>
            </span>
          </label>
          <div className="abi-pt-row">
            <button type="button" className="abi-pt-primary" disabled={busy || !walletMatches || amount === null || short} onClick={() => { if (amount !== null) onLock(amount); }}>{PILOT_COPY.lockButton}</button>
          </div>
          <p className="abi-pt-note">{PILOT_COPY.lockNote}</p>
          <div className="abi-pt-row abi-pt-lock-acts">
            <button type="button" className="abi-pt-close" disabled={busy || !walletMatches || !hasLock} onClick={onWithdraw}>{PILOT_COPY.withdrawButton}</button>
            <button type="button" className="abi-pt-close" disabled={busy || !walletMatches || chain.vault === null} onClick={onClaim}>{PILOT_COPY.claimButton}</button>
            <InfoBubble label="About holder distributions">{PILOT_COPY.claimTip}</InfoBubble>
          </div>
          <p className="abi-pt-warn">{PILOT_COPY.withdrawWarn}</p>
          {!walletMatches && <p className="abi-pt-note" role="status">{PILOT_COPY.wrongWallet}</p>}
          {walletMatches && short && <p className="abi-pt-note" role="status">{PILOT_COPY.notEnoughRegi}</p>}
          {tx && <p className={tx.stage === "failed" ? "abi-pt-err" : "abi-pt-note"} role="status">{txLine(tx)}</p>}
        </>
      )}
    </section>
  );
}

const txError = (e: unknown) => {
  const msg = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? "";
  return /reject|denied|cancel/i.test(msg) ? "Cancelled in your wallet." : msg || PILOT_COPY.txFailed;
};

/**
 * The lock's reads (the signed-in wallet's REGI, lockedOf, vaultOf, the factory's allowance; Arc mainnet, from the
 * browser) and its transactions, sent from the connected injected wallet (EIP-6963, the panel's wallet) on Arc
 * mainnet, each waited for 1 confirmation; then the reads and the account view (onDone) refresh.
 */
export function useRegiLock(view: PilotAccountView | null, onDone: () => void) {
  const { address, walletClient, walletChainId, switchChain } = useWallet();
  const pc = useMemo(() => createPublicClient({ chain: ARC_MAINNET.viemChain, transport: http(ARC_RPC_URL) }), []);
  const [chain, setChain] = useState<LockChain>(NO_CHAIN);
  const [tx, setTx] = useState<LockTx | null>(null);
  const me = (view?.address ?? null) as Address | null;
  const factory = (view?.lockFactory ?? null) as Address | null;

  const read = useCallback(async () => {
    if (!me) { setChain(NO_CHAIN); return; }
    const safe = <T,>(p: Promise<T>) => p.catch(() => null);
    const [regi, locked, vault, allowance] = await Promise.all([
      safe(pc.readContract({ address: REGI_ADDRESS, abi: REGI_ABI, functionName: "balanceOf", args: [me] })),
      factory ? safe(pc.readContract({ address: factory, abi: LOCK_FACTORY_ABI, functionName: "lockedOf", args: [me] })) : null,
      factory ? safe(pc.readContract({ address: factory, abi: LOCK_FACTORY_ABI, functionName: "vaultOf", args: [me] })) : null,
      factory ? safe(pc.readContract({ address: REGI_ADDRESS, abi: REGI_ABI, functionName: "allowance", args: [me, factory] })) : null,
    ]);
    setChain({ regi, locked, vault: vault && !ZERO.test(vault) ? vault : null, allowance });
  }, [pc, me, factory]);

  useEffect(() => {
    void read();
    if (!me) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void read(); }, LOCK_POLL_MS);
    return () => clearInterval(t);
  }, [read, me]);

  const walletMatches = Boolean(address && me && address.toLowerCase() === me);

  const act = async (action: LockAction, body: (send: (stage: "approve" | "confirm", write: () => Promise<Hash>) => Promise<void>) => Promise<void>) => {
    if (!walletClient || !walletMatches || !me || !factory || txBusy(tx)) return;
    const send = async (stage: "approve" | "confirm", write: () => Promise<Hash>) => {
      setTx({ action, stage });
      const hash = await write();
      setTx({ action, stage: "waiting" });
      const r = await pc.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (r.status !== "success") throw new Error(PILOT_COPY.txFailed);
    };
    try {
      if (walletChainId !== ARC_MAINNET.id) await switchChain(ARC_MAINNET.id);
      await body(send);
      setTx({ action, stage: "done" });
    } catch (e) {
      setTx({ action, stage: "failed", error: txError(e) });
    }
    await read();
    onDone();
  };
  const arc = ARC_MAINNET.viemChain;

  const lock = (amount: bigint) => void act("lock", async (send) => {
    const allowance = await pc.readContract({ address: REGI_ADDRESS, abi: REGI_ABI, functionName: "allowance", args: [me!, factory!] });
    if (allowance < amount) await send("approve", () => walletClient!.writeContract({ address: REGI_ADDRESS, abi: REGI_ABI, functionName: "approve", args: [factory!, amount], chain: arc, account: me! }));
    await send("confirm", () => walletClient!.writeContract({ address: factory!, abi: LOCK_FACTORY_ABI, functionName: "lock", args: [amount], chain: arc, account: me! }));
  });
  const vaultNow = async () => {
    const v = await pc.readContract({ address: factory!, abi: LOCK_FACTORY_ABI, functionName: "vaultOf", args: [me!] });
    if (ZERO.test(v)) throw new Error("No vault yet.");
    return v;
  };
  /** Everything in the vault, back to the wallet (R6: withdraw(all, self)). */
  const withdraw = () => void act("withdraw", async (send) => {
    const vault = await vaultNow();
    const all = await pc.readContract({ address: factory!, abi: LOCK_FACTORY_ABI, functionName: "lockedOf", args: [me!] });
    if (all === 0n) throw new Error("Nothing locked.");
    await send("confirm", () => walletClient!.writeContract({ address: vault, abi: VAULT_ABI, functionName: "withdraw", args: [all, me!], chain: arc, account: me! }));
  });
  const claim = () => void act("claim", async (send) => {
    const vault = await vaultNow();
    await send("confirm", () => walletClient!.writeContract({ address: vault, abi: VAULT_ABI, functionName: "claimRewards", args: [me!], chain: arc, account: me! }));
  });

  return { chain, tx, walletMatches, lock, withdraw, claim };
}

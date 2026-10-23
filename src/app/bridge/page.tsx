"use client";

/**
 * USDC bridge — every configured CCTP chain, in every valid direction.
 *
 * Real burn-and-mint through Circle's own contracts. We hold no liquidity and
 * custody nothing between transactions; every transfer emits `DepositForBurn`
 * from Circle's contract, which anyone can verify in an explorer. That
 * verifiability is the point, given how many "Arc bridge" sites took deposits
 * and never burned anything.
 *
 * The last mile is the user's own: on EVM destinations their wallet submits
 * Circle's receiveMessage (paying destination gas — USDC on Arc); Solana routes
 * use Circle's Forwarding Service. No Registrai relayer sits in the path. An
 * interrupted transfer is never lost — the burn and attestation stay valid
 * indefinitely and can be resumed from the burn hash, which is why every
 * in-flight transfer is persisted locally.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, type Hex } from "viem";
import { BridgeShell } from "@/components/BridgeShell";
import {
  ARC,
  BRIDGE_CHAINS,
  BRIDGE_ROUTER,
  CCTP_CHAINS,
  MESSAGE_TRANSMITTER_V2,
  SOLANA,
  TOKEN_MESSENGER_V2,
  isEvmChain,
  isSolanaChain,
  type BridgeChain,
  type CctpChain,
  forwardingServiceFee,
} from "@/lib/cctp/domains";
import {
  DIRECT_ROUTE,
  approvalCalldata,
  bridgeCalldata,
  directBridgeCalldata,
  maxFeeFor,
  quoteBridge,
  receiveCalldata,
  resolveRoute,
  waitForAttestation,
  type Quote,
  type Route,
  type Speed,
} from "@/lib/cctp/bridge";
import {
  readAllowance,
  readUsdcBalance,
  useBridgeWallet,
  waitForReceipt,
} from "@/lib/cctp/useBridge";
import {
  connectSolanaProvider,
  detectSolanaProvider,
  runCircleBridge,
  validRecipient,
  type InjectedSolanaProvider,
} from "@/lib/cctp/solanaBridge";

const PENDING_KEY = "registrai.bridge.pending.v1";

type Pending = {
  burnTx: Hex;
  fromKey: string;
  toKey: string;
  amount: string;
  at: number;
};

type Step =
  | { kind: "idle" }
  | { kind: "approving" }
  | { kind: "burning" }
  | { kind: "attesting"; burnTx: Hex; status: string; elapsedMs: number }
  | { kind: "minting"; burnTx: Hex }
  | { kind: "done"; burnTx: Hex; mintTx: Hex }
  | { kind: "circle"; status: string }
  | {
      kind: "circleDone";
      sourceUrl?: string;
      destinationUrl?: string;
      sourceTx?: string;
      destinationTx?: string;
    }
  | { kind: "error"; message: string; burnTx?: Hex };

const fmt = (v: bigint) =>
  Number(formatUnits(v, 6)).toLocaleString("en-US", { maximumFractionDigits: 6 });

function loadPending(): Pending[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Pending[]) : [];
  } catch {
    return [];
  }
}
function savePending(list: Pending[]) {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-8)));
  } catch {
    /* private browsing: resumption degrades, the transfer is still safe on-chain */
  }
}

export default function BridgePage() {
  const wallet = useBridgeWallet();

  const [from, setFrom] = useState<BridgeChain>(
    CCTP_CHAINS.find((chain) => chain.key === "base") ?? CCTP_CHAINS[0],
  );
  const [to, setTo] = useState<BridgeChain>(ARC);
  const [amount, setAmount] = useState("");
  const [speed, setSpeed] = useState<Speed>("fast");
  const [recipient, setRecipient] = useState("");
  const [showRecipient, setShowRecipient] = useState(false);
  const [quote, setQuote] = useState<Quote>();
  const [quoteErr, setQuoteErr] = useState<string>();
  const [srcBalance, setSrcBalance] = useState<bigint>();
  const [dstBalance, setDstBalance] = useState<bigint>();
  const [route, setRoute] = useState<Route>(DIRECT_ROUTE);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [pending, setPending] = useState<Pending[]>([]);
  const [solanaAddress, setSolanaAddress] = useState<string>();
  const [solanaProvider, setSolanaProvider] = useState<InjectedSolanaProvider>();
  const [solanaError, setSolanaError] = useState<string>();

  const busy = !["idle", "done", "error"].includes(step.kind);

  useEffect(() => {
    setPending(loadPending());
    const injected = detectSolanaProvider();
    const connected = injected?.isConnected ? injected.publicKey?.toString() : undefined;
    if (connected) {
      setSolanaProvider(injected);
      setSolanaAddress(connected);
    }
  }, []);

  const connectSolana = useCallback(async () => {
    setSolanaError(undefined);
    try {
      const connected = await connectSolanaProvider();
      setSolanaAddress(connected.address);
      setSolanaProvider(connected.provider);
    } catch (error) {
      setSolanaError(String((error as Error).message ?? error));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (isEvmChain(from)) {
      resolveRoute(from).then((r) => !cancelled && setRoute(r));
    } else {
      setRoute(DIRECT_ROUTE);
    }
    return () => {
      cancelled = true;
    };
  }, [from]);

  useEffect(() => {
    if (!from.supportsFast && speed === "fast") setSpeed("standard");
  }, [from, speed]);

  useEffect(() => {
    let cancelled = false;
    if (!amount || Number(amount) <= 0) {
      setQuote(undefined);
      setQuoteErr(undefined);
      return;
    }
    quoteBridge({ amount, from, to, speed, routerFeeBps: route.routerFeeBps })
      .then((q) => !cancelled && (setQuote(q), setQuoteErr(undefined)))
      .catch((e) => !cancelled && (setQuote(undefined), setQuoteErr(String(e.message ?? e))));
    return () => {
      cancelled = true;
    };
  }, [amount, from, to, speed, route.routerFeeBps]);

  const refreshBalances = useCallback(() => {
    if (wallet.address && isEvmChain(from)) {
      readUsdcBalance(from, wallet.address).then(setSrcBalance).catch(() => setSrcBalance(undefined));
    } else setSrcBalance(undefined);
    if (wallet.address && isEvmChain(to)) {
      readUsdcBalance(to, wallet.address).then(setDstBalance).catch(() => setDstBalance(undefined));
    } else setDstBalance(undefined);
  }, [wallet.address, from, to]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  const swap = useCallback(() => {
    setFrom(to);
    setTo(from);
    setStep({ kind: "idle" });
  }, [from, to]);

  const pickFrom = useCallback(
    (key: string) => {
      const next = BRIDGE_CHAINS.find((chain) => chain.key === key);
      if (!next || next.key === from.key) return;
      if (next.key === to.key) setTo(from);
      setFrom(next);
      setStep({ kind: "idle" });
    },
    [from, to],
  );

  const pickTo = useCallback(
    (key: string) => {
      const next = BRIDGE_CHAINS.find((chain) => chain.key === key);
      if (!next || next.key === to.key) return;
      if (next.key === from.key) setFrom(to);
      setTo(next);
      setStep({ kind: "idle" });
    },
    [from, to],
  );

  const insufficient = useMemo(
    () => isEvmChain(from) && srcBalance !== undefined && quote !== undefined && srcBalance < quote.amountIn,
    [from, srcBalance, quote],
  );
  const sourceAddress = isSolanaChain(from) ? solanaAddress : wallet.address;
  const defaultRecipient = isSolanaChain(to) ? solanaAddress : wallet.address;
  const effectiveRecipient = recipient || defaultRecipient || "";
  const badRecipient = effectiveRecipient !== "" && !validRecipient(to, effectiveRecipient);
  const missingRecipient = effectiveRecipient === "";
  const solanaRoute = isSolanaChain(from) || isSolanaChain(to);
  // Circle's Forwarding Service delivers Solana routes and charges for it; the
  // amount out below is net of its published service fee (destination gas on top).
  const forwardFee = solanaRoute ? forwardingServiceFee(to) : 0n;
  const connectSource = isSolanaChain(from) ? connectSolana : wallet.connect;

  const clearPending = useCallback((burnTx: Hex) => {
    setPending((p) => {
      const next = p.filter((x) => x.burnTx !== burnTx);
      savePending(next);
      return next;
    });
  }, []);

  /** Attest → self-mint on the destination. Shared by fresh and resumed transfers. */
  const deliver = useCallback(
    async (burnTx: Hex, srcChain: CctpChain, dstChain: CctpChain, owner: `0x${string}`) => {
      setStep({ kind: "attesting", burnTx, status: "indexing", elapsedMs: 0 });
      const attested = await waitForAttestation({
        sourceDomain: srcChain.domain,
        transactionHash: burnTx,
        onPoll: (status, elapsedMs) =>
          setStep((s) => (s.kind === "attesting" ? { ...s, status, elapsedMs } : s)),
      });


      setStep({ kind: "minting", burnTx });
      await wallet.switchTo(dstChain);
      const mintTx = await wallet.sendTx(
        MESSAGE_TRANSMITTER_V2,
        receiveCalldata(attested.message, attested.attestation),
        owner,
      );
      await waitForReceipt(dstChain, mintTx);
      setStep({ kind: "done", burnTx, mintTx });
    },
    [wallet],
  );

  const run = useCallback(async () => {
    if (!sourceAddress || !quote || !effectiveRecipient || badRecipient) return;

    if (solanaRoute) {
      try {
        if (isEvmChain(from) && wallet.chainId !== from.chainId) await wallet.switchTo(from);
        setStep({ kind: "circle", status: "Waiting for the source-wallet signature…" });
        const receipt = await runCircleBridge({
          from,
          to,
          amount,
          recipientAddress: effectiveRecipient,
          speed,
          solanaProvider,
        });
        setStep({ kind: "circleDone", ...receipt });
        refreshBalances();
      } catch (error) {
        setStep({ kind: "error", message: String((error as Error).message ?? error) });
      }
      return;
    }

    if (!wallet.address || !isEvmChain(from) || !isEvmChain(to)) return;
    const owner = wallet.address;
    const dest = effectiveRecipient as `0x${string}`;
    let burnTx: Hex | undefined;

    try {
      if (wallet.chainId !== from.chainId) await wallet.switchTo(from);

      const allowance = await readAllowance(from, owner, route.spender);
      if (allowance < quote.amountIn) {
        setStep({ kind: "approving" });
        const approveTx = await wallet.sendTx(
          from.usdc,
          approvalCalldata(route.spender, quote.amountIn),
          owner,
        );
        await waitForReceipt(from, approveTx);
      }

      setStep({ kind: "burning" });
      const burnData =
        route.mode === "router"
          ? bridgeCalldata({
              amount: quote.amountIn,
              destinationDomain: to.domain,
              recipient: dest,
              maxFee: maxFeeFor(quote),
              minFinalityThreshold: quote.minFinalityThreshold,
            })
          : directBridgeCalldata({
              amount: quote.amountIn,
              destinationDomain: to.domain,
              recipient: dest,
              burnToken: from.usdc,
              maxFee: maxFeeFor(quote),
              minFinalityThreshold: quote.minFinalityThreshold,
            });
      burnTx = await wallet.sendTx(route.spender, burnData, owner);
      await waitForReceipt(from, burnTx);

      // Persist before delivering. From here the funds exist only as an
      // attested burn, and losing the hash is the one thing that makes
      // recovery genuinely painful.
      const record: Pending = {
        burnTx,
        fromKey: from.key,
        toKey: to.key,
        amount,
        at: Date.now(),
      };
      setPending((p) => {
        const next = [...p, record];
        savePending(next);
        return next;
      });

      await deliver(burnTx, from, to, owner);
      clearPending(burnTx);
      refreshBalances();
    } catch (e) {
      setStep({ kind: "error", message: String((e as Error).message ?? e), burnTx });
    }
  }, [
    sourceAddress,
    quote,
    effectiveRecipient,
    badRecipient,
    solanaRoute,
    from,
    to,
    amount,
    speed,
    solanaProvider,
    wallet,
    route,
    deliver,
    clearPending,
    refreshBalances,
  ]);

  const resume = useCallback(
    async (p: Pending) => {
      if (!wallet.address) return;
      const src = CCTP_CHAINS.find((c) => c.key === p.fromKey) ?? ARC;
      const dst = CCTP_CHAINS.find((c) => c.key === p.toKey) ?? ARC;
      try {
        await deliver(p.burnTx, src, dst, wallet.address);
        clearPending(p.burnTx);
        refreshBalances();
      } catch (e) {
        setStep({ kind: "error", message: String((e as Error).message ?? e), burnTx: p.burnTx });
      }
    },
    [wallet.address, deliver, clearPending, refreshBalances],
  );

  return (
    <BridgeShell
      address={sourceAddress}
      chainId={wallet.chainId}
      chainLabel={isSolanaChain(from) ? "Solana" : undefined}
      onConnect={connectSource}
      error={isSolanaChain(from) ? solanaError : wallet.error}
    >
      <div className="bridge-page pt-12 sm:pt-16 fade-up">
        <header className="bridge-hero mb-9 border-b border-line pb-8 sm:mb-12">
          <div className="mb-1 flex items-center gap-2 text-2xs uppercase tracking-[0.18em] text-fg-dim">
            <span className="dot-pulse inline-block h-1.5 w-1.5 rounded-full bg-up" />
            circle cctp v2 · 12 networks · 132 routes
          </div>
          <h1 className="mt-4 max-w-4xl text-5xl font-medium leading-[0.92] tracking-[-0.06em] sm:text-7xl">
            One USDC.<br /><em className="font-serif font-normal text-accent">Every direction.</em>
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-fg-mute sm:text-base">
            Move native USDC across every configured Circle CCTP route. Burn on the source, mint on
            the destination—no wrapped tokens, pooled liquidity, or custodial detour.
          </p>
        </header>

        {pending.length > 0 && (
          <ResumePanel pending={pending} onResume={resume} onDismiss={clearPending} busy={busy} />
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_310px]">
          <section className="bridge-card border border-line bg-bg-elev p-4 sm:p-6">
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 sm:gap-3">
              <NetworkSelect label="from" value={from.key} onChange={pickFrom} disabled={busy} />
              <button
                type="button"
                onClick={swap}
                disabled={busy}
                aria-label="Reverse direction"
                className="mb-[1px] grid h-[42px] w-[42px] place-items-center rounded-full border border-line text-sm text-fg-mute transition-colors hover:border-accent hover:text-accent disabled:opacity-30"
              >
                ⇄
              </button>
              <NetworkSelect label="to" value={to.key} onChange={pickTo} disabled={busy} />
            </div>

            <label className="mt-4 block">
              <span className="mb-1 flex items-baseline justify-between text-2xs uppercase tracking-[0.16em] text-fg-dim">
                <span>amount</span>
                {srcBalance !== undefined && (
                  <button
                    type="button"
                    className="tnum tracking-normal text-fg-dim transition-colors hover:text-accent"
                    onClick={() => setAmount(formatUnits(srcBalance, 6))}
                  >
                    bal {fmt(srcBalance)} · max
                  </button>
                )}
              </span>
              <div className="flex items-center border border-line bg-bg px-3">
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  disabled={busy}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  className="tnum w-full bg-transparent py-2.5 font-serif text-2xl text-fg outline-none"
                />
                <span className="text-2xs uppercase tracking-wider text-fg-dim">usdc</span>
              </div>
            </label>

            <div className="mt-3 flex gap-2">
              {(["fast", "standard"] as Speed[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy || (s === "fast" && !from.supportsFast)}
                  onClick={() => setSpeed(s)}
                  className={`flex-1 border px-3 py-2 text-2xs uppercase tracking-[0.14em] transition-colors disabled:opacity-40 ${
                    speed === s
                      ? "border-accent text-accent"
                      : "border-line text-fg-dim hover:border-line-strong"
                  }`}
                >
                  {s === "fast"
                    ? from.supportsFast
                      ? "fast · seconds"
                      : "fast · not needed"
                    : "standard · free"}
                </button>
              ))}
            </div>

            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowRecipient((v) => !v)}
                className="text-2xs uppercase tracking-[0.14em] text-fg-dim transition-colors hover:text-accent"
              >
                {showRecipient || missingRecipient ? "−" : "+"} destination recipient
              </button>
              {(showRecipient || missingRecipient) && (
                <div className="mt-2 space-y-2">
                  <input
                    aria-label={`${to.name} recipient address`}
                    placeholder={isSolanaChain(to) ? "Solana address…" : "0x…"}
                    value={recipient}
                    disabled={busy}
                    onChange={(e) => setRecipient(e.target.value.trim())}
                    className={`tnum w-full border bg-bg px-3 py-2 text-xs text-fg outline-none ${
                      badRecipient ? "border-down" : "border-line focus:border-line-strong"
                    }`}
                  />
                  {missingRecipient && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={isSolanaChain(to) ? connectSolana : wallet.connect}
                      className="text-2xs uppercase tracking-[0.14em] text-accent hover:underline disabled:opacity-40"
                    >
                      or connect a {to.name} wallet
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4">
              {!sourceAddress ? (
                <button
                  onClick={connectSource}
                  className="w-full bg-accent py-3 text-2xs font-bold uppercase tracking-[0.16em] text-bg transition-opacity hover:opacity-90"
                >
                  connect {from.name} wallet to continue
                </button>
              ) : (
                <button
                  onClick={run}
                  disabled={!quote || busy || insufficient || badRecipient || missingRecipient}
                  className="w-full bg-accent py-3 text-2xs font-bold uppercase tracking-[0.16em] text-bg transition-opacity hover:opacity-90 disabled:opacity-30"
                >
                  {insufficient
                    ? "insufficient balance"
                    : badRecipient
                      ? "invalid recipient"
                      : missingRecipient
                        ? `enter a ${to.name} recipient`
                      : busy
                        ? labelFor(step)
                        : `bridge to ${to.name}`}
                </button>
              )}
            </div>

            {!solanaRoute && isEvmChain(to) && (
              <p className="mt-3 border-l-2 border-line-strong pl-3 text-2xs leading-relaxed text-fg-dim">
                You&apos;ll confirm the final mint on {to.name}, so your wallet needs a small amount of
                {` ${to.gasSymbol}`} for destination gas. The burn remains claimable if delivery is interrupted.
              </p>
            )}

            {solanaRoute && (
              <p className="mt-3 border-l-2 border-line-strong pl-3 text-2xs leading-relaxed text-fg-dim">
                Circle&apos;s Forwarding Service submits the destination transaction, so the recipient
                does not need {to.gasSymbol} to receive USDC.
              </p>
            )}

            <Progress step={step} from={from} to={to} />
          </section>

          <aside className="space-y-4">
            <div className="bridge-card border border-line bg-bg-elev p-5">
              <span className="text-2xs uppercase tracking-[0.16em] text-fg-dim">you receive</span>
              <div className="tnum mt-3 text-4xl font-semibold leading-none tracking-[-0.05em]">
                {quote ? `${solanaRoute ? "≈ " : ""}${fmt(quote.amountOut > forwardFee ? quote.amountOut - forwardFee : 0n)}` : "—"}
              </div>
              <div className="mt-1 text-2xs text-fg-dim">on {to.name}</div>
              <div className="hr my-3" />
              {quoteErr ? (
                <p className="text-2xs leading-relaxed text-down">{quoteErr}</p>
              ) : (
                <dl className="space-y-1.5 text-2xs">
                  <Row
                    label={solanaRoute ? "registrai fee" : route.mode === "router" ? `bridge fee ${route.routerFeeBps / 100}%` : "bridge fee"}
                    value={solanaRoute ? "none" : route.mode === "router" && quote ? fmt(quote.routerFee) : "none"}
                  />
                  <Row
                    label={`circle cctp · ${quote ? quote.cctpFeeBps : "—"} bps`}
                    value={quote ? fmt(quote.cctpFee) : "—"}
                  />
                  {solanaRoute && <Row label="circle forwarding" value={`${fmt(forwardFee)} + gas`} />}
                  <Row label="settles" value={speed === "fast" ? "~seconds" : "on finality"} />
                  <Row
                    label="destination gas"
                    value={solanaRoute ? "Circle relayed" : `you pay · ${to.gasSymbol}`}
                  />
                </dl>
              )}
            </div>

            {dstBalance !== undefined && (
              <div className="bridge-card border border-line bg-bg-elev p-5">
                <span className="text-2xs uppercase tracking-[0.16em] text-fg-dim">
                  your {to.name} balance
                </span>
                <div className="tnum mt-2 font-serif text-2xl leading-none">{fmt(dstBalance)}</div>
                {isEvmChain(to) && to.usdcIsGas && (
                  <p className="mt-2 text-2xs leading-relaxed text-fg-dim">
                    On Arc this is also your gas — one balance, not two. Arriving USDC is spendable
                    immediately.
                  </p>
                )}
              </div>
            )}
          </aside>
        </div>

        <section className="bridge-card mt-6 border border-line bg-bg-elev p-5 sm:p-6">
          <h2 className="mb-2 text-2xs uppercase tracking-[0.16em] text-fg-dim">
            verify before you sign
          </h2>
          <p className="mb-3 max-w-2xl text-2xs leading-relaxed text-fg-mute">
            Every transfer emits <code className="text-fg">DepositForBurn</code> from Circle&apos;s own
            contract. If a &quot;bridge&quot; can&apos;t show you that event, no burn happened and the
            USDC went to somebody&apos;s wallet.
          </p>
          <dl className="tnum space-y-1 text-[11px]">
            {solanaRoute ? (
              <>
                <Row label="Solana TokenMessengerMinterV2" value={SOLANA.tokenMessengerMinterV2} />
                <Row label="Solana MessageTransmitterV2" value={SOLANA.messageTransmitterV2} />
              </>
            ) : (
              <>
                <Row
                  label={route.mode === "router" ? "BridgeRouter · active" : "BridgeRouter · not deployed"}
                  value={BRIDGE_ROUTER}
                />
                <Row label="CCTP TokenMessengerV2" value={TOKEN_MESSENGER_V2} />
                <Row label="CCTP MessageTransmitterV2" value={MESSAGE_TRANSMITTER_V2} />
              </>
            )}
            <Row label="CCTP route" value={`${from.domain} → ${to.domain}`} />
          </dl>
        </section>
      </div>
    </BridgeShell>
  );
}

function NetworkSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (key: string) => void;
}) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block text-2xs uppercase tracking-[0.16em] text-fg-dim">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-0 border border-line bg-bg px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-accent disabled:opacity-50"
      >
        {BRIDGE_CHAINS.map((chain) => (
          <option key={chain.key} value={chain.key}>{chain.name}</option>
        ))}
      </select>
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-fg-dim">{label}</dt>
      <dd className="truncate text-fg-mute">{value}</dd>
    </div>
  );
}

function ResumePanel({
  pending,
  onResume,
  onDismiss,
  busy,
}: {
  pending: Pending[];
  onResume: (p: Pending) => void;
  onDismiss: (tx: Hex) => void;
  busy: boolean;
}) {
  return (
    <section className="mb-4 border border-accent/40 bg-accent/[0.06] p-4">
      <h2 className="mb-1 text-2xs uppercase tracking-[0.16em] text-accent">unfinished transfer</h2>
      <p className="mb-3 max-w-2xl text-2xs leading-relaxed text-fg-mute">
        These burns completed but delivery didn&apos;t. Nothing is lost — the attestation stays valid
        indefinitely, so they can be claimed whenever you like.
      </p>
      {pending.map((p) => (
        <div
          key={p.burnTx}
          className="flex items-center justify-between gap-3 border-t border-line/60 py-2 first:border-t-0"
        >
          <div className="min-w-0">
            <div className="tnum text-xs text-fg">
              {p.amount} USDC · {p.fromKey} → {p.toKey}
            </div>
            <div className="truncate text-2xs text-fg-dim">{p.burnTx}</div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onResume(p)}
              className="border border-accent px-2.5 py-1 text-2xs uppercase tracking-wider text-accent transition-colors hover:bg-accent hover:text-bg-elev disabled:opacity-30"
            >
              claim
            </button>
            <button
              type="button"
              onClick={() => onDismiss(p.burnTx)}
              className="border border-line px-2.5 py-1 text-2xs uppercase tracking-wider text-fg-dim transition-colors hover:text-fg"
            >
              dismiss
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function Progress({ step, from, to }: { step: Step; from: BridgeChain; to: BridgeChain }) {
  if (step.kind === "idle") return null;

  if (step.kind === "error") {
    return (
      <div className="mt-4 border border-down/50 bg-down/[0.06] p-3">
        <p className="text-xs font-medium text-down">Transfer interrupted</p>
        <p className="mt-1 text-2xs leading-relaxed text-fg-mute">{step.message}</p>
        {step.burnTx && (
          <p className="mt-2 text-2xs leading-relaxed text-fg-mute">
            Your burn is on-chain and the attestation stays valid — claim it above whenever you
            like.{" "}
            <a
              className="text-accent underline"
              href={`${from.explorer}/tx/${step.burnTx}`}
              target="_blank"
              rel="noreferrer"
            >
              view burn ↗
            </a>
          </p>
        )}
      </div>
    );
  }

  if (step.kind === "done") {
    return (
      <div className="mt-4 border border-up/50 bg-up/[0.06] p-3">
        <p className="text-xs font-medium text-up">Delivered to {to.name}</p>
        <p className="mt-2 space-x-3 text-2xs">
          <a
            className="text-accent underline"
            href={`${from.explorer}/tx/${step.burnTx}`}
            target="_blank"
            rel="noreferrer"
          >
            burn on {from.name} ↗
          </a>
          <a
            className="text-accent underline"
            href={`${to.explorer}/tx/${step.mintTx}`}
            target="_blank"
            rel="noreferrer"
          >
            mint on {to.name} ↗
          </a>
        </p>
      </div>
    );
  }

  if (step.kind === "circleDone") {
    return (
      <div className="mt-4 border border-up/50 bg-up/[0.06] p-3">
        <p className="text-xs font-medium text-up">Delivered to {to.name}</p>
        <p className="mt-1 text-2xs text-fg-mute">
          Circle relayed the destination transaction; the recipient did not need destination gas.
        </p>
        <p className="mt-2 space-x-3 text-2xs">
          {step.sourceUrl && (
            <a className="text-accent underline" href={step.sourceUrl} target="_blank" rel="noreferrer">
              source transaction ↗
            </a>
          )}
          {step.destinationUrl && step.destinationUrl !== step.sourceUrl && (
            <a className="text-accent underline" href={step.destinationUrl} target="_blank" rel="noreferrer">
              destination transaction ↗
            </a>
          )}
        </p>
      </div>
    );
  }

  if (step.kind === "circle") {
    return (
      <div className="mt-4 border border-line bg-bg p-3">
        <div className="mb-2 h-[3px] w-full overflow-hidden bg-line">
          <div className="h-full w-2/3 animate-pulse bg-accent" />
        </div>
        <p className="text-xs text-fg">{step.status}</p>
        <p className="mt-1 text-2xs leading-relaxed text-fg-dim">
          Circle Bridge Kit handles the burn, attestation, and relayed mint. Keep this tab open until delivery completes.
        </p>
      </div>
    );
  }

  // approve · burn · attest · mint
  const order: Record<string, number> = {
    approving: 0,
    burning: 1,
    attesting: 2,
    minting: 3,
  };
  const at = order[step.kind] ?? 0;

  return (
    <div className="mt-4 border border-line bg-bg p-3">
      <div className="mb-2 flex gap-1">
        {["approve", "burn", "attest", "deliver"].map((s, i) => (
          <div key={s} className="flex-1">
            <div className={`h-[3px] ${at >= i ? "bg-accent" : "bg-line"}`} />
            <div
              className={`mt-1 text-[10px] uppercase tracking-wider ${
                at >= i ? "text-accent" : "text-fg-dim"
              }`}
            >
              {s}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-fg">{labelFor(step)}</p>
      {step.kind === "attesting" && (
        <p className="mt-1 text-2xs leading-relaxed text-fg-dim">
          Circle: {step.status} · {Math.round(step.elapsedMs / 1000)}s. Safe to leave — the burn is
          on-chain and can be claimed later.
        </p>
      )}
    </div>
  );
}

function labelFor(step: Step): string {
  switch (step.kind) {
    case "approving":
      return "Approving USDC…";
    case "burning":
      return "Burning on the source chain…";
    case "attesting":
      return "Waiting for Circle's attestation…";
    case "minting":
      return "Minting on the destination chain…";
    case "circle":
      return "Bridging through Circle…";
    default:
      return "Working…";
  }
}

"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { BuybackPanel } from "./BuybackPanel";
import { CommonMarketsPanel } from "./CommonMarketsPanel";
import { BIG, Donut, Swatch } from "./parts";
import { parseAbi, type Address, type PublicClient } from "viem";
import { CopyButton } from "@/components/perennial/CopyButton";
import { buildersClient } from "@/components/verify/useMyBuilder";
import { accessControlAbi } from "@/lib/builders-onboarder";
import { BUILDERS } from "@/lib/builders-network";
import { usdText, who } from "@/lib/plain-words";
import { badgeAbi } from "@/lib/verified-builder-badge";
import {
  BUYBACK, CONTRACTS, DEPLOY, DEX_PAIR_API, FEE_SPLITS, RECORD, ROLES, TRADE_FEE_PCT, WALLETS, compactNumber, holderLabel, nativeToUsdc, parseDexPair,
  roleDiffs, agoText, LIVE_REFRESH_MS, sumBy, supplySplit,
} from "@/lib/transparency";

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
]);
const erc20Abi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]);

const EXPLORER = BUILDERS.chain.explorer.url.replace(/\/$/, "");
const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;

/** Slow-moving state: who holds which role, the Safe's owners, the badges. Read every 5 minutes. */
interface Slow {
  roles: Record<string, boolean>;
  owners: Address[];
  threshold: bigint;
  badges: { serial: number; builderId: bigint; owner: Address | null }[];
}

/** Fast-moving numbers: balances, supply, burned, holdings, Safe nonce. Read every 10 seconds. */
interface Fast {
  readAt: number;
  safeNonce: bigint;
  balances: Record<string, bigint>;
  txCounts: Record<string, number>;
  regi: { supply: bigint; decimals: number; burned: bigint; held: Record<string, bigint> };
}

type Live = Slow & Fast;

const roleKey = (contract: string, role: string, wallet: string) => `${contract}:${role}:${wallet}`;
const SAFE = WALLETS.find((w) => w.isSafe)!.address;
const BADGE = CONTRACTS.find((x) => x.key === "badge")!.address;

async function readSlow(c: PublicClient): Promise<Slow> {
  const roleReads = CONTRACTS.flatMap((ct) =>
    ROLES[ct.key].flatMap((r) =>
      WALLETS.map(async (w) => [
        roleKey(ct.key, r.name, w.key),
        (await c.readContract({ address: ct.address, abi: accessControlAbi, functionName: "hasRole", args: [r.hash, w.address] })) as boolean,
      ] as const),
    ),
  );
  const [roles, owners, threshold, nextSerial] = await Promise.all([
    Promise.all(roleReads),
    c.readContract({ address: SAFE, abi: safeAbi, functionName: "getOwners" }) as Promise<Address[]>,
    c.readContract({ address: SAFE, abi: safeAbi, functionName: "getThreshold" }) as Promise<bigint>,
    c.readContract({ address: BADGE, abi: badgeAbi, functionName: "nextSerial" }) as Promise<bigint>,
  ]);
  const serials = Array.from({ length: Math.max(0, Number(nextSerial) - 1) }, (_, i) => i + 1);
  const badges = await Promise.all(
    serials.map(async (serial) => {
      const builderId = (await c.readContract({ address: BADGE, abi: badgeAbi, functionName: "builderOf", args: [BigInt(serial)] })) as bigint;
      // A revoked badge has no owner any more: ownerOf reverts.
      const owner = await (c.readContract({ address: BADGE, abi: badgeAbi, functionName: "ownerOf", args: [BigInt(serial)] }) as Promise<Address>).catch(() => null);
      return { serial, builderId, owner };
    }),
  );
  return { roles: Object.fromEntries(roles), owners, threshold, badges };
}

async function readFast(c: PublicClient): Promise<Fast> {
  // One batched JSON-RPC request per refresh (the client batches), so every 10 s stays cheap.
  const [safeNonce, balances, txCounts, supply, decimals, burned, held] = await Promise.all([
    c.readContract({ address: SAFE, abi: safeAbi, functionName: "nonce" }) as Promise<bigint>,
    Promise.all(WALLETS.map(async (w) => [w.key, await c.getBalance({ address: w.address })] as const)),
    Promise.all(WALLETS.filter((w) => !w.isSafe).map(async (w) => [w.key, await c.getTransactionCount({ address: w.address })] as const)),
    c.readContract({ address: BUYBACK.token, abi: erc20Abi, functionName: "totalSupply" }) as Promise<bigint>,
    c.readContract({ address: BUYBACK.token, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
    c.readContract({ address: BUYBACK.token, abi: erc20Abi, functionName: "balanceOf", args: [BUYBACK.burnAddress] }) as Promise<bigint>,
    Promise.all(WALLETS.map(async (w) => [w.key, (await c.readContract({ address: BUYBACK.token, abi: erc20Abi, functionName: "balanceOf", args: [w.address] })) as bigint] as const)),
  ]);
  return {
    readAt: Date.now(),
    safeNonce,
    balances: Object.fromEntries(balances),
    txCounts: Object.fromEntries(txCounts),
    regi: { supply, decimals, burned, held: Object.fromEntries(held) },
  };
}

/** Re-renders every second so "updated Xs ago" ticks. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** "$0.000117", "$114.2K": small prices keep three significant digits, big amounts go compact. */
function usdLoose(n: number): string {
  if (n >= 1000) return `$${compactNumber(n)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}

const SUPPLY_COLORS = { burned: "var(--fg)", protocol: "var(--accent)", public: "var(--line-strong)" } as const;
const LEG_COLORS = ["var(--up)", "var(--accent)", "var(--line-strong)"];

/** A compact rule tile: label, one big value, one short line. */
function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "up" | "down" }) {
  return (
    <div className="pa-card flex flex-col gap-1">
      <span className="pa-muted pa-small">{label}</span>
      <b className={`pa-serif tnum ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""}`} style={{ ...BIG, fontSize: 26 }}>{value}</b>
      <span className="pa-muted pa-small">{sub}</span>
    </div>
  );
}

/** "0xFeE9…80Fb" linked to the explorer, with a copy button for the full address. */
function ShortAddr({ a }: { a: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <a className="pa-mono pa-link pa-small" href={addrUrl(a)} target="_blank" rel="noreferrer" title={a}>{who(a)}</a>
      <CopyButton text={a} />
    </span>
  );
}

export function Transparency() {
  const swrOpts = { revalidateOnFocus: false, errorRetryCount: 4, errorRetryInterval: 8_000 };
  const { data: slow, error: slowError } = useSWR(["transparency-slow", BUILDERS.chainId], () => readSlow(buildersClient()), {
    ...swrOpts, refreshInterval: LIVE_REFRESH_MS.slow,
  });
  const { data: fast, error: fastError } = useSWR(["transparency-fast", BUILDERS.chainId], () => readFast(buildersClient()), {
    ...swrOpts, refreshInterval: LIVE_REFRESH_MS.fast,
  });
  const live: Live | undefined = slow && fast ? { ...slow, ...fast } : undefined;
  const error = slowError ?? fastError;
  const now = useNow();
  const { data: dex } = useSWR(["transparency-dex"], async () => parseDexPair(await (await fetch(DEX_PAIR_API)).json()), {
    revalidateOnFocus: false,
    refreshInterval: LIVE_REFRESH_MS.price,
  });
  const reading = !live && !error;
  const diffs = live ? roleDiffs(live.roles) : null;
  const roleCount = CONTRACTS.reduce((n, c) => n + ROLES[c.key].length, 0);
  const whole = (v: bigint) => (live ? Number(v / 10n ** BigInt(live.regi.decimals)) : 0);
  const regiHeld = live ? sumBy(WALLETS, live.regi.held) : null;
  const usdcHeld = live ? sumBy(WALLETS, live.balances) : null;
  const split = live && regiHeld !== null ? supplySplit({ supply: live.regi.supply, burned: live.regi.burned, protocol: regiHeld }) : null;
  const shareOf = (v: bigint) => (live && live.regi.supply > 0n ? Number((v * 10_000n) / live.regi.supply) / 100 : 0);
  const issued = live ? live.badges.filter((b) => b.owner).length : null;
  const dash = "…";

  // Desktop: a 12-column bento grid, each widget as wide as its content needs. Phones: one column.
  const card = "pa-stack min-w-0";
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-x-6 lg:gap-y-10">
      <header className="lg:col-span-12 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="pa-h1">Transparency</h1>
          <p className="pa-lede">The numbers behind Registrai on {BUILDERS.label}, read live from the chain. Every address links to the explorer.</p>
        </div>
        <div className="lg:text-right">
          {error && <p className="pa-notice" data-tone="down">Couldn&apos;t read {BUILDERS.label} right now. Retrying.</p>}
          {reading && <p className="pa-muted">Reading {BUILDERS.label}…</p>}
          {live && (
            <p className="pa-muted pa-small inline-flex items-center gap-2 whitespace-nowrap" aria-live="off">
              <i aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--up)" }} />
              Live · updated {agoText(now - live.readAt)}
            </p>
          )}
        </div>
      </header>

      {/* How much: REGI in total and where it sits */}
      <section className={`${card} lg:col-span-7`} aria-labelledby="t-supply">
        <h2 id="t-supply" className="pa-h2">REGI supply</h2>
        <div className="pa-card flex flex-1 flex-col gap-5">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
            <Donut
              label="REGI supply: burned, protocol wallets, everyone else"
              size={176}
              stroke={24}
              parts={split ? split.map((p) => ({ key: p.key, share: shareOf(p.amount), color: SUPPLY_COLORS[p.key] })) : []}
            >
              <b className="pa-serif tnum" style={{ fontSize: 36, lineHeight: 1, fontWeight: 400 }}>{live ? compactNumber(whole(live.regi.supply)) : dash}</b>
              <span className="pa-muted pa-small">total supply</span>
            </Donut>
            <div className="flex w-full flex-col">
              {(split ?? supplySplit({ supply: 0n, burned: 0n, protocol: 0n })).map((p) => (
                <div key={p.key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-b border-line py-2.5 last:border-b-0">
                  <span className="inline-flex items-center gap-2"><Swatch color={SUPPLY_COLORS[p.key]} />{p.label}</span>
                  <b className="pa-serif tnum text-right" style={{ ...BIG, fontSize: 26 }}>{split ? compactNumber(whole(p.amount)) : dash}</b>
                  <span className="pa-muted pa-small">
                    {p.key === "burned" && <a className="pa-link" href={addrUrl(BUYBACK.burnAddress)} target="_blank" rel="noreferrer">at the burn address ↗</a>}
                    {p.key === "protocol" && `across the ${WALLETS.length} wallets below`}
                    {p.key === "public" && "in the pool and every other wallet"}
                  </span>
                  <span className="pa-small tnum text-right">{split ? p.pct : " "}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-line pt-4">
            <div className="flex flex-col gap-1"><span className="pa-muted pa-small">Price</span><b className="pa-serif tnum" style={{ ...BIG, fontSize: 22 }}>{dex ? usdLoose(dex.priceUsd) : "—"}</b></div>
            <div className="flex flex-col gap-1"><span className="pa-muted pa-small">Market cap</span><b className="pa-serif tnum" style={{ ...BIG, fontSize: 22 }}>{dex?.marketCapUsd != null ? usdLoose(dex.marketCapUsd) : "—"}</b></div>
            <div className="flex flex-col gap-1"><span className="pa-muted pa-small">Pool liquidity</span><b className="pa-serif tnum" style={{ ...BIG, fontSize: 22 }}>{dex?.liquidityUsd != null ? usdLoose(dex.liquidityUsd) : "—"}</b></div>
          </div>
          <p className="pa-muted pa-small">
            <a className="pa-link" href={addrUrl(BUYBACK.token)} target="_blank" rel="noreferrer">REGI token ↗</a> ·{" "}
            <a className="pa-link" href={BUYBACK.poolUrl} target="_blank" rel="noreferrer">REGI/USDC pool ↗</a> · price from DexScreener
          </p>
        </div>
      </section>

      <BuybackPanel className="lg:col-span-5" />

      {/* How much sits on protocol-owned addresses */}
      <section className={`${card} lg:col-span-7`} aria-labelledby="t-held">
        <h2 id="t-held" className="pa-h2">On protocol addresses</h2>
        <div className="pa-card overflow-x-auto">
          <div className="grid grid-cols-2 gap-3 border-b border-line pb-3">
            <div className="flex flex-col gap-1"><span className="pa-muted pa-small">USDC held</span><b className="pa-serif tnum" style={BIG}>{usdcHeld === null ? dash : usdText(nativeToUsdc(usdcHeld))}</b></div>
            <div className="flex flex-col gap-1"><span className="pa-muted pa-small">REGI held</span><b className="pa-serif tnum" style={BIG}>{regiHeld === null || !live ? dash : compactNumber(whole(regiHeld))}</b></div>
          </div>
          <table className="w-full text-left tnum">
            <thead className="pa-muted pa-small">
              <tr>
                <th className="py-2 pr-4 font-normal">Wallet</th>
                <th className="py-2 pr-4 text-right font-normal">USDC</th>
                <th className="py-2 pr-4 text-right font-normal">REGI</th>
                <th className="py-2 text-right font-normal">Txs</th>
              </tr>
            </thead>
            <tbody>
              {WALLETS.map((w) => (
                <tr key={w.key} className="border-t border-line">
                  <td className="py-1.5 pr-4">
                    <a className="pa-link" href={addrUrl(w.address)} target="_blank" rel="noreferrer">{w.label}</a>
                    <span className="pa-muted pa-small pa-mono ml-2">{who(w.address)}</span>
                  </td>
                  <td className="py-1.5 pr-4 text-right">{live ? usdText(nativeToUsdc(live.balances[w.key] ?? 0n)) : dash}</td>
                  <td className="py-1.5 pr-4 text-right">{live ? compactNumber(whole(live.regi.held[w.key] ?? 0n)) : dash}</td>
                  <td className="py-1.5 text-right">{live ? (w.isSafe ? live.safeNonce.toString() : String(live.txCounts[w.key] ?? 0)) : dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pa-muted pa-small mt-3">
            USDC is {BUILDERS.label}&apos;s gas token. The buyback and the splitter hold their USDC in their own contracts (see the buyback).
          </p>
        </div>
      </section>

      {/* Shares */}
      <section className={`${card} lg:col-span-5`} aria-labelledby="t-shares">
        <h2 id="t-shares" className="pa-h2">Who gets each fee</h2>
        <p className="pa-muted pa-small">
          <b className="text-fg">{TRADE_FEE_PCT}%</b> on every buy and sell. Collected so far: <b className="text-fg tnum">$0</b>. Markets are frozen, so no fees come in.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {FEE_SPLITS.map((s) => (
            <article key={s.market} className="pa-card flex items-center gap-4">
              <Donut label={`${s.short} fee split`} size={92} stroke={14} parts={s.legs.map((l, i) => ({ key: l.who, share: l.pct, color: LEG_COLORS[i] }))}>
                <span className="pa-small tnum">{TRADE_FEE_PCT}%</span>
              </Donut>
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="pa-h3">{s.short}</h3>
                {s.legs.map((l, i) => (
                  <span key={l.who} className="inline-flex items-baseline gap-2 pa-small" title={l.to}>
                    <b className="pa-serif tnum" style={{ fontSize: 18, lineHeight: 1, fontWeight: 400 }}>{l.pct}%</b>
                    <span className="inline-flex items-center gap-1.5"><Swatch color={LEG_COLORS[i]} />{l.who}</span>
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <CommonMarketsPanel marketsClass="lg:col-span-7" oracleClass="lg:col-span-5" />

      {/* Rules: one strip of compact tiles */}
      <section className={`${card} lg:col-span-12`} aria-labelledby="t-rules">
        <h2 id="t-rules" className="pa-h2">Rules</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Tile label="Funds the buyback" value={`${BUYBACK.shareOfTreasuryPct}%`} sub="of treasury income, fixed; redirect needs 7 days' notice" />
          <Tile label="Buyback trigger" value={`$${BUYBACK.triggerUsdc}`} sub="opens a round of buys" />
          <Tile label="Buys per round" value={`${BUYBACK.chunks} × $${BUYBACK.chunkUsdc}`} sub={`${BUYBACK.cooldownMin} min apart, anyone presses`} />
          <Tile
            label="Admin actions need"
            value={live ? `${live.threshold.toString()} of ${live.owners.length}` : dash}
            sub={live ? `Safe signatures · ${live.safeNonce.toString()} so far` : "Safe signatures"}
          />
          <Tile
            label="Roles as deployed"
            value={diffs === null ? dash : diffs.length === 0 ? `✓ ${roleCount}/${roleCount}` : `${diffs.length} changed`}
            tone={diffs === null ? undefined : diffs.length === 0 ? "up" : "down"}
            sub={`checked live on ${CONTRACTS.filter((x) => ROLES[x.key].length > 0).length} contracts`}
          />
          <Tile label="Proof re-check" value="10 min" sub="the keeper re-checks every proof" />
        </div>
        {diffs && diffs.length > 0 && (
          <ul className="pa-notice" data-tone="down">
            {diffs.map((d) => <li key={d}>{d}</li>)}
          </ul>
        )}
      </section>

      <div className="flex min-w-0 flex-col gap-8 lg:col-span-7 lg:gap-10">
      {/* Keys: what each wallet can and can't do */}
      <section className={card} aria-labelledby="t-keys">
        <h2 id="t-keys" className="pa-h2">Who holds the keys</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {WALLETS.map((w) => (
            <article key={w.key} className="pa-card flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <h3 className="pa-h3">{w.label}</h3>
                <ShortAddr a={w.address} />
              </div>
              <p className="pa-small">{w.what}</p>
              <p className="pa-muted pa-small"><b>Can&apos;t:</b> {w.cannot}</p>
              {w.isSafe && live && (
                <p className="pa-small pa-muted">
                  Owners: {live.owners.map((o, i) => (
                    <span key={o}>{i > 0 && ", "}<a className="pa-link" href={addrUrl(o)} target="_blank" rel="noreferrer">{who(o)}</a></span>
                  ))}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* Record */}
      <section className={card} aria-labelledby="t-badges">
        <h2 id="t-badges" className="pa-h2">Verified builders</h2>
        <div className="pa-card">
          <div className="flex items-baseline justify-between gap-3">
            <span className="pa-muted pa-small">Badges issued</span>
            <b className="pa-serif tnum" style={{ ...BIG, fontSize: 30 }}>{issued === null ? dash : issued}</b>
          </div>
          {live ? (
            live.badges.length ? (
              <ul className="mt-2">
                {live.badges.map((b) => (
                  <li key={b.serial} className="pa-kv">
                    <span>No. {String(b.serial).padStart(3, "0")} · builder #{b.builderId.toString()}</span>
                    <span>{b.owner ? <a className="pa-link" href={addrUrl(b.owner)} target="_blank" rel="noreferrer">{holderLabel(b.owner)}</a> : "revoked"}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="pa-muted mt-2">None yet.</p>
          ) : <p className="pa-muted mt-2">{dash}</p>}
        </div>
      </section>

      </div>

      <div className="flex min-w-0 flex-col gap-8 lg:col-span-5 lg:gap-10">
      {/* Contracts: one compact list */}
      <section className={card} aria-labelledby="t-contracts">
        <h2 id="t-contracts" className="pa-h2">Contracts</h2>
        <ul className="pa-card flex flex-col">
          {CONTRACTS.map((ct) => (
            <li key={ct.key} className="flex flex-col gap-1 border-b border-line py-2.5 first:pt-0 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b className="font-semibold">{ct.name}</b>
                <span className="inline-flex items-center gap-2">
                  <ShortAddr a={ct.address} />
                  <span className="pa-pill" data-tone={ct.audit === "audited" ? "ok" : undefined}>{ct.audit}</span>
                </span>
              </div>
              <p className="pa-muted pa-small">{ct.what}</p>
            </li>
          ))}
        </ul>
        <p className="pa-muted pa-small">
          Builder contracts: deployed {DEPLOY.date} (block {DEPLOY.block.toLocaleString("en-US")}), audited, source verified. NanoLedger, buyback and
          splitter: deployed 2026-09-27 after an internal review; external audit to come. Markets go live later.
        </p>
      </section>

      <details className="pa-card">
        <summary className="cursor-pointer">Every role, and who holds it</summary>
        <p className="pa-muted pa-small mt-2 max-w-[70ch]">
          Read live with each contract&apos;s <code>hasRole</code> for the wallets above. The explorer shows every RoleGranted and
          RoleRevoked event for the full history.
        </p>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-left">
            <thead className="pa-muted pa-small">
              <tr>
                <th className="py-2 pr-4 font-normal">Contract · role</th>
                <th className="py-2 pr-4 font-normal">What it allows</th>
                <th className="py-2 font-normal">Held by</th>
              </tr>
            </thead>
            <tbody>
              {CONTRACTS.flatMap((ct) =>
                ROLES[ct.key].map((r) => {
                  const holders = live ? WALLETS.filter((w) => live.roles[roleKey(ct.key, r.name, w.key)]) : null;
                  return (
                    <tr key={`${ct.key}-${r.name}`} className="border-t border-line align-top">
                      <td className="py-2 pr-4"><b>{ct.name}</b><br /><span className="pa-small pa-muted">{r.name.replace(/_ROLE$/, "").replace(/_/g, " ").toLowerCase()}</span></td>
                      <td className="py-2 pr-4 pa-small">{r.what}</td>
                      <td className="py-2 pa-small">{holders === null ? dash : holders.length ? holders.map((h) => h.label).join(", ") : <span className="pa-muted">none of these wallets</span>}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </details>

      </div>

      <section className={`${card} lg:col-span-12`} aria-labelledby="t-record">
        <h2 id="t-record" className="pa-h2">Public record</h2>
        <ol className="pa-card flex flex-col">
          {RECORD.map((r) => (
            <li key={`${r.date}-${r.title}`} className="grid grid-cols-[6.5rem_1fr] gap-3 border-b border-line py-2.5 first:pt-0 last:border-b-0 last:pb-0">
              <span className="pa-muted pa-small tnum">{r.date}</span>
              <div className="min-w-0">
                <p className="font-semibold">{r.title}</p>
                {r.detail && <p className="pa-small pa-muted">{r.detail}</p>}
                <p className="pa-small">
                  {r.address && <a className="pa-link mr-3" href={addrUrl(r.address)} target="_blank" rel="noreferrer">explorer ↗</a>}
                  {r.tx && <a className="pa-link" href={`${EXPLORER}/tx/${r.tx}`} target="_blank" rel="noreferrer">transaction ↗</a>}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

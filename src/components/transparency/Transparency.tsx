"use client";

import useSWR from "swr";
import { BuybackPanel } from "./BuybackPanel";
import { BIG, Donut, Stat, Swatch } from "./parts";
import { parseAbi, type Address, type PublicClient } from "viem";
import { CopyButton } from "@/components/perennial/CopyButton";
import { buildersClient } from "@/components/verify/useMyBuilder";
import { accessControlAbi } from "@/lib/builders-onboarder";
import { BUILDERS } from "@/lib/builders-network";
import { usdText, who } from "@/lib/plain-words";
import { badgeAbi } from "@/lib/verified-builder-badge";
import {
  BUYBACK, CONTRACTS, DEPLOY, DEX_PAIR_API, FEE_SPLITS, RECORD, ROLES, TRADE_FEE_PCT, WALLETS, compactNumber, holderLabel, nativeToUsdc, parseDexPair,
  roleDiffs, sumBy, supplySplit,
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

interface Live {
  readAt: number;
  roles: Record<string, boolean>;
  owners: Address[];
  threshold: bigint;
  safeNonce: bigint;
  balances: Record<string, bigint>;
  txCounts: Record<string, number>;
  regi: { supply: bigint; decimals: number; burned: bigint; held: Record<string, bigint> };
  badges: { serial: number; builderId: bigint; owner: Address | null }[];
}

const roleKey = (contract: string, role: string, wallet: string) => `${contract}:${role}:${wallet}`;

async function readLive(c: PublicClient): Promise<Live> {
  const safe = WALLETS.find((w) => w.isSafe)!.address;
  const roleReads = CONTRACTS.flatMap((ct) =>
    ROLES[ct.key].flatMap((r) =>
      WALLETS.map(async (w) => [
        roleKey(ct.key, r.name, w.key),
        (await c.readContract({ address: ct.address, abi: accessControlAbi, functionName: "hasRole", args: [r.hash, w.address] })) as boolean,
      ] as const),
    ),
  );
  const badge = CONTRACTS.find((x) => x.key === "badge")!.address;
  const [roles, owners, threshold, safeNonce, balances, txCounts, supply, decimals, burned, nextSerial, held] = await Promise.all([
    Promise.all(roleReads),
    c.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }) as Promise<Address[]>,
    c.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" }) as Promise<bigint>,
    c.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }) as Promise<bigint>,
    Promise.all(WALLETS.map(async (w) => [w.key, await c.getBalance({ address: w.address })] as const)),
    Promise.all(WALLETS.filter((w) => !w.isSafe).map(async (w) => [w.key, await c.getTransactionCount({ address: w.address })] as const)),
    c.readContract({ address: BUYBACK.token, abi: erc20Abi, functionName: "totalSupply" }) as Promise<bigint>,
    c.readContract({ address: BUYBACK.token, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
    c.readContract({ address: BUYBACK.token, abi: erc20Abi, functionName: "balanceOf", args: [BUYBACK.burnAddress] }) as Promise<bigint>,
    c.readContract({ address: badge, abi: badgeAbi, functionName: "nextSerial" }) as Promise<bigint>,
    Promise.all(WALLETS.map(async (w) => [w.key, (await c.readContract({ address: BUYBACK.token, abi: erc20Abi, functionName: "balanceOf", args: [w.address] })) as bigint] as const)),
  ]);
  const serials = Array.from({ length: Math.max(0, Number(nextSerial) - 1) }, (_, i) => i + 1);
  const badges = await Promise.all(
    serials.map(async (serial) => {
      const builderId = (await c.readContract({ address: badge, abi: badgeAbi, functionName: "builderOf", args: [BigInt(serial)] })) as bigint;
      // A revoked badge has no owner any more: ownerOf reverts.
      const owner = await (c.readContract({ address: badge, abi: badgeAbi, functionName: "ownerOf", args: [BigInt(serial)] }) as Promise<Address>).catch(() => null);
      return { serial, builderId, owner };
    }),
  );
  return {
    readAt: Date.now(),
    roles: Object.fromEntries(roles),
    owners,
    threshold,
    safeNonce,
    balances: Object.fromEntries(balances),
    txCounts: Object.fromEntries(txCounts),
    regi: { supply, decimals, burned, held: Object.fromEntries(held) },
    badges,
  };
}

/** "$0.000117", "$114.2K": small prices keep three significant digits, big amounts go compact. */
function usdLoose(n: number): string {
  if (n >= 1000) return `$${compactNumber(n)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}

const SUPPLY_COLORS = { burned: "var(--fg)", protocol: "var(--accent)", public: "var(--line-strong)" } as const;
const LEG_COLORS = ["var(--up)", "var(--accent)", "var(--line-strong)"];

function Addr({ a }: { a: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a className="pa-mono pa-link" href={addrUrl(a)} target="_blank" rel="noreferrer">{a}</a>
      <CopyButton text={a} />
    </span>
  );
}

export function Transparency() {
  const { data: live, error } = useSWR(["transparency", BUILDERS.chainId], () => readLive(buildersClient()), {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
    errorRetryCount: 4,
    errorRetryInterval: 8_000,
  });
  const { data: dex } = useSWR(["transparency-dex"], async () => parseDexPair(await (await fetch(DEX_PAIR_API)).json()), {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
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

  return (
    <div className="flex flex-col gap-12">
      <header>
        <h1 className="pa-h1">Transparency</h1>
        <p className="pa-lede">The numbers behind Registrai on {BUILDERS.label}, read live from the chain. Every address links to the explorer.</p>
        {error && <p className="pa-notice mt-4" data-tone="down">Couldn&apos;t read {BUILDERS.label} right now. Retrying.</p>}
        {reading && <p className="pa-muted mt-4">Reading {BUILDERS.label}…</p>}
        {live && <p className="pa-muted pa-small mt-3">Read at {new Date(live.readAt).toLocaleTimeString()} · refreshes every minute</p>}
      </header>

      {/* How much: REGI in total and where it sits */}
      <section className="pa-stack" aria-labelledby="t-supply">
        <h2 id="t-supply" className="pa-h2">REGI supply</h2>
        <div className="pa-card flex flex-col gap-6">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-10">
            <Donut
              label="REGI supply: burned, protocol wallets, everyone else"
              size={200}
              stroke={26}
              parts={split ? split.map((p) => ({ key: p.key, share: shareOf(p.amount), color: SUPPLY_COLORS[p.key] })) : []}
            >
              <b className="pa-serif tnum" style={{ fontSize: 40, lineHeight: 1, fontWeight: 400 }}>{live ? compactNumber(whole(live.regi.supply)) : dash}</b>
              <span className="pa-muted pa-small">total supply</span>
            </Donut>
            <div className="flex w-full flex-col">
              {(split ?? supplySplit({ supply: 0n, burned: 0n, protocol: 0n })).map((p) => (
                <div key={p.key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-b border-line py-3 last:border-b-0">
                  <span className="inline-flex items-center gap-2"><Swatch color={SUPPLY_COLORS[p.key]} />{p.label}</span>
                  <b className="pa-serif tnum text-right" style={{ ...BIG, fontSize: 28 }}>{split ? compactNumber(whole(p.amount)) : dash}</b>
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
            <div className="flex flex-col gap-1"><span className="pa-muted pa-small">Price</span><b className="pa-serif tnum" style={{ ...BIG, fontSize: 24 }}>{dex ? usdLoose(dex.priceUsd) : "—"}</b></div>
            <div className="flex flex-col gap-1"><span className="pa-muted pa-small">Market cap</span><b className="pa-serif tnum" style={{ ...BIG, fontSize: 24 }}>{dex?.marketCapUsd != null ? usdLoose(dex.marketCapUsd) : "—"}</b></div>
            <div className="flex flex-col gap-1"><span className="pa-muted pa-small">Pool liquidity</span><b className="pa-serif tnum" style={{ ...BIG, fontSize: 24 }}>{dex?.liquidityUsd != null ? usdLoose(dex.liquidityUsd) : "—"}</b></div>
          </div>
          <p className="pa-muted pa-small break-all">
            Token <a className="pa-link pa-mono" href={addrUrl(BUYBACK.token)} target="_blank" rel="noreferrer">{BUYBACK.token}</a> ·{" "}
            <a className="pa-link" href={BUYBACK.poolUrl} target="_blank" rel="noreferrer">REGI/USDC pool ↗</a> · price from DexScreener
          </p>
        </div>
      </section>

      <BuybackPanel />

      {/* How much sits on protocol-owned addresses */}
      <section className="pa-stack" aria-labelledby="t-held">
        <h2 id="t-held" className="pa-h2">On protocol addresses</h2>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="USDC held" value={usdcHeld === null ? dash : usdText(nativeToUsdc(usdcHeld))} sub={`across ${WALLETS.length} wallets`} />
          <Stat label="REGI held" value={regiHeld === null || !live ? dash : compactNumber(whole(regiHeld))} sub={split ? `${split[1].pct} of supply` : undefined} />
        </div>
        <div className="pa-card overflow-x-auto">
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
                  <td className="py-2 pr-4">
                    <a className="pa-link" href={addrUrl(w.address)} target="_blank" rel="noreferrer">{w.label}</a>
                    <span className="pa-muted pa-small pa-mono block">{who(w.address)}</span>
                  </td>
                  <td className="py-2 pr-4 text-right">{live ? usdText(nativeToUsdc(live.balances[w.key] ?? 0n)) : dash}</td>
                  <td className="py-2 pr-4 text-right">{live ? compactNumber(whole(live.regi.held[w.key] ?? 0n)) : dash}</td>
                  <td className="py-2 text-right">{live ? (w.isSafe ? live.safeNonce.toString() : String(live.txCounts[w.key] ?? 0)) : dash}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line-strong font-semibold">
                <td className="py-2 pr-4">Total</td>
                <td className="py-2 pr-4 text-right">{usdcHeld === null ? dash : usdText(nativeToUsdc(usdcHeld))}</td>
                <td className="py-2 pr-4 text-right">{regiHeld === null || !live ? dash : compactNumber(whole(regiHeld))}</td>
                <td className="py-2" />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="pa-muted pa-small max-w-[70ch]">
          USDC is {BUILDERS.label}&apos;s gas token. The treasury and market contracts aren&apos;t on {BUILDERS.label} yet; they join this
          table when they deploy.
        </p>
      </section>

      {/* Shares */}
      <section className="pa-stack" aria-labelledby="t-shares">
        <h2 id="t-shares" className="pa-h2">Who gets each fee</h2>
        <p className="pa-muted">
          A <b className="text-fg">{TRADE_FEE_PCT}%</b> fee on every buy and sell. Collected so far on {BUILDERS.label}: <b className="text-fg tnum">$0</b>, since
          markets open after their audit.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {FEE_SPLITS.map((s) => (
            <article key={s.market} className="pa-card flex flex-col gap-4">
              <h3 className="pa-h3">{s.short}</h3>
              <div className="flex items-center gap-5">
                <Donut label={`${s.short} fee split`} size={128} stroke={18} parts={s.legs.map((l, i) => ({ key: l.who, share: l.pct, color: LEG_COLORS[i] }))}>
                  <b className="pa-serif tnum" style={{ fontSize: 26, lineHeight: 1, fontWeight: 400 }}>{TRADE_FEE_PCT}%</b>
                  <span className="pa-muted pa-small">fee</span>
                </Donut>
                <div className="flex min-w-0 flex-col gap-3">
                  {s.legs.map((l, i) => (
                    <div key={l.who} className="flex flex-col">
                      <span className="inline-flex items-baseline gap-2">
                        <b className="pa-serif tnum" style={{ fontSize: 24, lineHeight: 1, fontWeight: 400 }}>{l.pct}%</b>
                        <span className="inline-flex items-center gap-1.5"><Swatch color={LEG_COLORS[i]} />{l.who}</span>
                      </span>
                      <span className="pa-muted pa-small">{l.to}</span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Rules */}
      <section className="pa-stack" aria-labelledby="t-rules">
        <h2 id="t-rules" className="pa-h2">Rules</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="Funds the buyback" value={`${BUYBACK.shareOfTreasuryPct}%`} sub="of the treasury's income, fixed in the contract; anyone can add more" />
          <Stat label="Buyback trigger" value={`$${BUYBACK.triggerUsdc}`} sub="once the buyback contract holds this much, a round of buys opens" />
          <Stat
            label="Buys per round"
            value={`${BUYBACK.chunks} × $${BUYBACK.chunkUsdc}`}
            sub={`${BUYBACK.cooldownMin} minutes apart, anyone can press; every token goes to the burn address`}
          />
          <Stat
            label="Admin actions need"
            value={live ? `${live.threshold.toString()} of ${live.owners.length}` : dash}
            sub={live ? `Safe signatures · ${live.safeNonce.toString()} executed so far` : undefined}
          />
          <Stat
            label="Roles as deployed"
            value={diffs === null ? dash : diffs.length === 0 ? `✓ ${roleCount} of ${roleCount}` : `${diffs.length} changed`}
            tone={diffs === null ? undefined : diffs.length === 0 ? "up" : "down"}
            sub="checked live on 3 contracts"
          />
          <Stat label="Proof re-check" value="10 min" sub="the keeper re-checks every builder's proof and marks badges to match" />
        </div>
        {diffs && diffs.length > 0 && (
          <ul className="pa-notice" data-tone="down">
            {diffs.map((d) => <li key={d}>{d}</li>)}
          </ul>
        )}
      </section>

      {/* Keys: what each wallet can and can't do */}
      <section className="pa-stack" aria-labelledby="t-keys">
        <h2 id="t-keys" className="pa-h2">Who holds the keys</h2>
        <div className="pa-grid">
          {WALLETS.map((w) => (
            <article key={w.key} className="pa-card pa-stack">
              <h3 className="pa-h3">{w.label}</h3>
              <Addr a={w.address} />
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
      </section>

      {/* Contracts */}
      <section className="pa-stack" aria-labelledby="t-contracts">
        <h2 id="t-contracts" className="pa-h2">Contracts</h2>
        <p className="pa-muted">
          Deployed {DEPLOY.date} at block {DEPLOY.block.toLocaleString("en-US")}, source verified on the explorer. Market contracts go
          live on {BUILDERS.label} after their audit.
        </p>
        <div className="pa-grid">
          {CONTRACTS.map((ct) => (
            <article key={ct.key} className="pa-card pa-stack">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="pa-h3">{ct.name}</h3>
                <span className="pa-pill" data-tone="ok">{ct.audit}</span>
              </div>
              <p className="pa-small">{ct.what}</p>
              <Addr a={ct.address} />
            </article>
          ))}
        </div>
      </section>

      {/* Record */}
      <section className="pa-stack" aria-labelledby="t-record">
        <h2 id="t-record" className="pa-h2">Public record</h2>
        <div className="pa-card">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="pa-h3">Verified Builder Badges</h3>
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
        <ol className="pa-stack">
          {RECORD.map((r) => (
            <li key={`${r.date}-${r.title}`} className="pa-card">
              <p className="pa-muted pa-small">{r.date}</p>
              <p className="pa-h3 mt-1">{r.title}</p>
              {r.detail && <p className="mt-1">{r.detail}</p>}
              {r.address && <p className="pa-small mt-1"><a className="pa-link" href={addrUrl(r.address)} target="_blank" rel="noreferrer">on the explorer ↗</a></p>}
              {r.tx && <p className="pa-small mt-1"><a className="pa-link" href={`${EXPLORER}/tx/${r.tx}`} target="_blank" rel="noreferrer">transaction ↗</a></p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

"use client";

import useSWR from "swr";
import { parseAbi, type Address, type PublicClient } from "viem";
import { CopyButton } from "@/components/perennial/CopyButton";
import { buildersClient } from "@/components/verify/useMyBuilder";
import { accessControlAbi } from "@/lib/builders-onboarder";
import { BUILDERS } from "@/lib/builders-network";
import { usdText, who } from "@/lib/plain-words";
import { badgeAbi } from "@/lib/verified-builder-badge";
import { BUYBACK, CONTRACTS, DEPLOY, FEE_SPLITS, RECORD, ROLES, WALLETS, holderLabel, nativeToUsdc } from "@/lib/transparency";

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
  roles: Record<string, boolean>;
  owners: Address[];
  threshold: bigint;
  safeNonce: bigint;
  balances: Record<string, bigint>;
  txCounts: Record<string, number>;
  regi: { supply: bigint; decimals: number; burned: bigint };
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
  const [roles, owners, threshold, safeNonce, balances, txCounts, supply, decimals, burned, nextSerial] = await Promise.all([
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
    roles: Object.fromEntries(roles),
    owners,
    threshold,
    safeNonce,
    balances: Object.fromEntries(balances),
    txCounts: Object.fromEntries(txCounts),
    regi: { supply, decimals, burned },
    badges,
  };
}

/** A token amount (any decimals) as a grouped whole number. */
function tokens(v: bigint, decimals: number): string {
  return (v / 10n ** BigInt(decimals)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

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
    errorRetryCount: 4,
    errorRetryInterval: 8_000,
  });
  const reading = !live && !error;

  return (
    <div className="flex flex-col gap-12">
      <header>
        <h1 className="pa-h1">Transparency</h1>
        <p className="pa-lede">
          Every wallet, role and contract behind Registrai on {BUILDERS.label}, read live from the chain. Anyone can check each
          number on the explorer; this page just puts them in one place.
        </p>
        {error && <p className="pa-notice mt-4" data-tone="down">Couldn&apos;t read {BUILDERS.label} right now. Retrying.</p>}
        {reading && <p className="pa-muted mt-4">Reading {BUILDERS.label}…</p>}
      </header>

      {/* 1 · keys */}
      <section className="pa-stack" aria-labelledby="t-keys">
        <h2 id="t-keys" className="pa-h2">Who holds the keys</h2>
        <div className="pa-grid">
          {WALLETS.map((w) => (
            <article key={w.key} className="pa-card pa-stack">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="pa-h3">{w.label}</h3>
                <span className="pa-muted pa-small tnum">
                  {live ? `${w.isSafe ? "holds " : ""}${usdText(nativeToUsdc(live.balances[w.key] ?? 0n))}${w.isSafe ? "" : " for gas"}` : "…"}
                </span>
              </div>
              <Addr a={w.address} />
              <p>{w.what}</p>
              <p className="pa-muted pa-small"><b>Can&apos;t:</b> {w.cannot}</p>
              {w.isSafe ? (
                <p className="pa-small">
                  {live ? (
                    <>
                      {live.threshold.toString()} of {live.owners.length} owners must sign · {live.safeNonce.toString()} transactions executed.
                      Owners: {live.owners.map((o, i) => (
                        <span key={o}>{i > 0 && ", "}<a className="pa-link" href={addrUrl(o)} target="_blank" rel="noreferrer">{who(o)}</a></span>
                      ))}
                    </>
                  ) : "…"}
                </p>
              ) : (
                <p className="pa-small pa-muted">{live ? `${live.txCounts[w.key] ?? 0} transactions sent` : "…"}</p>
              )}
            </article>
          ))}
        </div>

        <h3 className="pa-h3 mt-6">Roles on chain</h3>
        <p className="pa-muted pa-small max-w-[70ch]">
          Read live with each contract&apos;s <code>hasRole</code> for the wallets above. Roles are checked for these wallets; the
          explorer shows every RoleGranted and RoleRevoked event if you want the full history.
        </p>
        <div className="pa-card overflow-x-auto">
          <table className="w-full text-left">
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
                      <td className="py-2 pa-small">{holders === null ? "…" : holders.length ? holders.map((h) => h.label).join(", ") : <span className="pa-muted">none of these wallets</span>}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2 · money */}
      <section className="pa-stack" aria-labelledby="t-money">
        <h2 id="t-money" className="pa-h2">Where the money goes</h2>
        <p className="pa-notice">Markets aren&apos;t live on {BUILDERS.label} yet, so no trading fees have been collected. When they open, every fee splits like this:</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {FEE_SPLITS.map((s) => (
            <article key={s.market} className="pa-card pa-stack">
              <h3 className="pa-h3">{s.market}</h3>
              <p className="pa-muted pa-small">A 1% fee on every buy and sell:</p>
              {s.legs.map((l) => (
                <div key={l.to} className="pa-kv"><span><b className="text-fg">{l.pct}%</b></span><span className="text-left">{l.to}</span></div>
              ))}
            </article>
          ))}
        </div>
      </section>

      {/* 3 · buyback */}
      <section className="pa-stack" aria-labelledby="t-buyback">
        <h2 id="t-buyback" className="pa-h2">REGI buyback and burn</h2>
        <div className="pa-card pa-stack">
          <p>
            A share of the treasury&apos;s fee income from common markets
            {BUYBACK.shareOfTreasuryPct !== null ? ` (${BUYBACK.shareOfTreasuryPct}%)` : ""} collects in a buyback contract. Every time it
            reaches <b>${BUYBACK.triggerUsdc}</b>, it buys REGI in {BUYBACK.triggerUsdc / BUYBACK.chunkUsdc} pieces of ${BUYBACK.chunkUsdc} and
            sends every token straight to the burn address, where nobody can ever move it.
          </p>
          <p className="pa-muted pa-small">Starts with common markets on {BUILDERS.label}. {BUYBACK.shareOfTreasuryPct === null ? "The share is announced before launch." : ""}</p>
          <div className="pa-kv"><span>REGI total supply</span><span className="tnum">{live ? tokens(live.regi.supply, live.regi.decimals) : "…"}</span></div>
          <div className="pa-kv"><span>At the burn address today</span><span className="tnum">{live ? `${tokens(live.regi.burned, live.regi.decimals)} REGI` : "…"}</span></div>
          <div className="pa-kv"><span>Burn address</span><Addr a={BUYBACK.burnAddress} /></div>
          <div className="pa-kv"><span>Token</span><Addr a={BUYBACK.token} /></div>
          <p className="pa-small"><a className="pa-link" href={BUYBACK.poolUrl} target="_blank" rel="noreferrer">The REGI/USDC pool on DexScreener ↗</a></p>
        </div>
      </section>

      {/* 5 · contracts */}
      <section className="pa-stack" aria-labelledby="t-contracts">
        <h2 id="t-contracts" className="pa-h2">Contracts</h2>
        <p className="pa-muted">
          Deployed {DEPLOY.date} at block {DEPLOY.block.toLocaleString("en-US")}. Source code is verified on the explorer. Markets
          contracts are not deployed on {BUILDERS.label} yet: they go live after their audit.
        </p>
        <div className="pa-grid">
          {CONTRACTS.map((ct) => (
            <article key={ct.key} className="pa-card pa-stack">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="pa-h3">{ct.name}</h3>
                <span className="pa-pill" data-tone="ok">{ct.audit}</span>
              </div>
              <p>{ct.what}</p>
              <Addr a={ct.address} />
            </article>
          ))}
        </div>
      </section>

      {/* 7 · record */}
      <section className="pa-stack" aria-labelledby="t-record">
        <h2 id="t-record" className="pa-h2">Public record</h2>
        <div className="pa-card">
          <h3 className="pa-h3">Verified Builder Badges issued</h3>
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
          ) : <p className="pa-muted mt-2">…</p>}
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

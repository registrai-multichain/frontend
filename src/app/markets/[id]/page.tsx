import { notFound } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { PriceChart } from "@/components/PriceChart";
import { TradePanel } from "@/components/TradePanel";
import { VerifiableBadge } from "@/components/VerifiableBadge";
import { DEMO_MARKETS, findMarket } from "@/lib/markets-demo";
import { fmtInt, isoDate, isoDateTime, shortAddr, shortHash } from "@/lib/format";

export function generateStaticParams() {
  return DEMO_MARKETS.map((m) => ({ id: m.id }));
}

export const dynamicParams = false;

export default function MarketPage({ params }: { params: { id: string } }) {
  const market = findMarket(params.id);
  if (!market) notFound();

  const yesPrice = market.noReserve / (market.yesReserve + market.noReserve);
  const noPrice = 1 - yesPrice;
  const totalVolume = market.history.reduce((s, t) => s + t.collateral, 0);
  const daysToExpiry = Math.max(0, Math.ceil((market.expiry - Date.now() / 1000) / 86_400));

  return (
    <Shell>
      <article className="pt-10 sm:pt-14 fade-up">
        <Link
          href="/markets"
          className="caption text-fg-dim hover:text-accent transition-colors"
        >
          ← markets
        </Link>

        <div className="mt-4 mb-6">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <div className="caption">market · {shortHash(market.id)}</div>
            {market.verifiable && <VerifiableBadge rule={market.rule} />}
          </div>
          <h1 className="font-serif text-[26px] sm:text-[32px] tracking-tightest leading-[1.1] max-w-[42ch]">
            {market.title}
          </h1>
          <div className="mt-4 flex items-center gap-3 text-2xs text-fg-mute">
            <span>resolves against</span>
            <Link
              href={`/feed/${market.feedId}`}
              className="border border-line px-2 py-1 hover:border-accent hover:text-accent transition-colors"
            >
              {market.feedSymbol}
            </Link>
            <span className="text-fg-dim">·</span>
            <span>{daysToExpiry}d to expiry · {isoDate(market.expiry)}</span>
          </div>
        </div>

        <section className="border-t border-b border-line py-8 mb-8">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
            <div>
              <div className="flex items-baseline gap-6 mb-4">
                <div>
                  <div className="caption text-up mb-1">YES · resolves true</div>
                  <div className="text-[44px] sm:text-[56px] leading-none tracking-tightest tnum">
                    {(yesPrice * 100).toFixed(1)}<span className="text-fg-mute text-[20px]">¢</span>
                  </div>
                </div>
                <div>
                  <div className="caption text-down mb-1">NO · resolves false</div>
                  <div className="text-[36px] sm:text-[44px] leading-none tracking-tightest tnum text-fg-mute">
                    {(noPrice * 100).toFixed(1)}<span className="text-[18px]">¢</span>
                  </div>
                </div>
              </div>
              <div className="mt-6">
                <PriceChart trades={market.history} />
              </div>
            </div>

            <TradePanel market={market} />
          </div>
        </section>

        {/* Resolution rule */}
        <section className="mb-10">
          <div className="caption mb-3">resolution rule</div>
          <div className="border border-line bg-bg-elev/40 p-5">
            <p className="text-[13.5px] leading-relaxed text-fg max-w-[68ch]">
              At <span className="text-accent tnum">{isoDateTime(market.expiry)}</span>{" "}
              UTC, the market reads <code className="text-fg-mute">Attestation.valueAt({shortHash(market.feedId)}, {shortAddr(market.agent)}, {market.expiry})</code>.
              If the returned value <span className="text-accent">{market.comparator}</span>{" "}
              <span className="text-accent tnum">{fmtInt(market.threshold)}</span>{" "}
              {market.unit}, <span className="text-up">YES wins</span>. Otherwise{" "}
              <span className="text-down">NO wins</span>. The attestation must be
              finalized (past its dispute window) for resolution to succeed.
            </p>
            <p className="text-[12.5px] leading-relaxed text-fg-mute mt-4 max-w-[68ch]">
              No human resolves this. The contract reads the value, applies the
              comparator, and settles. If the agent never attested at or before
              expiry, the market sits unresolved until one does.
            </p>
            {market.verifiable && market.rule && (
              <p className="text-[12.5px] leading-relaxed text-fg-mute mt-4 max-w-[68ch] border-t border-line pt-4">
                <span className="text-up">Verifiable feed.</span> The attested
                value was not computed off-chain — the agent submitted the raw
                input vector to{" "}
                <a
                  href={`https://testnet.arcscan.app/address/${market.rule}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline tnum"
                >
                  {market.rule.slice(0, 10)}…{market.rule.slice(-6)}
                </a>
                , which deterministically computed the median onchain. Anyone
                can pull the inputHash from the attestation, recover the
                rawInputs from the tx calldata, re-call the rule, and confirm
                the value byte-for-byte.
              </p>
            )}
          </div>
        </section>

        {/* Spec strip */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-y-6 gap-x-8 mb-12 text-[13px]">
          <Spec label="feed" value={shortHash(market.feedId)} />
          <Spec label="agent" value={shortAddr(market.agent)} />
          <Spec label="threshold" value={`${fmtInt(market.threshold)} ${market.unit}`} />
          <Spec label="comparator" value={market.comparator} />
          <Spec label="expiry" value={isoDate(market.expiry)} />
          <Spec label="initial liquidity" value={`${fmtInt(market.liquidity / 1e6)} USDC`} />
          <Spec label="volume" value={`${fmtInt(totalVolume)} USDC`} />
          <Spec label="trades" value={String(market.history.length)} />
        </section>

        {/* History */}
        <section>
          <div className="caption mb-3">recent trades</div>
          {market.history.length === 0 ? (
            <div className="border border-dashed border-line/60 p-8 text-center">
              <p className="font-serif italic text-fg-mute text-[15px] leading-snug max-w-[42ch] mx-auto">
                Market just opened — awaiting first trade.
              </p>
              <p className="text-2xs text-fg-dim mt-3">
                Connect a wallet above to take the first position. Initial odds
                are 50/50 by construction; the next trade moves the curve.
              </p>
            </div>
          ) : (
          <div className="border border-line">
            <Row head cells={["time", "side", "price", "size"]} />
            {[...market.history]
              .slice(-12)
              .reverse()
              .map((t, i) => (
                <Row
                  key={i}
                  cells={[
                    <span className="text-fg-mute" key="t">
                      {isoDateTime(t.ts)}
                    </span>,
                    <span
                      className={t.side === "yes" ? "text-up caption" : "text-down caption"}
                      key="s"
                    >
                      {t.side === "yes" ? "● YES" : "● NO"}
                    </span>,
                    <span className="tnum" key="p">
                      {(t.yesPrice * 100).toFixed(1)}¢
                    </span>,
                    <span className="tnum text-fg-mute" key="sz">
                      {fmtInt(t.collateral)} USDC
                    </span>,
                  ]}
                />
              ))}
          </div>
          )}
        </section>
      </article>
    </Shell>
  );
}

function Spec({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="caption mb-1.5">{label}</div>
      <div className="text-fg">{value}</div>
    </div>
  );
}

function Row({ head, cells }: { head?: boolean; cells: React.ReactNode[] }) {
  return (
    <div
      className={`grid grid-cols-[1.4fr_0.8fr_0.8fr_1fr] gap-2 px-4 py-2.5 items-center ${
        head ? "caption border-b border-line bg-bg-elev/40" : "border-b border-line/60 last:border-0 hover:bg-bg-elev/40 transition-colors"
      } text-[12.5px]`}
    >
      {cells.map((c, i) => (
        <div key={i}>{c}</div>
      ))}
    </div>
  );
}

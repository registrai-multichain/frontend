import { notFound } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { TradePanel } from "@/components/TradePanel";
import { VerifiableBadge } from "@/components/VerifiableBadge";
import { FaucetHint } from "@/components/FaucetHint";
import { DEMO_MARKETS, findMarket } from "@/lib/markets-demo";
import { FEED_EXPLAINERS, MARKET_HOOKS } from "@/lib/market-context";
import { MarketDescriptionLive } from "@/components/MarketDescriptionLive";
import { fmtInt, isoDate, isoDateTime, shortAddr, shortHash } from "@/lib/format";

export function generateStaticParams() {
  return DEMO_MARKETS.map((m) => ({ id: m.id }));
}

export const dynamicParams = false;

export default function MarketPage({ params }: { params: { id: string } }) {
  const market = findMarket(params.id);
  if (!market) notFound();

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

        <FaucetHint className="mb-8" />

        {/* Two-column: context on the left (scrolls), trade panel sticky on right */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10 mb-12">
          {/* LEFT — what is this market */}
          <div className="space-y-8 min-w-0">
            {(() => {
              const explainer = FEED_EXPLAINERS[market.feedSymbol];
              const hook = MARKET_HOOKS[market.id];
              return (
                <section>
                  <div className="caption mb-3">about</div>
                  <div className="border border-line bg-bg-elev/30 p-5 space-y-4">
                    {explainer && (
                      <>
                        <p className="text-[14.5px] leading-snug text-fg font-serif italic">
                          {explainer.headline}
                        </p>
                        <p className="text-[13px] leading-relaxed text-fg-mute">
                          {explainer.body}
                        </p>
                        <p className="text-2xs text-fg-dim leading-relaxed">
                          Source · {explainer.source}
                        </p>
                      </>
                    )}
                    <MarketDescriptionLive marketId={market.id} fallback={hook} />
                  </div>
                </section>
              );
            })()}

            {/* Resolution rule */}
            <section>
              <div className="caption mb-3">resolution rule</div>
              <div className="border border-line bg-bg-elev/40 p-5">
                <p className="text-[13.5px] leading-relaxed text-fg">
                  At <span className="text-accent tnum">{isoDateTime(market.expiry)}</span>{" "}
                  UTC, the market reads{" "}
                  <code className="text-fg-mute break-all">
                    Attestation.valueAt({shortHash(market.feedId)},{" "}
                    {shortAddr(market.agent)}, {market.expiry})
                  </code>
                  . If the returned value{" "}
                  <span className="text-accent">{market.comparator}</span>{" "}
                  <span className="text-accent tnum">{fmtInt(market.threshold)}</span>{" "}
                  {market.unit}, <span className="text-up">YES wins</span>. Otherwise{" "}
                  <span className="text-down">NO wins</span>.
                </p>
                <p className="text-[12.5px] leading-relaxed text-fg-mute mt-4">
                  No human resolves this. The contract reads the value, applies the
                  comparator, settles. If the agent never attested at or before
                  expiry, the market sits unresolved until one does.
                </p>
                {market.verifiable && market.rule && (
                  <p className="text-[12.5px] leading-relaxed text-fg-mute mt-4 border-t border-line pt-4">
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
            <section className="grid grid-cols-2 sm:grid-cols-3 gap-y-5 gap-x-6 text-[12.5px]">
              <Spec label="feed" value={shortHash(market.feedId)} />
              <Spec label="agent" value={shortAddr(market.agent)} />
              <Spec label="threshold" value={`${fmtInt(market.threshold)} ${market.unit}`} />
              <Spec label="comparator" value={market.comparator} />
              <Spec label="expiry" value={isoDate(market.expiry)} />
              <Spec label="initial liquidity" value={`${fmtInt(market.liquidity / 1e6)} USDC`} />
            </section>
          </div>

          {/* RIGHT — trade */}
          <aside className="lg:sticky lg:top-24 h-fit">
            <TradePanel market={market} />
          </aside>
        </div>

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


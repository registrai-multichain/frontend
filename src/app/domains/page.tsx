import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { SuffixPanel } from "@/components/SuffixPanel";
import { SuffixTradePanel } from "@/components/SuffixTradePanel";
import { FaucetHint } from "@/components/FaucetHint";
import { getPool } from "@/lib/suffix-pools";

export const metadata = {
  title: "Suffix Pool ($ai) · Registrai",
  description:
    "A two-token treasury: $ai (senior, cash-floored) + $aiLP (junior, first-loss/upside), backed by .ai domains marked via a bonded Registrai oracle. Testnet research.",
};

export default function DomainsPage() {
  const ai = getPool("ai")!;
  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="caption">$ai · suffix pool</div>
          <StatusBadge kind="beta" />
          <span className="caption text-fg-dim text-[10px]">testnet · cash-floored memecoin</span>
        </div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-6 max-w-[24ch]">
          A memecoin with a <span className="italic text-accent">floor</span>.
        </h1>
        <p className="text-fg-mute text-[15px] leading-relaxed max-w-[66ch] mb-10">
          <b>$ai</b> trades like any memecoin — but it has a <b>cash-backed buyback floor</b>. The
          protocol owns the liquidity, market-makes its own pool, and every trade&apos;s fee plus any
          froth above the band ratchets the floor higher. Buy and sell freely above the floor; if the
          pool ever dips below it, sell straight to the treasury at the floor price. The floor is
          backed by the <b>USDC reserve</b> today — real <span className="italic">.ai</span>-domain
          backing (marked by a bonded Registrai oracle) is a post-mainnet roadmap item, not present
          now and not a reason to buy.
        </p>

        <FaucetHint className="mb-6" />

        <div className="mb-6 border border-amber-500/30 bg-amber-500/5 p-3 text-2xs text-amber-300/80 leading-relaxed">
          <b>Testnet · not financial advice · not an offer.</b> $ai is a testnet token with a
          cash buyback-floor policy (not a redemption right or profit promise). The junior tranche
          <span className="text-fg-mute"> $aiLP is a security and is NOT offered or tradeable here.</span>{" "}
          Real-asset backing is a future roadmap item. Do your own research.
        </div>

        <SuffixTradePanel pool={ai} />

        <SuffixPanel pool={ai} />

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-px bg-line">
          <Card
            title="the floor is cash, not vibes"
            body="$ai's floor is backed only by hard, liquid value — the USDC reserve + realized gains. It ratchets up from real revenue (pool fees, froth harvest), never from unrealized domain marks. Boring floors are the ones that survive a crash."
          />
          <Card
            title="junior eats losses first"
            body="$aiLP is a pre-funded first-loss buffer beneath the senior, with a locked minimum cushion. A drawdown burns junior equity before it can ever touch the $ai floor. The protocol never mints junior to defend senior — the LUNA failure mode is structurally impossible."
          />
          <Card
            title="the oracle does the marking"
            body="The .ai domain upside is marked by a bonded, slashable Registrai segment index — junior-only signal, gated on data quality, never floor backing. The treasury and floor settle in USDC on Arc; Registrai stays neutral oracle infrastructure."
          />
        </div>

        <div className="mt-12 border border-dashed border-line/60 p-6 text-[13px] text-fg-mute">
          <span className="font-serif italic">Status.</span> Research, testnet only. The economic core
          is built and tested (cash floor, anti-LUNA waterfall, protocol-owned revenue engine, froth
          harvest, competitive Dutch-auction MM, cap + timelock-governable admin). Still ahead before
          any real launch: legal structuring of the $aiLP offering, a denser <span className="italic">.ai</span>{" "}
          data feed for the index, and the domain-acquisition/custody layer (gated on Doma
          tokenization). See the design + tokenomics specs in the repo.
        </div>
      </article>
    </Shell>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-bg p-5">
      <h3 className="font-serif text-[18px] leading-snug mb-3 max-w-[24ch]">{title}</h3>
      <p className="text-[12.5px] text-fg-mute leading-relaxed">{body}</p>
    </div>
  );
}

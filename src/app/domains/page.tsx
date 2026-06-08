import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { SuffixPanel } from "@/components/SuffixPanel";

export const metadata = {
  title: "Suffix Pool ($ai) · Registrai",
  description:
    "A two-token treasury: $ai (senior, cash-floored) + $aiLP (junior, first-loss/upside), backed by .ai domains marked via a bonded Registrai oracle. Testnet research.",
};

export default function DomainsPage() {
  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="caption">suffix pool</div>
          <StatusBadge kind="beta" />
          <span className="caption text-fg-dim text-[10px]">research · testnet · read-only</span>
        </div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-6 max-w-[24ch]">
          A meme with a <span className="italic text-accent">floor</span>, backed by the oracle.
        </h1>
        <p className="text-fg-mute text-[15px] leading-relaxed max-w-[66ch] mb-10">
          The Suffix Pool splits one treasury into two tokens. <b>$ai</b> (senior) is the boring
          leg: a cash-backed buyback floor that ratchets up only from realized revenue. <b>$aiLP</b>{" "}
          (junior) is the leveraged leg: it absorbs losses first and captures the upside. The treasury
          market-makes a protocol-owned pool; trading fees and froth harvest the floor higher. The{" "}
          <span className="italic">.ai</span> domain exposure — marked by a bonded Registrai oracle —
          lives in the junior&apos;s upside, never in the floor. Registrai stays pure oracle infra
          underneath.
        </p>

        <div className="mb-6 border border-amber-500/30 bg-amber-500/5 p-3 text-2xs text-amber-300/80 leading-relaxed">
          <b>Read-only.</b> These are live testnet contracts shown for transparency. There is no
          trading interface: <span className="text-fg-mute">$aiLP is a security</span> and any
          offering is gated on legal review. Nothing here is an offer to sell or a solicitation, and
          the floor is a protocol policy, not a redemption right.
        </div>

        <SuffixPanel />

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

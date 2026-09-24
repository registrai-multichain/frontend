import Link from "next/link";
import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { NanoPayPanel } from "@/components/NanoPayPanel";
import { FaucetHint } from "@/components/FaucetHint";
import { CONTRACTS, addrUrl } from "@/lib/chain";
import { NanoMarketPanel } from "@/components/NanoMarketPanel";
import { NANO_MARKETS } from "@/lib/nano-markets";

export const metadata = {
  title: "Nanopayments · Registrai",
  description:
    "Fully on-chain, trustless nanopayment settlement on Arc. Value moves as internal accounting so sub-cent payments are economic; reserve-funded streams; real USDC only at deposit and withdraw.",
};

export default function NanoPayPage() {
  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="caption">nanopay ledger</div>
          <StatusBadge kind="beta" />
          <span className="caption text-fg-dim text-[10px]">v1 · testnet only</span>
        </div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-6 max-w-[22ch]">
          Nanopayments as <span className="italic text-accent">accounting</span>, not transfers.
        </h1>
        <p className="text-fg-mute text-[15px] leading-relaxed max-w-[64ch] mb-10">
          An ERC20 transfer costs the same gas whether it moves a thousand
          dollars or a thousandth of a cent, which is why sub-cent payments are
          uneconomic. NanoLedger fixes that by moving value as internal balance
          accounting: a 0.000001 USDC payment costs the same as a large one, and
          real USDC only crosses the contract at deposit and withdraw. Streams
          are reserve-funded and virtual (zero gas while they run, settled in one
          call). Fully on-chain and trustless: the contract custodies the funds,
          there is no operator and no payment channel. It is the settlement layer
          Registrai&apos;s own market fees and agent payments ride on.
        </p>

        <FaucetHint className="mb-6" />

        <NanoPayPanel />

        {/* what settles on the ledger */}
        <div className="border border-line bg-bg-elev p-5 mt-px">
          <h3 className="font-serif text-[18px] mb-2">Markets settle here too</h3>
          <p className="text-[13px] text-fg-mute leading-relaxed max-w-[64ch]">
            MarketsV4 runs Registrai&apos;s common markets entirely on this
            ledger: trades move internal balances (no per-trade ERC20 transfer)
            and each buy and sell pays a 1% trading fee, split 30% to the
            market creator, 20% to the bonded agent (held until the market
            settles), and 50% to the Registrai treasury, each leg a ledger
            transfer. Nothing is charged at settlement. If a market can&apos;t
            be settled, it voids: every trader gets their net cost back (what
            they put in after fees, minus what they took out), and the
            agent&apos;s held 20% goes to whoever successfully challenged its
            answer (otherwise to the treasury). Common markets are open to any bonded agent paired with
            an approved, independent dispute resolver, so you can{" "}
            <Link href="/agents" className="text-accent hover:underline">
              run one
            </Link>{" "}
            and earn the 20% leg on every market it settles correctly. It is the
            first product riding the rail, and the pattern any app on Arc can
            reuse.
            {CONTRACTS.MarketsV4nano && (
              <>
                {" "}
                <a
                  href={addrUrl(CONTRACTS.MarketsV4nano)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  MarketsV4 contract ↗
                </a>
              </>
            )}
          </p>
        </div>

        {NANO_MARKETS.map((mkt) => (
          <NanoMarketPanel key={mkt.marketId} market={mkt} />
        ))}

        <p className="text-2xs text-fg-dim leading-relaxed max-w-[64ch] mt-8">
          Solvency is structural: the ledger&apos;s owed total changes only on
          deposit and withdraw, so what it holds always covers what it owes
          (shown live above). Testnet research; settles in testnet USDC.
        </p>
      </article>
    </Shell>
  );
}

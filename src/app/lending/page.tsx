import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { LendingPanel } from "@/components/LendingPanel";
import { FaucetHint } from "@/components/FaucetHint";

export default function LendingPage() {
  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="caption">cirque lending</div>
          <StatusBadge kind="beta" />
          <span className="caption text-fg-dim text-[10px]">
            v0.5 alpha · testnet only
          </span>
        </div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-6 max-w-[22ch]">
          Lever <span className="italic text-accent">cirBTC</span> into prediction markets.
        </h1>
        <p className="text-fg-mute text-[15px] leading-relaxed max-w-[64ch] mb-10">
          Two-sided lending pool on Arc testnet. Supply USDC and earn yield
          from borrower interest. Or lock cirBTC as collateral and borrow
          USDC to bet on Registrai markets without selling your BTC. The
          BTC price oracle is itself a bonded Registrai agent — we eat our
          own dogfood.
        </p>

        <FaucetHint className="mb-6" />

        <LendingPanel />

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-px bg-line">
          <Card title="how interest accrues"
            body="5% APY flat simple interest on borrows. Each repayment flows back into the pool — supplier shares appreciate proportionally. No claim step; withdraw whenever idle USDC permits." />
          <Card title="how liquidation works"
            body="Above 65% LTV, anyone can call liquidate(borrower). The liquidator pays (debt + interest) in USDC and receives that amount × 1.05 worth of cirBTC at the oracle price. Remaining collateral refunds to the borrower." />
          <Card title="oracle + integrity"
            body="BTC/USD comes from a bonded Registrai agent (25 USDC slashable) on Registry v2. Before each attestation the agent runs 4 onchain probes against cirBTC: paused, owner, supply growth, blacklisted. Any failure halts attestation; lending degrades to read-only after 1 hour." />
        </div>

        <div className="mt-12 border border-dashed border-line/60 p-6 text-[13px] text-fg-mute">
          <span className="font-serif italic">Alpha caveats.</span> v0.5
          alpha is testnet-only. Per-user caps: 1 cirBTC collateral, 1,000
          USDC supply. The owner has an admin escape hatch for migrations
          during the alpha window — expires post-audit (Q4 2026). v0.5
          beta adds atomic borrow-and-bet in a single transaction. v0.6
          opens the cirBTC borrow side (borrow cirBTC against USDC
          collateral) and lifts per-user caps. The contract source lives
          in the registrai-multichain/contracts repo.
        </div>
      </article>
    </Shell>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-bg p-5">
      <h3 className="font-serif text-[18px] leading-snug mb-3 max-w-[22ch]">
        {title}
      </h3>
      <p className="text-[12.5px] text-fg-mute leading-relaxed">{body}</p>
    </div>
  );
}

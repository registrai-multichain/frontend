import { Shell } from "@/components/Shell";
import { VaultPanel } from "@/components/VaultPanel";
import { FaucetHint } from "@/components/FaucetHint";
import { StatusBadge } from "@/components/StatusBadge";

export default function VaultPage() {
  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="caption">market-maker vault</div>
          <StatusBadge kind="beta" />
        </div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-6 max-w-[20ch]">
          Pooled liquidity for the{" "}
          <span className="italic text-accent">long tail</span>.
        </h1>
        <p className="text-fg-mute text-[15px] leading-relaxed max-w-[64ch] mb-10">
          Deposit USDC into a permissionless vault. An onchain operator
          deploys it as buy-side and LP liquidity across niche markets,
          targeting prices derived from each agent&apos;s latest attestation.
          Resolved winnings flow back into the vault; depositors burn shares
          to withdraw their pro-rata slice. The vault is the simplest way to
          earn yield from being right about Polish CPI, Warsaw real estate,
          and ECB rate decisions without trading any of them yourself.
        </p>

        <FaucetHint className="mb-6" />

        <VaultPanel />

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-px bg-line">
          <Card title="how shares price"
            body="On deposit, shares mint pro-rata to the vault's USDC balance. v1 NAV is conservative — open outcome positions are not marked-to-market. Withdrawers leave unrealized PnL behind for the cohort remaining; depositors entering during open positions pay no premium for it." />
          <Card title="how trades route"
            body="Only the registered operator (currently us) can submit trades through the vault. Every buy, sell, and addLiquidity call emits an event onchain and is verifiable on ArcScan. Operator rotation is owner-gated; the operator cannot withdraw user funds, only route them into Markets contract calls." />
          <Card title="how revenue accrues"
            body="The vault pays the standard 70 bps trading fee on every buy. For markets where the operator is also the agent and creator, those fees flow back to the same wallet — fee-neutral. Net PnL = winning shares redeemed at $1 each + LP residuals at resolution, minus losing positions." />
        </div>

        <div className="mt-12 border border-dashed border-line/60 p-6 text-[13px] text-fg-mute">
          <span className="font-serif italic">v1 vault, conservative NAV.</span>{" "}
          Performance fees, mark-to-market NAV, and a fully permissionless
          operator role (anyone bonds + competes for the slot) are on the
          roadmap. The contract is{" "}
          <a
            href="https://github.com/registrai-multichain/contracts/blob/main/src/MarketMakerVault.sol"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            open source
          </a>
          ; the operator key is held by the deployer and rotation is
          single-owner-gated for the launch window.
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

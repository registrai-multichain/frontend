import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { BetBorrowPanel } from "@/components/BetBorrowPanel";
import { FaucetHint } from "@/components/FaucetHint";

export const metadata = {
  title: "Borrow against a bet · Registrai",
  description:
    "Borrow USDC against a prediction-market position you already hold, without selling it. Depth-capped collateral, bonded-oracle resolution, on Arc testnet.",
};

export default function BorrowPage() {
  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="caption">cirque bet lending</div>
          <StatusBadge kind="beta" />
          <span className="caption text-fg-dim text-[10px]">v0.9 · testnet only</span>
        </div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-6 max-w-[24ch]">
          Borrow against a <span className="italic text-accent">bet</span> you already hold.
        </h1>
        <p className="text-fg-mute text-[15px] leading-relaxed max-w-[64ch] mb-10">
          Your YES/NO position in a Registrai market is locked capital until the
          market resolves. Pledge it as collateral and borrow USDC against its
          live AMM mark — without selling. Suppliers earn the interest. The
          collateral is valued at a depth-capped mark (never above 10% of the
          opposite reserve) so a thin pool can&apos;t be manipulated into an
          over-loan, and every loan is force-closed before resolution so the
          pool never eats the binary cliff.
        </p>

        <FaucetHint className="mb-6" />

        <div className="mb-6 border border-line/60 bg-bg-elev/30 p-3 text-2xs text-fg-dim leading-relaxed">
          Transactions failing with{" "}
          <span className="text-fg-mute">&quot;JSON-RPC protocol not supported&quot;</span>?
          Set Arc Testnet&apos;s RPC URL to{" "}
          <code className="text-accent">https://rpc.testnet.arc.network</code>{" "}
          in your wallet.
        </div>

        <BetBorrowPanel />

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-px bg-line">
          <Card
            title="depth-capped collateral"
            body="A position is never valued above 10% of the pool's opposite-side reserve, with a 40% max LTV. A position's recoverable value is bounded by what the pool can actually pay out on liquidation — so spiking a thin AMM mark to over-borrow is net-negative. Validated by a 10,000-run adversarial fuzz."
          />
          <Card
            title="the cliff guard"
            body="Binary options resolve to exactly $1 or $0 — you can't margin-call that discontinuity. So loans are force-closeable by anyone in the 2h before expiry, with a 5% liquidator bonus, and a keeper writes off resolved-loser loans. In-the-money loans always self-close; the bounded residual on out-of-the-money loans is socialized honestly."
          />
          <Card
            title="fair liquidation"
            body="A liquidator takes only shares worth (owed × 1.05); the surplus returns to the borrower, sized off the mark recorded at origination so it can't be gamed by crashing spot mid-liquidation. Suppliers' idle USDC is tracked internally, so a token donation can't skew the share price."
          />
        </div>

        <div className="mt-12 border border-dashed border-line/60 p-6 text-[13px] text-fg-mute">
          <span className="font-serif italic">Testnet caveats.</span> v0.9
          research, testnet only. Per-user borrow cap 1,000 USDC; one open loan
          at a time. The eligibility floor (MIN_POOL_DEPTH) is scaled down for
          testnet play-money liquidity — mainnet uses 1,000 USDC/side. The
          ratio-based manipulation defense (10% depth cap + 40% LTV) is
          unchanged. Positions live on MarketsV3, a sibling of Markets v2 that
          adds an operator share-transfer primitive so a lending contract can
          custody collateral. A professional audit is warranted before real
          funds.
        </div>
      </article>
    </Shell>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-bg p-5">
      <h3 className="font-serif text-[18px] leading-snug mb-3 max-w-[22ch]">{title}</h3>
      <p className="text-[12.5px] text-fg-mute leading-relaxed">{body}</p>
    </div>
  );
}

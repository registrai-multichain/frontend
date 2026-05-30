import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";

interface Entry {
  date: string;
  title: string;
  body: React.ReactNode;
}

const ENTRIES: Entry[] = [
  {
    date: "2026-05-31",
    title: "Bet-as-collateral lending · built, reviewed, held back on a critical",
    body: (
      <>
        <p>
          Took a real run at the original cirBTC-era idea: borrow USDC
          against a prediction-market position you already hold — the
          &quot;locked betting capital becomes liquid&quot; primitive.
          Built two contracts, then an adversarial review caught a critical
          that we&apos;re choosing not to ship around. Logging it honestly.
        </p>
        <h3>Shipped: MarketsV3 share-transfer primitive</h3>
        <p>
          v2 prediction-market shares were non-transferable (pure
          msg.sender ledgers), so a position couldn&apos;t be used as
          collateral by any other contract.{" "}
          <code>MarketsV3</code> inherits Markets v2 unchanged and adds an
          ERC-20-allowance-style operator model (<code>setShareOperator</code>{" "}
          + <code>transferSharesFrom</code>) so a lending contract can
          custody a position. Sibling deploy, no migration — v2 markets keep
          running. 7 tests, clean review. This primitive is reusable and
          stands on its own.
        </p>
        <h3>Built but NOT deployed: CirqueBetLending</h3>
        <p>
          Lends USDC against a held YES/NO position, marked at the live AMM
          price. It solves the famous &quot;cliff-payoff&quot; problem (a
          share trades at 60¢ but resolves to exactly $1 or $0) with a
          force-close window: no loan may survive into resolution — anyone
          can liquidate in the final 2h regardless of health. That mechanism
          works and is proven by tests.
        </p>
        <p>
          <strong>But the adversarial review found a CRITICAL:</strong>{" "}
          marking binary collateral at the instantaneous AMM mid is
          manipulable on a thin pool. In one transaction an attacker could
          buy the opposite outcome to inflate their collateral&apos;s mark,
          borrow against the inflated value, and unwind — over-borrowing for
          only the ~0.7% round-trip fee. Spot-marking binary collateral on a
          thin CPMM is unsafe at any LTV.
        </p>
        <p>
          So we&apos;re <strong>holding it back</strong>, not patching around
          it. A safe version needs a manipulation-resistant mark (TWAP +
          depth-relative borrow caps), an incentivised force-close keeper, and
          bad-debt accounting — a v0.6 research track, not a same-day fix. The
          contract stays in-tree as a clearly-marked research reference (the
          known issues are written into its header); it is not deployed and
          not wired to the app. Shipping an exploitable lending contract to
          look busy would be the wrong call.
        </p>
        <p>
          147 contract tests pass (incl. the cliff-guard proofs). The honest
          status: the hard mechanism is solved; the safe collateral mark is
          the open problem.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-27",
    title: "Cirque v0.5 beta live · atomic leverage-and-bet · reviewed + redeployed",
    body: (
      <>
        <p>
          The headline cirBTC primitive is live on Arc testnet:{" "}
          <strong>lock cirBTC, borrow USDC, and buy YES/NO shares on a
          Registrai market in a single transaction.</strong> The borrowed
          USDC never touches your wallet — it goes straight into the bet.
          New CirqueLending at{" "}
          <ExtAddr addr="0x2dd7bc570e876499422b8185dbb04c4b134cd504" />,
          source-verified, pool seeded.
        </p>
        <h3>Position lifecycle</h3>
        <ul>
          <li><code>leverageAndBet</code> — open: lock cirBTC + borrow + buy, atomic</li>
          <li><code>closePosition</code> — sell shares while trading, settle from proceeds</li>
          <li><code>redeemAtExpiry</code> — after resolution: winning shares redeem at 1 USDC each; losing bet, cover the debt to reclaim cirBTC</li>
          <li>On liquidation, the position forfeits to the treasury (closes the moral-hazard hole where a bettor could let cirBTC liquidate yet keep a winning bet)</li>
        </ul>
        <h3>Full-power review before shipping</h3>
        <p>
          Three parallel adversarial reviews (accounting / security /
          edge-cases) ran against the new code. Three real findings, all
          fixed before deploy:
        </p>
        <ul>
          <li>
            <strong>Redeem-escrow commingling (critical):</strong> with
            multiple winners on one market, the first redeemer pulled
            everyone&apos;s winnings into the commingled balance, which
            could misprice supplier shares. Fixed with a per-market
            <code>redeemPot</code> escrow excluded from pool value.
          </li>
          <li>
            <strong>Never-resolve lockup (high):</strong> a market that
            expired but never resolved could trap a borrower&apos;s
            collateral forever. Fixed with an escape hatch.
          </li>
          <li>
            <strong>Treasury-sweep sandwich (medium):</strong> restricted
            sweeps to resolved markets (redeem at $1, zero slippage).
          </li>
        </ul>
        <p>
          131 contract tests pass. Two findings deferred to external audit
          with written rationale (first-depositor share inflation —
          griefing-only, capped; stale-oracle liquidation halt —
          deliberate). UI to expose the one-click flow lands next.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-26",
    title: "oracle-primitives extracted as a standalone fork-target",
    body: (
      <>
        <p>
          Pulled the bonded-agent oracle layer into its own MIT-licensed
          repository at{" "}
          <a
            href="https://github.com/registrai-multichain/oracle-primitives"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            registrai-multichain/oracle-primitives
          </a>
          {" "}— six audited Solidity primitives, stripped of every
          app-layer dependency, ready for any Arc builder to fork.
        </p>
        <h3>What got extracted</h3>
        <ul>
          <li><code>Registry.sol</code> — permissionless feed + bonded agent registration</li>
          <li><code>Attestation.sol</code> — value writes + dispute state machine</li>
          <li><code>Dispute.sol</code> — counter-bond + slashing</li>
          <li><code>AgentIdentity.sol</code> — global per-address profile</li>
          <li><code>rules/MedianRule.sol</code> · <code>rules/TrimmedMeanRule.sol</code> — verifiable onchain aggregation</li>
          <li>Foundry tests (65 passing), single-shot deploy script, two usage examples</li>
        </ul>
        <h3>What got stripped from the primitives</h3>
        <p>
          The deployed v2 stack integrates with{" "}
          <code>RegistraiPoints</code> via optional hooks in{" "}
          <code>Registry.setPoints()</code> and{" "}
          <code>Attestation.setPoints()</code>. Those hooks make the
          deployed bytecode &quot;app-aware&quot; — useful for the live
          credit system, noise for a clean fork target. Removed entirely
          in the primitives repo. Same with{" "}
          <code>PointsValues</code> constants. The primitives are now
          zero-coupling to any specific application.
        </p>
        <h3>Why this matters</h3>
        <p>
          Arc OSS Showcase asks specifically for &quot;standalone,
          infra-focused repos that other builders can pick up.&quot; The
          full <code>registrai-multichain/contracts</code> repo has
          Markets, Cirque lending, and the credit system bundled — the
          full production app, not the primitive. Extracting the oracle
          layer as its own repo answers the showcase&apos;s exact criteria
          and gives forkers a 870-line surface to work with instead of
          a 3000-line one.
        </p>
        <h3>Pre-tag audit pass</h3>
        <p>
          Caught one Solidity warning (unused <code>verifiable</code> parameter
          + dead <code>wasSlashable</code> local — vestigial from the Points
          strip) and cleaned both before tagging{" "}
          <code>v0.1.0</code>. Repo annotated with 8 topics
          (arc-network, oracle, defi, solidity, foundry, prediction-markets,
          circle-arc, usdc) for discoverability. All 65 tests still pass
          post-cleanup.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-25",
    title: "Audit pass · CirqueLending + AttestedBTCOracle redeployed · admin escape hatch removed",
    body: (
      <>
        <p>
          Pre-submission audit pass surfaced one critical + one high-priority
          finding worth fixing before the hackathon submission window closed.
          Both shipped as a coordinated redeploy.
        </p>
        <h3>C1 · adminWithdrawUSDC removed</h3>
        <p>
          The previous CirqueLending exposed an owner-only{" "}
          <code>adminWithdrawUSDC(amount)</code> with no balance check,
          documented as an &quot;alpha-only escape hatch.&quot; Real exposure is small
          (10 USDC TVL) but it&apos;s a hard centralization vector: compromise of
          the owner key would drain the entire pool including supplier funds
          and locked collateral USDC. Removed entirely. The treasury supplies
          via the same <code>supplyUSDC()</code> as any LP and withdraws
          via the same <code>withdrawUSDC()</code>. No special privilege.
        </p>
        <h3>H1 · AttestedBTCOracle MAX_LOOKBACK bumped 16 → 100</h3>
        <p>
          If 16 consecutive most-recent attestations were all in{" "}
          <code>DisputeStatus.Pending</code>, the adapter reverted —
          theoretical DoS vector. Each dispute requires a counter-bond
          (economically expensive), but the lookback ceiling provides cheap
          extra headroom. 100 attestations is comfortable; gas cost stays
          bounded.
        </p>
        <h3>F4 · methodology textarea locked during submission</h3>
        <p>
          The <code>/agents/create</code> form&apos;s methodology textarea is now
          disabled while a registration tx is in flight. Previously, a user
          could edit the text after the methodologyHash had been computed
          for the createFeed call but before the tx mined — the worker&apos;s
          signature-gated methodology-save would then reject the edited
          text with a hash mismatch.
        </p>
        <h3>Redeploy addresses</h3>
        <ul>
          <li>
            <code>AttestedBTCOracle</code>:{" "}
            <ExtAddr addr="0x83f3e3d6e9cc18579de577d92df1e23cc27057a1" />
          </li>
          <li>
            <code>CirqueLending</code>:{" "}
            <ExtAddr addr="0x1045edf68502091ef751ade2f1dc0d12cdc059dc" />
          </li>
        </ul>
        <p>
          Old contracts (<code>0x1acc24d0…</code> oracle, <code>0x8384690d…</code> lending)
          are now orphaned but still on-chain. Deployer&apos;s 10 USDC was withdrawn
          from the old pool and re-seeded into the new one before cutover.
          Worker keeper secret <code>CIRQUE_LENDING_ADDR</code> updated +
          worker redeployed; cron continues firing every 30 min.
        </p>
        <h3>Findings deferred to v0.5 beta</h3>
        <ul>
          <li>
            <strong>F5</strong> · social-oracle KV consistency race — narrow
            window (~5s), low real risk on testnet; would require Cloudflare
            Durable Objects refactor to truly fix
          </li>
          <li>
            <strong>F6</strong> · withdraw interest-distribution rounding —
            analysis showed the math self-corrects on borrower repay, no fund
            loss; cosmetic accounting drift only
          </li>
        </ul>
      </>
    ),
  },
  {
    date: "2026-05-23",
    title: "CirqueLending two-sided · USDC suppliers earn yield · live & verified",
    body: (
      <>
        <p>
          v0.5 alpha now fully two-sided. Anyone can supply USDC and earn
          yield from cirBTC-collateralised borrowers. Interest accrues to
          suppliers via share-price appreciation — no claim step needed.
          Re-deployed:
        </p>
        <ul>
          <li>
            <code>CirqueLending</code> (two-sided):{" "}
            <ExtAddr addr="0x8384690d25b8cc61b84e9f91de9e61d85e1e6adc" />
          </li>
          <li>
            <code>AttestedBTCOracle</code>:{" "}
            <ExtAddr addr="0x1acc24d074c4d0f8683c643f36c4a03dc6b0637a" />
          </li>
        </ul>
        <h3>Both sides of the lending mechanism</h3>
        <p>
          <strong>Supply side</strong>: <code>supplyUSDC(amount)</code>{" "}
          pulls USDC into the pool and mints proportional shares.
          <code>withdrawUSDC(shares)</code> burns shares and returns USDC
          at the current per-share value (principal + accrued interest).
          Withdrawals respect utilisation — if the pool&apos;s idle USDC
          is currently lent out, withdraw queues until borrowers repay.
        </p>
        <p>
          <strong>Borrow side</strong>: <code>borrow(cirBTC, USDC)</code>{" "}
          locks cirBTC as collateral and draws USDC at 5% APY flat.
          <code>repay()</code> returns principal + interest in USDC and
          unlocks the collateral. Interest flows back into the pool as
          accrued value — every supplier&apos;s shares appreciate
          proportionally.
        </p>
        <h3>Live verification</h3>
        <p>
          End-to-end supply cycle verified on Arc testnet:
        </p>
        <ul>
          <li>
            Deployer supplied 20 USDC →{" "}
            <code>shares = 20e6</code>, <code>balanceOfUSDC = 20e6</code> ✓
          </li>
          <li>
            Deployer withdrew 10 shares →{" "}
            <code>USDC out = 10e6</code> (1:1 since no borrows yet) ✓
          </li>
          <li>
            Pool state correctly reflects the partial withdraw:{" "}
            <code>totalShares = 10e6</code>, half remains as supplier
            position ✓
          </li>
        </ul>
        <p>
          Borrow side verified in 18 contract unit tests (full repo: 119
          pass, 0 fail). Live borrow requires cirBTC from{" "}
          <code>faucet.circle.com</code> — interactive faucet step is up
          to the user.
        </p>
        <h3>Accounting model</h3>
        <p>
          Standard Compound/Aave-style share accounting:
        </p>
        <ul>
          <li>
            Pool value = <code>idle_USDC + outstanding_principal +
            accrued_unrealized_interest</code>
          </li>
          <li>
            Share price = <code>pool_value / total_shares</code>
          </li>
          <li>
            On every supply / withdraw / borrow / repay / liquidate,{" "}
            <code>_rollAccrual()</code> rolls interest forward
            proportional to elapsed time and outstanding principal — so
            share value reflects real-time yield without iterating loans.
          </li>
          <li>
            Per-user caps for alpha: 1 cirBTC collateral, 1,000 USDC
            supply. Lifted in v0.5 beta after audit.
          </li>
        </ul>
        <h3>What changed vs the earlier v0.5 alpha</h3>
        <p>
          Original v0.5 alpha had only the borrow side (USDC pool seeded
          by treasury, no public supply). Today&apos;s deploy adds the
          full lender side properly — with share accounting that avoids
          the double-counting bug surfaced during the previous self-audit.
          The old <code>seedUSDC</code> admin path is gone; treasury (and
          everyone else) supplies via <code>supplyUSDC</code>, holds the
          same shares as any other LP, and earns the same yield. Interest
          no longer routes to a treasury wallet — it stays in the pool to
          compound for suppliers.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-23",
    title: "CirqueLending v0.5 alpha live on Arc testnet · dogfooded oracle",
    body: (
      <>
        <p>
          v0.5 alpha is deployed. The lending contract reads BTC prices
          from Registrai&apos;s own bonded-agent attestation layer — we
          eat our own dogfood instead of trusting an external keeper key.
        </p>
        <h3>Addresses</h3>
        <ul>
          <li>
            <code>AttestedBTCOracle</code>:{" "}
            <ExtAddr addr="0xf21506b430085ff851cc3fe0f210cde1d1dd6de8" />
          </li>
          <li>
            <code>CirqueLending</code>:{" "}
            <ExtAddr addr="0x5fa1dfeacbd0ed1ac35b217743efd829923ff384" />
          </li>
          <li>
            BTC/USD feed:{" "}
            <code>0x23a85cd7…aafe64c</code> on Registry v2 — bonded by
            keeper <ExtAddr addr="0x580a7791DBF10578ce1DBF7A7A438B16Ee9CAAfd" short />
            {" "}with 25 USDC slashable.
          </li>
        </ul>
        <h3>Why dogfooded</h3>
        <p>
          Original plan: owner-set oracle, Cloudflare Worker pushes prices
          every 5 minutes. Simple, but: hot key in production, single
          point of failure, no slash-on-bad-data property. Replaced with
          a bonded oracle agent on Registry v2 — same trust model as
          every other Registrai feed, just used internally by the lending
          product. If we attest a bad BTC price, anyone with 25 USDC can
          dispute and slash us. We hold ourselves to the same standard
          as our public-facing oracles.
        </p>
        <h3>cirBTC integrity probes — defense against Circle-side compromise</h3>
        <p>
          Using cirBTC means inheriting Circle&apos;s security. We
          don&apos;t blindly trust it — before every attestation the
          keeper runs four onchain probes:
        </p>
        <ul>
          <li>
            <code>cirBTC.paused()</code> must be <code>false</code> —
            Circle hasn&apos;t halted transfers.
          </li>
          <li>
            <code>cirBTC.owner()</code> must match the expected admin —
            no covert admin rotation.
          </li>
          <li>
            <code>cirBTC.totalSupply()</code> growth ≤ 50% per 30-min
            cycle — abnormal mint = potential exploit.
          </li>
          <li>
            <code>cirBTC.isBlacklisted(CirqueLending)</code> must be{" "}
            <code>false</code> — Circle hasn&apos;t frozen our pool.
          </li>
        </ul>
        <p>
          Any failure halts attestation. After 1 hour of no fresh price
          (MAX_ORACLE_STALENESS), the lending contract refuses new
          borrows and liquidations until integrity restored. Repays still
          work — borrowers are never trapped.
        </p>
        <h3>What&apos;s seeded, what&apos;s next</h3>
        <p>
          Pool seeded with 100 USDC from the treasury (small for testnet
          alpha; bounds blast radius if anything goes wrong). cirBTC
          collateral must come from <code>faucet.circle.com</code> — that
          step is up to the user. UI surface comes in Phase 3 (supply /
          borrow / repay / health). External audit gates mainnet (Q4 2026).
        </p>
        <h3>What we&apos;re NOT claiming yet</h3>
        <ul>
          <li>This is testnet alpha. <strong>Do not deposit real funds.</strong></li>
          <li>
            No public marketing tweet until the UI ships AND we have
            integrity probe data showing the keeper is reliable across a
            multi-day window.
          </li>
          <li>
            The atomic borrow-and-bet flow (v0.5 beta) is still deferred
            until per-user share custody is designed correctly.
          </li>
        </ul>
      </>
    ),
  },
  {
    date: "2026-05-22",
    title: "CirqueLending v0.5 alpha · self-audited pre-deployment · 3 findings, 3 fixes",
    body: (
      <>
        <p>
          Wrote the first version of <code>CirqueLending.sol</code> — the
          v0.5 lending primitive that lets users borrow USDC against
          cirBTC collateral and use the proceeds to bet on Registrai
          markets. Before pushing anywhere near a testnet, ran an internal
          audit pass against the freshly-written code. Three findings, all
          fixed before this entry shipped:
        </p>
        <h3>C1 · supply() drained borrower collateral (critical)</h3>
        <p>
          A <code>_totalCollateral()</code> placeholder returning 0 meant{" "}
          <code>withdraw()</code> treated the entire contract balance as
          free supply. A cirBTC supplier could withdraw funds that other
          users had posted as borrow collateral — borrowers later failed
          to <code>repay()</code> because the contract had no cirBTC to
          return. <strong>Fix:</strong> removed the supply / withdraw
          surface entirely. v0.5 alpha is a pure collateral-locking
          product. The proper two-sided supply pool (USDC lenders earning
          yield from borrower interest) ships in v0.6 with the running
          collateral counter done right.
        </p>
        <h3>C2 · supply yield was advertised but had no source (critical)</h3>
        <p>
          The website said &quot;supply cirBTC, earn yield from leveraged
          bettors.&quot; The contract had no mechanism connecting cirBTC
          deposits to any income stream — USDC borrowers paid USDC
          interest to the treasury, never to cirBTC suppliers. False
          advertising, even on testnet, is corrosive to trust.{" "}
          <strong>Fix:</strong> dropped the supply framing from the
          homepage, vault page, and roadmap. v0.5 leads with the
          borrower-side value (lever cirBTC into bets); v0.6 introduces
          two-sided yield with the supplier side actually wired up.
        </p>
        <h3>H1 · liquidation seized the entire collateral (high)</h3>
        <p>
          At the 65% LTV liquidation trigger, a $22k debt was backed by
          ~$34k of cirBTC. The first pass handed{" "}
          <em>all $34k</em> to the liquidator for paying $22k — a 54%
          profit on the transaction, with the borrower losing everything.
          <strong> Fix:</strong> liquidator now receives only{" "}
          <code>(debt + interest) × (1 + 5% bonus)</code> worth of cirBTC
          at the oracle price; the remainder refunds to the borrower.
          If BTC has crashed below the debt value, the liquidator takes
          all collateral and the protocol absorbs the shortfall as bad
          debt — properly accounted, no surprise to the borrower.
        </p>
        <h3>H2 · oracle had no staleness check (high)</h3>
        <p>
          The v0.5 alpha BTC oracle is owner-set — a centralized keeper
          calls <code>setPrice</code> on a cadence. If the keeper crashes
          for 24 hours, the stored price stays stuck while real BTC moves
          30%. Underwater loans would look healthy on paper; liquidators
          can&apos;t act. <strong>Fix:</strong> the oracle interface now
          returns <code>(price, updatedAt)</code>; the lending contract
          refuses to borrow or liquidate when{" "}
          <code>block.timestamp − updatedAt &gt; 1 hour</code>. Repays
          deliberately skip the staleness check — borrowers can always
          close a position regardless of oracle health.
        </p>
        <h3>Verification</h3>
        <p>
          17 contract tests written against the corrected logic. Full repo:
          114 tests pass, 0 fail. The contract is{" "}
          <strong>still not deployed</strong> — Phase 2 (liquidator bot +
          deploy script) ships next; Phase 5 (third-party audit) gates
          mainnet. Disclosing internal findings publicly because the same
          process scales to v0.6 / v0.7: write, audit own work, document
          before any external review.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-22",
    title: "Methodology · paste-not-link · MethodologyLive on every feed page",
    body: (
      <>
        <p>
          The agent-creation form used to ask for an{" "}
          <code>ipfs://…</code> CID or URL — meaning new agent deployers had
          to host a markdown doc somewhere just to claim a methodology hash.
          Today the field is a <strong>9-row textarea</strong> with a
          starter scaffold the user overwrites in place. Sources, math,
          cadence, controls — all four sections required, all four hashed
          onchain. Validation refuses to submit if the template is
          unedited.
        </p>
        <p>
          On successful registration, the text is signature-gated and
          POSTed to a new Worker endpoint{" "}
          <code>/feed-methodology</code>. The Worker double-verifies:
          (1) signer recovers to <code>Registry.getFeed(feedId).creator</code>
          across v2 → v1.1 → v1.0, and (2){" "}
          <code>keccak256(text) === onchain methodologyHash</code>. The KV
          can never drift from chain — a forged or modified text submission
          is rejected with a 400 explaining the hash mismatch.
        </p>
        <h3>MethodologyLive — three render branches</h3>
        <p>
          A new client component <code>&lt;MethodologyLive /&gt;</code>{" "}
          resolves the methodology in this order, on both the{" "}
          <code>/feed/[feedId]</code> page and the post-registration
          success panel:
        </p>
        <ol>
          <li>
            <strong>Worker has the text</strong> → render the prose in a
            monospace block with caption{" "}
            <em>creator-supplied · onchain hash · signed by feed creator</em>.
          </li>
          <li>
            <strong>Connected wallet === feed creator AND localStorage has
            an unsaved methodology</strong> → render a{" "}
            <code>publish methodology</code> retry button. Signs the same
            EIP-191 message, POSTs, refetches, clears localStorage on
            success.
          </li>
          <li>
            <strong>Per-feed fallback URL</strong> (legacy seeded feeds —
            Warsaw/CPI/ECB each have a <code>methodologyDoc</code> field in{" "}
            <code>live-data.json</code>) → render the GitHub link.
          </li>
        </ol>
        <h3>Retry safety net</h3>
        <p>
          The methodology is written to <code>localStorage</code>{" "}
          <em>before</em> the Worker POST is attempted. If the user cancels
          the signature, the Worker is unreachable, or the tab crashes, the
          text survives. Next visit to <code>/feed/{"{feedId}"}</code>{" "}
          surfaces the retry button. Worker writes succeed → localStorage
          cleared automatically.
        </p>
        <h3>Next on the roadmap</h3>
        <p>
          v0.3 — long-tail FX feeds (NGN/USDC, TRY/USDC, ARS/USDC) for
          emerging-market currency markets. v0.5 — borrow USDC against
          cirBTC collateral, lever into Registrai markets. No BTC sell,
          no taxable event, no exit from the asset. v0.5 beta adds the
          atomic borrow-and-bet bundling (one transaction, one signature)
          — something Aave can&apos;t replicate because they don&apos;t
          own the markets contract. v0.6 opens the two-sided pool with
          USDC suppliers earning yield from borrower interest.
          Engineering starts now; mainnet launch gated on audit (Q4 2026).
        </p>
      </>
    ),
  },
  {
    date: "2026-05-21",
    title: "Social Signal Oracle live · Twitter quests · paste-first UX",
    body: (
      <>
        <p>
          The credit system needed a way to mint for off-chain proofs
          (Twitter ownership, etc.) without breaking the &quot;all credits
          are minted by bonded oracle agents&quot; story. Today: a new
          first-party Registrai agent at{" "}
          <ExtAddr addr="0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263" short />{" "}
          — bonded with <strong>10 USDC slashable</strong>, registered on
          Registry v2 against a new feed{" "}
          <em>&quot;Registrai social engagement signals&quot;</em>. Same
          trust model as Warsaw, CPI, ECB.
        </p>
        <h3>Quests live</h3>
        <ul>
          <li>
            <strong>Connect Twitter (+50 pts)</strong> — user posts a
            wallet-bound challenge tweet. Worker fetches it via Twitter&apos;s
            public oEmbed endpoint (no API key, no auth, no rate-limit
            cost), extracts the author handle from <code>author_url</code>,
            parses the first <code>&lt;p&gt;</code> of the rendered html to
            stop quote-tweet replays, and binds handle ↔ wallet one-to-one
            in KV.
          </li>
          <li>
            <strong>Tweet about your agent (+150 pts)</strong> — same oEmbed
            verification, plus a chain check via topic-filtered{" "}
            <code>eth_getLogs</code> that the wallet has at least one{" "}
            <code>AgentRegistered</code> event across v1.0 / v1.1 / v2.
            Returns 503 with retry on RPC failure (never a silent
            false-negative). Three rotating templates so the same quest
            doesn&apos;t produce identical-looking tweets at scale.
          </li>
        </ul>
        <h3>Key separation</h3>
        <p>
          The dedicated <strong>MINTER wallet</strong>{" "}
          <ExtAddr addr="0xaE1A21Be03a9099971aaFc1dFDc9544c3b07F0AF" short />{" "}
          is the only authorized minter on{" "}
          <code>RegistraiPoints</code>. The bonded social-oracle wallet had
          its minter role revoked. Compromise of the mint key = unlimited
          credit mint, bounded only by the per-call cap; compromise of the
          bond key = nothing (the mint key is what carries authority). Two
          keys, two failure modes, both bounded.
        </p>
        <h3>Worker-side hardening</h3>
        <ul>
          <li>
            Per-nonce KV keying (<code>nonce:wallet:nonce</code>) — two
            tabs each get their own valid pending nonce; the second{" "}
            <code>/start</code> no longer invalidates the first.
          </li>
          <li>
            Sliding-window rate limit: 5 verify attempts per wallet per
            10 minutes.
          </li>
          <li>
            <code>AbortController</code> + 30s timeout on every quest
            fetch, matching Cloudflare&apos;s own server cap.
          </li>
          <li>
            Per-wallet-address reset on the frontend — switching MetaMask
            account wipes flow state so a stale nonce/template can&apos;t
            follow you to a different wallet.
          </li>
        </ul>
        <h3>Paste-first UX</h3>
        <p>
          Quest panels auto-fetch templates on mount (no &quot;start&quot;
          button). The paste-URL input is the primary action; templates
          live in a collapsed{" "}
          <em>&quot;need a tweet? show me a suggestion ↓&quot;</em>{" "}
          disclosure with copy-to-clipboard, intent-URL composer, and a
          shuffle button to cycle through variants. End-to-end:{" "}
          <strong>two interactions per quest</strong> — paste, verify.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-20",
    title: "v2 stack shipped · onchain soulbound credits · audit fixes",
    body: (
      <>
        <p>
          Six new contracts, deployed and source-verified on ArcScan in a
          single migration. Old v1.0 + v1.1 stay running unchanged; v2 is
          the write target for every new agent registration, market, and
          trade.
        </p>
        <ul>
          <li>
            <code>RegistraiPoints</code>:{" "}
            <ExtAddr addr="0xF5897349819B16f4431A61Ad61293C1b31bD3381" />
          </li>
          <li>
            <code>Registry v2</code>:{" "}
            <ExtAddr addr="0x0529730A961f50997de63ac0aD07f1aEa2dEC0C0" />
          </li>
          <li>
            <code>Attestation v2</code>:{" "}
            <ExtAddr addr="0x060C61Cc315d9e8Baf2a58719f80C01163Bd6F48" />
          </li>
          <li>
            <code>Dispute v2</code>:{" "}
            <ExtAddr addr="0x1F78e08f5DdF5dD3fDD0e27097FE5398999Aa738" />
          </li>
          <li>
            <code>Markets v2</code>:{" "}
            <ExtAddr addr="0xb653c065E4805F4b2558af7AE01e9622D61Ff394" />
          </li>
          <li>
            <code>MarketMakerVault v2</code>:{" "}
            <ExtAddr addr="0x13c7069F7f1526b160E885e201087caD6c67Ed47" />
          </li>
        </ul>
        <h3>Onchain credits, live</h3>
        <p>
          A soulbound credit layer that mints on every protocol action.
          Non-transferable, read directly from chain via{" "}
          <code>RegistraiPoints.points(address)</code>. No backend, no API,
          no off-chain ledger.
        </p>
        <TestTable
          rows={[
            ["register an oracle agent", "+1,000 pts", "one-time per feed"],
            ["create a prediction market", "+200 pts", "per market"],
            ["attest a data point", "+50 pts", "per attestation, dispute-free"],
            ["trade", "+10 pts / USDC", "capped 500 pts / day / wallet"],
            ["resolve a market", "+25 pts → agent", "rewards the oracle, not the keeper"],
            ["slashed attestation", "−300 pts", "deducted on ResolvedInvalid"],
          ]}
        />
        <h3>Audit fixes baked into v2</h3>
        <ul>
          <li>
            <code>ReentrancyGuard</code> on every fund-moving function in
            Markets (<code>buy</code>, <code>sell</code>,{" "}
            <code>resolve</code>, <code>redeem</code>,{" "}
            <code>claimLP</code>, <code>createMarket</code>,{" "}
            <code>addLiquidity</code>) — the points sub-call is an external
            call to an arbitrary minter contract; reentrancy guard closes
            the obvious vector.
          </li>
          <li>
            Strict state machine on{" "}
            <code>Attestation.setStatus</code> — only{" "}
            <code>Pending → ResolvedValid|ResolvedInvalid</code> permitted;
            slash idempotent (only debits when the prior state was{" "}
            <code>Pending</code>).
          </li>
          <li>
            <strong>Feed-creator-must-be-agent rule</strong> baked into{" "}
            <code>Registry._register</code> — couples spec authorship and
            data quality to one accountable bonded wallet. No more Case-B
            where someone else attests against your feed.
          </li>
          <li>
            <code>awardFlat</code> per-call cap (<code>10_000</code> pts) so
            a compromised minter can&apos;t mint unlimited credits in a
            single tx.
          </li>
          <li>
            Buy uses <code>effectiveIn</code> (post-fee), sell uses{" "}
            <code>grossOut</code> (pre-fee) for points — symmetric
            accounting so two-way volume is measured consistently.
          </li>
          <li>
            <code>maxUint256</code> approval on every USDC{" "}
            <code>approve</code> the UI sends — second feed / second
            market / second trade skips the approve popup.
          </li>
        </ul>
        <h3>Profile updates</h3>
        <p>
          New <strong>Quests</strong> tab on <code>/profile</code> (the
          default — fresh wallets land here, not on empty
          trader/creator/deployer). <strong>CreditsBanner</strong> reads
          the live balance from chain. <strong>DeployerTab</strong> now
          discovers v2 agents via topic-filtered{" "}
          <code>eth_getLogs</code> across all three Registry deployments —
          a wallet that registers on v2 sees its agent in
          &quot;deployer&quot; immediately after the tx confirms.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-17",
    title: "Markets v1.1 · verifiable markets live · Circle-product roadmap",
    body: (
      <>
        <p>
          Yesterday&apos;s v1.1 trio hosted the verifiable Warsaw feed but
          had no markets layer — Markets v1.0 is immutable-coupled to
          Attestation v1.0, so trades against the verifiable feed
          weren&apos;t possible. Today&apos;s Markets v1.1 closes that.
        </p>
        <ul>
          <li>
            <code>Markets_v1_1</code>:{" "}
            <ExtAddr addr="0xec70ce17aa4b0da6898ced47621655c4c31b1136" />
          </li>
          <li>Same bytecode as v1.0, pointing at Attestation v1.1.</li>
          <li>
            Three demo markets seeded against the verifiable Warsaw feed:{" "}
            <em>{">"}17,000</em>, <em>{">"}17,500</em>, and{" "}
            <em>{"<"}18,000 PLN/sqm by expiry</em>. Each visible on the{" "}
            <code>/markets</code> grid with a <strong>verifiable</strong>{" "}
            badge that clicks through to the rule bytecode on ArcScan.
          </li>
        </ul>
        <p>
          The verifiable demo loop is now complete end-to-end: agent
          fetches Otodom listings → submits raw int256s via{" "}
          <code>attestWithRule</code> → MedianRule computes 17,371
          onchain → markets resolve against that value at expiry →
          traders redeem at $1 per winning share. Every step is bytecode
          anyone can verify.
        </p>
        <h3>Roadmap commitments for the Circle Developer Grant</h3>
        <p style={{ marginBottom: 12 }}>
          Re-prioritised against the May 14, 2026 grant relaunch — Circle
          named <em>prediction markets</em>, <em>stablecoin FX</em>, and{" "}
          <em>agentic economic activity</em> as priority verticals.
        </p>
        <TestTable
          rows={[
            ["v0.3 · Long-tail FX feeds", "verifiable NGN/USDC, BRL/USDC, TRY/USDC, KES/USDC… rate feeds", "Stablecoin FX (priority vertical)"],
            ["v0.4 · Programmable Wallets", "external agents onboard via Circle hosted wallets", "Circle Programmable Wallets"],
            ["v0.5 · CCTP", "bring USDC from Ethereum/Base to attest on Arc", "Circle CCTP"],
            ["v0.6 · BoundedScalarRule", "range guards + max-step-bps for slow feeds", "—"],
            ["v0.7 · Phala TEE attestation", "TEE-attested data-fetch closes the trust loop", "—"],
          ]}
        />
        <p>
          Complete moat story with this stack: aggregation as bytecode,
          data-fetch as TEE-attested execution, identity as Circle
          Programmable Wallets, capital as CCTP-bridged USDC. Long-tail FX
          feeds make the protocol immediately useful to existing
          Arc-native FX products without forcing them to build their own
          oracle plumbing.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-16",
    title: "Verifiable agents end-to-end live — first rule-bound attestation onchain",
    body: (
      <>
        <p>
          <strong>Shipped end to end on the same day as the design.</strong>{" "}
          The off-chain agent process used to be trusted to (a) fetch honest
          data and (b) compute the right value from it. The bond + slash
          mechanism deterred lying, but the math itself was opaque. As of
          this commit, the math is verifiable bytecode anyone can read.
        </p>
        <h3>What landed today</h3>
        <ul>
          <li>
            <code>IAgentRule.sol</code> +{" "}
            <code>MedianRule</code> +{" "}
            <code>TrimmedMeanRule(1000)</code> deployed:{" "}
            <ExtAddr addr="0x415fb74629d8eab51b7991679cec6cb71f3fb997" /> and{" "}
            <ExtAddr addr="0x772a40fee7b51542cf09c8c26c9e7b786d162a70" />
          </li>
          <li>
            <code>Registry.registerAgentWithRule(...)</code> parallel to{" "}
            <code>registerAgent</code> — backward compatible; existing agents
            unchanged
          </li>
          <li>
            <code>Attestation.attestWithRule(feedId, int256[] rawInputs)</code>{" "}
            reads the agent&apos;s bound rule, computes the value via{" "}
            <code>rule.submit(rawInputs)</code>, stores the result, and
            emits an <code>Attested</code> event with{" "}
            <code>inputHash = keccak256(abi.encode(rawInputs))</code> —
            anyone watching the chain can re-derive the input vector and
            re-call the rule to confirm
          </li>
          <li>
            25 new contract tests (including a 256-run fuzz over MedianRule).
            Full suite <strong>86/86 green</strong>
          </li>
          <li>
            <code>@registrai/agent-sdk@0.2.0</code> adds the rule-bound
            path. <code>defineAgent({"{"} rule: &apos;0x…&apos; {"}"})</code>{" "}
            switches <code>run()</code>&apos;s return shape from{" "}
            <code>{"{ value, inputHash }"}</code> to{" "}
            <code>{"{ rawInputs }"}</code>; SDK calls{" "}
            <code>attestWithRule</code> under the hood and never computes
            the final value off-chain
          </li>
          <li>
            <code>/agents/create</code> gained a rule picker — none / Median
            / Trimmed Mean 10% / Custom address. Success panel hands back a
            pre-filled SDK snippet for the chosen rule
          </li>
        </ul>
        <p>
          <strong>The invariant the protocol now guarantees</strong> for
          any rule-bound agent: pull <code>inputHash</code> from the{" "}
          <code>Attested</code> event → reconstruct{" "}
          <code>rawInputs</code> from the attest tx calldata → re-call{" "}
          <code>rule.submit(rawInputs)</code> yourself → confirm the stored{" "}
          <code>value</code> matches. Aggregation math is no longer
          trust-by-markdown.
        </p>
        <h3>Then deployed v1.1 + migrated Warsaw</h3>
        <p>
          Registry/Attestation/Dispute v1.1 deployed alongside v1.0 to host
          rule-bound agents — Registry v1.1 at{" "}
          <ExtAddr addr="0x4e074806ce7b8bcee27c14fd446d924179aa919e" />,
          Attestation v1.1 at{" "}
          <ExtAddr addr="0xf0caf69125bd17717c4804edce61bbdacd52ac60" />. v1.0
          keeps running for the existing agents/markets/vault; Markets v1.0
          can&apos;t resolve against v1.1 feeds (immutable coupling), so
          Markets v1.1 is the next milestone.
        </p>
        <p>
          A new feed{" "}
          <strong>WARSAW_RESI_MEDIAN_VERIFIABLE</strong> went live on v1.1
          with MedianRule bound. The Warsaw agent worker now runs both a
          plain attestation (v1.0, government-anchored) and a verifiable one
          (v1.1, raw market median onchain). First live{" "}
          <code>attestWithRule</code> call:
        </p>
        <ul>
          <li>
            tx{" "}
            <ExtTx hash="0xce87ee21b461cf40f452d6a0cce63ebaca04c87d2558ed6367a7ee83cbb487b4" />
          </li>
          <li>148 Otodom listings fetched → 134 retained after 5% trim → 128 inputs to MedianRule</li>
          <li>
            onchain median: <strong>17,371 PLN/sqm</strong>
          </li>
          <li>
            inputHash committed — anyone can re-derive <code>rawInputs</code> from the attest calldata and re-call{" "}
            <code>MedianRule.submit</code> to reproduce 17,371 byte-for-byte
          </li>
        </ul>
        <p>
          The verifiable feed <em>intentionally drops</em> the NBP-anchor
          calibration the v1.0 feed used — v1.0 anchored to a Polish-
          government figure, which moved the trust off-chain. v1.1 trusts
          the market median itself, computed deterministically onchain
          from raw listings. Different methodology, both live.
        </p>
        <h3>Next on this milestone</h3>
        <ul>
          <li>Markets v1.1 — so markets can resolve against verifiable feeds</li>
          <li>
            <code>BoundedScalarRule</code> (range guards + max-step-bps)
          </li>
          <li>
            Phala TEE attestation for the data-fetch half — closes the
            trust loop end to end
          </li>
        </ul>
      </>
    ),
  },
  {
    date: "2026-05-15",
    title: "Market-maker vault + end-to-end resolve test, live",
    body: (
      <>
        <p>
          Shipped <code>MarketMakerVault.sol</code> — pooled USDC for
          operator-driven liquidity bootstrapping. Anyone deposits and burns
          shares against current NAV; an authorized operator routes funds into
          buys, sells, and add-liquidity calls on Markets; resolved winnings
          flow back into the vault and depositors claim pro-rata. v1 NAV is
          conservative (USDC balance only) — immune to AMM-state sandwich
          attacks. 1e6 virtual offset neuters the classic first-depositor
          share-inflation attack. 9 new contract tests, full suite 61/61
          green.
        </p>
        <p>
          Deployed at{" "}
          <ExtAddr addr="0x79F09d46dA4cA607f8805930778fBfFDAad0E9D8" />,
          seeded with 50 USDC from the treasury. New <code>/vault</code> page
          on the site has the live NAV, share price, your position, and a
          deposit/withdraw form. MM bot now signs through the vault — every
          trade originates from the vault address onchain.
        </p>
        <p>
          <strong>Operator/agent separation</strong> — the MM operator is wallet{" "}
          <ExtAddr addr="0x9FB5cb76f6d96c1A7DFE965dF46BE8E748e06959" short />
          , distinct from the oracle agent wallet{" "}
          <ExtAddr addr="0x84C799941C6B69AbB296EC46a02E4e0772Ad2E5e" short />.
          Oracle agents do not trade markets keyed to their own attestations.
        </p>
        <h3>Onchain stress + invariant tests</h3>
        <TestTable
          rows={[
            ["MM stress (price-target convergence)", "20 / 11 trades", "0 invariant failures, AMM k strictly grew per buy, model converged within 5pp spread tolerance"],
            ["Sell-side (vault.executeSell)", "5 / 5 sells", "0 failures, NAV+ and AMM k+ on every iter"],
            ["End-to-end resolve", "1 full cycle, ~1h wall-clock", "PnL +0.4482 USDC on 0.5 USDC YES bet — matched theory exactly"],
          ]}
        />
        <h3>End-to-end resolve test breakdown</h3>
        <p>
          ~1 hour wall-clock, all real onchain transactions on Arc testnet:
        </p>
        <ol>
          <li><code>createFeed</code> — minimum allowed dispute window (1h)</li>
          <li><code>approve + registerAgent</code> — 10 USDC bond locked</li>
          <li><code>attest(17500)</code> — finalizes at +1h</li>
          <li><code>createMarket(threshold=17000, GreaterThan, 5 USDC seed)</code> — market <ExtTx hash="0x7c06d272a8067667f433e5882e29edc7b24c46235c3f6409175c8e7736b32dcb" /></li>
          <li><code>vault.executeBuy(YES, 0.5 USDC)</code> → 0.9482 YES shares acquired at price ~0.527</li>
          <li>wait for finalization + market expiry</li>
          <li><code>resolve</code> — YES won (17500 &gt; 17000)</li>
          <li><code>vault.redeem</code> — winnings flow back to vault</li>
        </ol>
        <p>
          Vault NAV moved 45.1688 → 45.6170 USDC. Profit{" "}
          <code>0.9482 × $1 − 0.5 = $0.4482</code>, matching exactly.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-14",
    title: "SDK published to npm + agent repo cutover",
    body: (
      <>
        <p>
          Published{" "}
          <a
            href="https://www.npmjs.com/package/@registrai/agent-sdk"
            target="_blank"
            rel="noreferrer"
          >
            @registrai/agent-sdk
          </a>{" "}
          v0.1.0 to npm — 17 kB tarball, 33 files, public scope claimed.
          Runtime-agnostic (Node, Cloudflare Workers, Phala TEE). Surface:{" "}
          <code>defineAgent</code>, <code>Agent</code>, <code>preflight</code>,{" "}
          <code>submitAttestation</code>, <code>median</code>,{" "}
          <code>trimByPercentile</code>, <code>hashRecords</code>,{" "}
          <code>fetchText</code>, <code>fetchJson</code>, <code>log</code>,
          plus minimal viem-compatible ABIs.
        </p>
        <p>
          Cut the agent repo over from its duplicated <code>src/sdk/</code>{" "}
          copy to consume the npm package. Net delta: −477 LOC, +27 LOC.
          Worker bundles cleanly, tsc clean, 13/13 tests pass.
        </p>
        <p>
          Audited every page on the site so <code>beta</code>/<code>soon</code>{" "}
          status labels match reality. Added the missing per-page badge on
          feed detail pages.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-13",
    title: "Macro agents + Markets v5 with LP shares & fees",
    body: (
      <>
        <p>
          Shipped two new first-party oracle agents, both Cloudflare-Worker
          cron-driven on the daily 14:00 UTC tick:
        </p>
        <ul>
          <li>
            <strong>Polish CPI Y/Y</strong> in basis points — sourced from
            GUS&apos;s official monthly inflation reports
          </li>
          <li>
            <strong>ECB main refinancing operations rate</strong> in basis
            points — sourced from ECB&apos;s Statistical Data Warehouse
          </li>
        </ul>
        <p>
          Each agent ships with its own methodology document hashed and
          pinned for verification.
        </p>
        <p>
          <strong>Markets v5</strong> — fundamentally upgraded contract:
        </p>
        <ul>
          <li>
            <strong>70 bps trading fee</strong> per trade, split{" "}
            <strong>40 / 20 / 10</strong> to creator / agent / treasury.
            Oracle layer remains free; revenue only on Markets.
          </li>
          <li>
            <strong>LP shares</strong> — <code>addLiquidity</code> mints
            proportional shares against current reserves (Polymarket-style:
            preserves pool odds rather than drifting toward 50/50).
          </li>
          <li>
            <strong><code>claimLP</code></strong> — after resolution, LPs
            withdraw their share of the snapshotted winning-side reserve.
          </li>
          <li>
            <strong><code>redeem()</code> decoupled from reserves</strong> —
            user outcome balances and pool reserves are separate buckets.
            Burning user shares no longer drains the LP pot.
          </li>
        </ul>
        <p>7 markets seeded across the 3 feeds, all live.</p>
        <p>
          <em>Notable engineering:</em> fixed stack-too-deep in{" "}
          <code>Markets.sell</code> by enabling{" "}
          <code>via_ir + optimizer = true</code>. The viaIR pass surfaced a
          latent test bug folding two <code>block.timestamp</code> reads into
          one local; fixed with explicit <code>vm.warp(literal)</code>. First
          attempt at proportional <code>addLiquidity</code> drifted price
          toward 50/50 when reserves were imbalanced — fixed with
          Polymarket-style residual share allocation.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-11 to 2026-05-12",
    title: "Bootstrap on Arc testnet",
    body: (
      <>
        <p>
          Initial contracts deployed to Arc testnet (chain id 5042002):
        </p>
        <ul>
          <li>
            <ExtAddr addr="0xA8E6f5aC6410231Db1422f3B17987Cf657807224" />{" "}
            <code>Registry</code> — feed creation, agent registration with bond
          </li>
          <li>
            <ExtAddr addr="0x04227E2e53041165CB38D5C0aFadCC95096ae5f4" />{" "}
            <code>Attestation</code> — agent-signed value submissions with
            dispute-window finalization
          </li>
          <li>
            <ExtAddr addr="0x113200D3515758C70ea75fE636e579cCed4066A5" />{" "}
            <code>Dispute</code> — symmetric-bond disputes, slashing on{" "}
            <code>ResolvedInvalid</code>
          </li>
          <li>
            <ExtAddr addr="0xcaB9aB405F89AC701c3CAcCF110bF94f3A10cD86" />{" "}
            <code>Markets</code> (USDC collateral) — binary prediction markets
            resolved by attestations
          </li>
          <li>
            <ExtAddr addr="0x3e456845aa2747a617EBe91Cd04e74752D890833" />{" "}
            <code>Markets/EURC</code> — same Markets code over EURC collateral,
            proving currency-agnosticism
          </li>
        </ul>
        <p>
          First feed: Warsaw residential PLN/sqm. First-party agent registered,
          bonded, attesting daily at 14:00 UTC. Frontend at{" "}
          <a href="https://registrai.cc" target="_blank" rel="noreferrer">
            registrai.cc
          </a>{" "}
          — Next.js 14 static export on Cloudflare Pages, viem for chain
          reads.
        </p>
      </>
    ),
  },
];

export default function DevlogPage() {
  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="caption">devlog</div>
          <StatusBadge kind="live" />
        </div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-6 max-w-[22ch]">
          Build journal,{" "}
          <span className="italic text-accent">in public</span>.
        </h1>
        <p className="text-fg-mute text-[15px] leading-relaxed max-w-[64ch] mb-12">
          Reverse-chronological log of what shipped, what broke, what we
          learned. Every entry pairs the work with onchain proof —
          transaction hashes, contract addresses, vault NAVs. Canonical
          source at{" "}
          <a
            href="https://github.com/registrai-multichain/contracts/blob/main/DEVLOG.md"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            contracts/DEVLOG.md
          </a>
          .
        </p>

        <div className="space-y-16">
          {ENTRIES.map((e) => (
            <Entry key={e.date + e.title} entry={e} />
          ))}
        </div>

        <div className="mt-20 border border-dashed border-line/60 p-6 text-[13px] text-fg-mute">
          <span className="font-serif italic">Subscribed?</span> Watch the{" "}
          <a
            href="https://github.com/registrai-multichain/contracts"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            contracts repo
          </a>{" "}
          on GitHub for new entries, or check back here.
        </div>
      </article>
    </Shell>
  );
}

function Entry({ entry }: { entry: Entry }) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-6 md:gap-10">
      <div className="text-2xs caption text-fg-dim tnum pt-1">
        {entry.date}
      </div>
      <div>
        <h2 className="font-serif text-[24px] sm:text-[28px] leading-snug tracking-tightest mb-5 max-w-[34ch]">
          {entry.title}
        </h2>
        <div className="prose-devlog text-[14.5px] text-fg-mute leading-relaxed space-y-4 max-w-[68ch]">
          {entry.body}
        </div>
      </div>
    </section>
  );
}

function ExtAddr({ addr, short }: { addr: string; short?: boolean }) {
  return (
    <a
      href={`https://testnet.arcscan.app/address/${addr}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-2xs text-accent hover:underline"
    >
      {short ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr}
    </a>
  );
}

function ExtTx({ hash }: { hash: string }) {
  return (
    <a
      href={`https://testnet.arcscan.app/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-2xs text-accent hover:underline"
    >
      {hash.slice(0, 10)}…{hash.slice(-6)}
    </a>
  );
}

function TestTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="border border-line my-4 text-[13px]">
      <div className="grid grid-cols-[2fr_1.2fr_3fr] gap-px bg-line caption text-fg-dim">
        <div className="bg-bg p-3">test</div>
        <div className="bg-bg p-3">iterations</div>
        <div className="bg-bg p-3">result</div>
      </div>
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid grid-cols-[2fr_1.2fr_3fr] gap-px bg-line border-t border-line"
        >
          <div className="bg-bg p-3 text-fg">{r[0]}</div>
          <div className="bg-bg p-3 text-fg tnum">{r[1]}</div>
          <div className="bg-bg p-3 text-fg-mute">{r[2]}</div>
        </div>
      ))}
    </div>
  );
}

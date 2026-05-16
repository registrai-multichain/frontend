import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";

interface Entry {
  date: string;
  title: string;
  body: React.ReactNode;
}

const ENTRIES: Entry[] = [
  {
    date: "2026-05-16",
    title: "Verifiable agents shipped — rule contracts live",
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
        <h3>Next on this milestone</h3>
        <ul>
          <li>
            <code>BoundedScalarRule</code> (range guards + max-step-bps)
          </li>
          <li>
            Migrate one first-party agent (Warsaw resi or Polish CPI) to
            the rule path, so a live feed shows the &quot;verifiable&quot; badge
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

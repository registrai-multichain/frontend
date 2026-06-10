import Link from "next/link";
import { Shell } from "@/components/Shell";
import { DEMO_FEED } from "@/lib/demo";
import { DEMO_MARKETS } from "@/lib/markets-demo";
import { MarketCard } from "@/components/MarketCard";
import { Sparkline } from "@/components/Sparkline";
import { StatusBadge } from "@/components/StatusBadge";
import { LiveCountdown } from "@/components/LiveCountdown";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { fmtInt, fmtPct, relTime } from "@/lib/format";

export default function Home() {
  const feed = DEMO_FEED;
  const agent = feed.agents[0]!;
  const history = agent.attestations;
  const latest = history[history.length - 1]!;
  const prev = history[history.length - 2] ?? latest;
  const delta = latest.value - prev.value;
  const deltaPct = (delta / prev.value) * 100;

  return (
    <Shell>
      {/* ─────────────── HERO ─────────────── */}
      <section className="pt-12 sm:pt-20 pb-12 fade-up">
        <h1 className="font-serif text-[40px] sm:text-[68px] leading-[1.02] tracking-tightest max-w-[18ch]">
          An onchain oracle for{" "}
          <span className="italic text-accent">everything else</span>.
        </h1>
        <p className="mt-6 font-serif italic text-fg-mute text-[18px] sm:text-[22px] leading-snug max-w-[42ch]">
          With aggregation that&apos;s{" "}
          <span className="text-fg not-italic font-medium">bytecode anyone can re-execute</span>{" "}
          — not a methodology document anyone has to trust.
        </p>
        <div className="flex items-center gap-4 mt-6 flex-wrap text-[11px]">
          <span className="caption text-fg-dim">v2 · arc testnet</span>
          <span className="caption text-accent border border-accent/40 px-2 py-1">
            onchain credits live
          </span>
          <LiveCountdown />
        </div>

        {/* Live proof embedded in hero — the protocol is real, here's the number */}
        <div className="mt-10 border-t border-b border-line py-6 max-w-[640px]">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <div className="caption mb-2">{feed.symbol}</div>
              <div className="flex items-baseline gap-2">
                <span className="text-[44px] sm:text-[56px] leading-none tracking-tightest font-medium">
                  <AnimatedNumber value={latest.value} />
                </span>
                <span className="text-fg-mute text-[13px] pb-1.5">{feed.unit}</span>
              </div>
              <div className="mt-2 text-2xs text-fg-mute">
                attested {relTime(latest.timestamp)} ·{" "}
                <Link
                  href={`/feed/${feed.id}`}
                  className="underline decoration-fg-dim underline-offset-4 hover:text-accent"
                >
                  view feed →
                </Link>
              </div>
            </div>
            <div className="text-right text-2xs text-fg-dim">
              <div>{agent.bond} USDC bonded</div>
              <div className="mt-1">{history.length} attestation{history.length === 1 ? "" : "s"}</div>
            </div>
          </div>
        </div>

        <p className="mt-8 max-w-[62ch] text-fg text-[16px] leading-relaxed">
          The long tail of real-world data — regional real estate, local CPI,
          central-bank rate decisions — has no credible onchain feed. The
          economics never worked for committee-based oracles, and every
          existing alternative treats the aggregation step as a trusted black box.
        </p>
        <p className="mt-4 max-w-[62ch] text-fg-mute text-[15px] leading-relaxed">
          We built different rails. Anyone registers an agent for any feed,
          posts USDC as bond, optionally binds to an{" "}
          <span className="text-up">onchain rule contract</span> that computes the
          aggregation deterministically, and publishes signed values. Bad
          attestations get slashed. The math is verifiable bytecode — anyone can
          pull the inputs from chain and reproduce the value.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3 text-[12.5px] tracking-wide">
          <Link
            href="/feed/0x89453b87d3965a0f8132a29414ad3ed0b1950ee743cfcf6d85cfea8038d8ac5a/"
            className="px-5 py-2.5 bg-accent text-bg font-medium hover:bg-accent/90 transition-colors"
          >
            see a verifiable feed →
          </Link>
          <Link
            href="/markets/"
            className="px-4 py-2 border border-line-strong text-fg hover:border-accent hover:text-accent transition-colors"
          >
            browse markets
          </Link>
          <Link
            href="/agents/create/"
            className="px-4 py-2 text-fg-dim hover:text-fg transition-colors"
          >
            become an agent ↗
          </Link>
        </div>
      </section>

      <div className="hr mb-12" />

      {/* ─────────────── QUICKSTART ─────────────── */}
      <section className="fade-up mb-14" style={{ animationDelay: "80ms" }}>
        <div className="flex items-baseline justify-between mb-5">
          <h2 className="caption">first sixty seconds</h2>
          <span className="text-2xs text-fg-dim">
            new here? do this
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-line">
          <Step n="1" title="install a wallet" body="MetaMask, Rabby, or any EVM wallet. No app store needed." />
          <Step n="2" title="add Arc testnet" body="Click the wallet button in the nav — we add the chain for you." />
          <Step n="3" title="claim test USDC" body="Drop your address at faucet.circle.com, pick Arc Sepolia." cta={{ label: "faucet ↗", href: "https://faucet.circle.com" }} />
          <Step n="4" title="trade or LP" body="Take a side on any market, or deposit into the vault and earn pro-rata from operator trades." cta={{ label: "vault →", href: "/vault" }} />
        </div>
      </section>

      <div className="hr mb-12" />

      {/* ─────────────── CREDITS / TRACTION HOOK ─────────────── */}
      <section className="fade-up mb-14" style={{ animationDelay: "100ms" }}>
        <div className="flex items-baseline justify-between mb-5">
          <h2 className="caption">onchain credits · just shipped</h2>
          <Link
            href="/profile/"
            className="text-2xs text-accent hover:underline"
          >
            view your balance →
          </Link>
        </div>
        <div className="border border-accent/30 bg-bg-elev/30 p-6">
          <p className="font-serif italic text-fg text-[16px] leading-snug max-w-[60ch] mb-5">
            Every protocol action earns soulbound credit points — read directly
            from the chain, can&apos;t be transferred, can&apos;t be bought.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line">
            <CreditTile label="register agent" pts="1000 pts" emphasize />
            <CreditTile label="create market" pts="200 pts" />
            <CreditTile label="attest data" pts="50 pts" />
            <CreditTile label="trade" pts="10 pts / USDC" />
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-5 text-2xs">
            <Link
              href="/agents/create/"
              className="px-3 py-1.5 border border-accent/60 text-accent hover:bg-accent hover:text-bg transition-colors"
            >
              start earning →
            </Link>
            <span className="text-fg-dim">
              500 pts / day soft cap on trade earnings · resets at 00:00 UTC
            </span>
          </div>

          {/* Forward hint — cirque lending live on testnet. */}
          <div className="mt-6 pt-5 border-t border-line/40">
            <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
              <span className="caption text-accent">v0.5 alpha · live</span>
              <span className="caption text-fg-dim text-[10px]">
                cirBTC × prediction markets
              </span>
            </div>
            <p className="text-2xs text-fg-mute leading-relaxed max-w-[64ch]">
              Lever <code className="text-fg">cirBTC</code> into prediction
              markets. Lock cirBTC as collateral, borrow USDC, bet on
              Registrai — no selling your BTC, no taxable event. Suppliers
              earn yield from borrower interest.{" "}
              <Link
                href="/lending/"
                className="text-accent hover:underline"
              >
                try it on testnet →
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* Suffix pools — the flagship consumer product. */}
      <section className="fade-up mb-14" style={{ animationDelay: "110ms" }}>
        <div className="border border-accent/30 bg-accent/[0.04] p-6 sm:p-8">
          <div className="flex items-baseline gap-2 mb-2 flex-wrap">
            <h2 className="caption text-accent">suffix pools · just shipped</h2>
            <span className="caption text-fg-dim text-[10px]">memecoins with a floor</span>
          </div>
          <h3 className="font-serif text-[26px] sm:text-[34px] leading-[1.06] tracking-tightest mb-3 max-w-[24ch]">
            Trade a memecoin that <span className="italic text-accent">can&apos;t go to zero</span>.
          </h3>
          <p className="text-[13.5px] text-fg-mute leading-relaxed max-w-[64ch] mb-4">
            <code className="text-fg">$ai</code> · <code className="text-fg">$xyz</code> ·{" "}
            <code className="text-fg">$fun</code> are live on Arc testnet — each a cash-backed
            buyback floor that ratchets up from real trading revenue. Below the floor you can always
            sell to the treasury; above it, the meme runs free. Real <span className="italic">.domain</span>{" "}
            backing is the roadmap — sourced by the CaveBroDAO procurement team and added on-chain
            once the DAO votes it in.
          </p>
          <div className="flex gap-5 flex-wrap items-baseline">
            <Link href="/pools/" className="caption text-accent hover:tracking-[0.18em] transition-all">
              trade suffix pools →
            </Link>
            <Link href="/borrow/" className="caption text-fg-dim hover:text-fg transition-colors">
              or borrow against a bet you hold →
            </Link>
          </div>
        </div>
      </section>

      <div className="hr mb-12" />

      {/* ─────────────── LIVE PROOF ─────────────── */}
      <section className="fade-up" style={{ animationDelay: "120ms" }}>
        <div className="flex items-baseline justify-between mb-5">
          <h2 className="caption">live now</h2>
          <span className="text-2xs text-fg-dim">
            attestation #{history.length} · finalized {relTime(latest.timestamp)}
          </span>
        </div>

        <Link
          href={`/feed/${feed.id}`}
          className="block border border-line hover:border-line-strong hover:bg-bg-elev/40 transition-all"
        >
          <div className="grid grid-cols-1 sm:grid-cols-[1.1fr_0.7fr_1fr] gap-6 sm:gap-0 px-6 py-7 items-center">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-up dot-pulse" />
                <span className="caption">{feed.symbol}</span>
              </div>
              <div className="font-serif italic text-fg-mute text-[15px] leading-snug max-w-[36ch]">
                {feed.description}
              </div>
            </div>

            <div className="sm:px-4">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[30px] tnum tracking-tightest">
                  {fmtInt(latest.value)}
                </span>
                <span className="text-fg-mute text-[11px]">{feed.unit}</span>
              </div>
              <div className="text-2xs mt-1.5 tnum">
                <span className={delta >= 0 ? "text-up" : "text-down"}>
                  {fmtPct(deltaPct)}
                </span>
                <span className="text-fg-dim"> · 24h</span>
              </div>
            </div>

            <div className="-mx-1">
              <Sparkline
                values={history.slice(-30).map((a) => a.value)}
                height={60}
                showFill={false}
              />
              <div className="text-2xs text-fg-dim mt-1 flex justify-between">
                <span>{agent.bond} USDC bonded · 1 agent</span>
                <span>read this feed →</span>
              </div>
            </div>
          </div>
        </Link>

        <p className="mt-5 font-serif italic text-fg-mute text-[14.5px] leading-snug max-w-[68ch]">
          The Warsaw residential index is the first agent on Registrai. Daily,
          calibrated against NBP&apos;s quarterly transaction data, bonded by
          us. The protocol is built so this is one feed among many — not the
          product.
        </p>
      </section>

      {/* ─────────────── MARKETS ON THIS FEED ─────────────── */}
      <section
        className="mt-20 fade-up"
        style={{ animationDelay: "160ms" }}
      >
        <div className="flex items-baseline justify-between mb-5">
          <h2 className="caption">markets resolving against this feed</h2>
          <Link
            href="/markets"
            className="text-2xs text-fg-mute hover:text-accent transition-colors"
          >
            all markets →
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {DEMO_MARKETS.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </div>
        <p className="mt-5 font-serif italic text-fg-mute text-[14px] leading-snug max-w-[60ch]">
          The same oracle layer that produces the value above resolves every
          market below. No off-chain settlement, no resolver discretion on the
          number — just the attestation, finalized.
        </p>
      </section>

      {/* ─────────────── THREE PATHS ─────────────── */}
      <section
        className="mt-24 fade-up"
        style={{ animationDelay: "200ms" }}
      >
        <div className="flex items-baseline justify-between mb-8">
          <h2 className="caption">three ways in</h2>
          <span className="text-2xs text-fg-dim">pick the one that&apos;s you</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-line">
          <PathCard
            n="01"
            verb="read"
            status="beta"
            title="You need data your contract can&apos;t get anywhere else."
            body="Pull a signed value into Solidity in three lines. No SDK, no API key, no rate limit. Choose the agent whose methodology and bond you find credible. Pay zero protocol fees."
            code={`(int256 value, , bool ok) =
  oracle.latestValue(feedId, agent);`}
            cta="read the integration guide →"
            href="/docs#read"
          />
          <PathCard
            n="02"
            verb="attest"
            status="beta"
            title="You have a credible read on something the market needs."
            body="A real estate firm with proprietary data. A trader with conviction on a spot price. A statistician with a defensible index. Bond USDC, pin your methodology to IPFS, publish daily. Earn 20 bps of every trade against your feed — forever."
            code={`registry.registerAgent(
  feedId, methodologyHash, bond
);`}
            cta="become an agent →"
            href="/agents/create/"
          />
          <PathCard
            n="03"
            verb="create market"
            status="beta"
            title="Spin up a market against an existing feed."
            body="Pick a feed, set a threshold and a comparator, pick an expiry, seed liquidity. Markets resolve automatically against the agent&apos;s attestation. Earn 40 bps of every trade as the creator."
            code={`markets.createMarket(
  feedId, agent, threshold,
  comparator, expiry, liquidity
);`}
            cta="create a market →"
            href="/markets/create/"
          />
        </div>
      </section>

      {/* ─────────────── BECOME A CREATOR ─────────────── */}
      <section
        className="mt-24 fade-up border border-accent/30 bg-bg-elev/30 p-6 sm:p-8"
        style={{ animationDelay: "230ms" }}
      >
        <div className="caption mb-3 text-accent">early access · creator economy</div>
        <h2 className="font-serif text-[28px] sm:text-[36px] leading-[1.05] tracking-tightest mb-4 max-w-[28ch]">
          You have an opinion on a number.{" "}
          <span className="italic text-accent">Turn it into a market.</span>
        </h2>
        <p className="text-fg text-[14.5px] leading-relaxed max-w-[64ch] mb-5">
          Pick a feed, set a threshold, seed five USDC of liquidity. Every
          trade against your market pays you{" "}
          <span className="text-accent tnum">40 bps forever</span>. Polish CPI
          prints, ECB rate decisions, Warsaw real-estate moves — pick the one
          you have conviction on.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-[12.5px] tracking-wide">
          <Link
            href="/markets/create"
            className="px-4 py-2 border border-accent/60 text-accent hover:bg-accent hover:text-bg transition-colors"
          >
            create your first market →
          </Link>
          <span className="text-2xs text-fg-dim">
            ~5 minutes · testnet USDC free from{" "}
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-fg-dim underline-offset-4 hover:text-accent"
            >
              faucet.circle.com
            </a>
          </span>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-px bg-line">
          <CreatorStat label="creator fee" value="40 bps" />
          <CreatorStat label="agent fee" value="20 bps" />
          <CreatorStat label="protocol" value="10 bps" />
        </div>
      </section>

      {/* ─────────────── TRUST GRADIENT ─────────────── */}
      <section
        className="mt-24 fade-up"
        style={{ animationDelay: "260ms" }}
      >
        <div className="caption mb-4">how trust works</div>
        <h2 className="font-serif text-[30px] sm:text-[40px] leading-[1.05] tracking-tightest max-w-[22ch]">
          You don&apos;t trust the protocol.{" "}
          <span className="text-fg-mute">You trust the agent.</span>
        </h2>
        <p className="font-serif italic text-fg-mute text-[16px] mt-4 max-w-[58ch] leading-snug">
          The protocol just enforces consequences.
        </p>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-8 text-[13.5px] leading-relaxed">
          <Mechanism
            label="every attestation is bonded"
            body="An agent who publishes a value has already locked USDC against being wrong. The bond is visible on the feed page next to the number."
          />
          <Mechanism
            label="anyone can challenge"
            body="Inside the dispute window, anyone can post matching USDC and call for arbitration. Symmetric stakes — no free option to grief, no free option to lie."
          />
          <Mechanism
            label="the resolver decides, not us"
            body="Each feed names its own resolver at creation. A 2/3 multisig, a Reality.eth instance, a court. The protocol pipes the dispute and respects the outcome."
          />
          <Mechanism
            label="methodology is pinned"
            body="The IPFS hash of an agent's methodology is committed onchain at registration. To change the methodology, you register a new agent. No quiet rewrites."
          />
        </div>

        <p className="mt-10 text-fg-mute text-[13px] max-w-[60ch] leading-relaxed">
          It&apos;s optimistic-oracle math with the gates removed. No committee,
          no whitelist, no team to lobby. If an agent lies, the math takes their
          money and gives it to whoever caught them.
        </p>
      </section>

      {/* ─────────────── PROMISES ─────────────── */}
      <section
        className="mt-24 fade-up"
        style={{ animationDelay: "320ms" }}
      >
        <div className="caption mb-6">what we promise · forever</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-10 gap-y-10">
          <Promise
            n="01"
            title="Whatever ships is what runs"
            body="No admin keys. No pause switch. No upgrade path. The contracts are immutable from block one — including ours. There is no team button to flip."
          />
          <Promise
            n="02"
            title="Oracle free. Markets earn."
            body="The registry layer charges zero — reading, attesting, bonding is free forever. The markets layer takes 0.7%, split 40bps to the creator, 20bps to the agent, 10bps to the protocol. Every layer earns from real activity, not speculation."
          />
          <Promise
            n="03"
            title="USDC. That&apos;s the whole stack."
            body="No token to launch, sell, or distribute. Bonds are denominated in the asset your consumers price risk in. If we wanted a token economy, we&apos;d have built one."
          />
        </div>
      </section>

      {/* ─────────────── WANTED ─────────────── */}
      <section
        className="mt-24 fade-up border border-dashed border-line/60 p-6 sm:p-8"
        style={{ animationDelay: "380ms" }}
      >
        <div className="flex items-baseline justify-between mb-5">
          <h2 className="caption">feeds we&apos;d like to see exist</h2>
          <Link
            href="/docs#register"
            className="text-2xs hover:text-accent transition-colors"
          >
            register one →
          </Link>
        </div>
        <p className="font-serif italic text-fg-mute text-[15px] leading-snug max-w-[60ch] mb-5">
          The protocol is permissionless. We don&apos;t pick feeds. But if you
          want a starting point, here&apos;s what no oracle does well today:
        </p>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-6 text-[13px] text-fg">
          <li>Berlin · rent EUR/sqm</li>
          <li>ERCOT · day-ahead spot</li>
          <li>Polish CPI · monthly</li>
          <li>Regional unemployment</li>
          <li>Weather-derivative anchors</li>
          <li>Container freight rates</li>
          <li>Niche FX cross rates</li>
          <li>Lithium spot · battery grade</li>
          <li>Carbon credit benchmarks</li>
        </ul>
      </section>

      <div className="hr mt-24 mb-10" />

      {/* ─────────────── CLOSER ─────────────── */}
      <section className="text-[12.5px] text-fg-mute leading-relaxed max-w-[72ch] fade-up">
        <span className="font-serif italic text-fg">First deployment:</span>{" "}
        Arc testnet, May 2026. Contracts verified on Arc explorer.{" "}
        <Link
          href={`/feed/${feed.id}`}
          className="underline decoration-fg-dim underline-offset-4 hover:text-accent"
        >
          Warsaw real estate
        </Link>{" "}
        is the first agent on the first feed. Source on GitHub. Methodology on
        IPFS. Built for the Circle developer program — but the protocol is for
        anyone.
      </section>
    </Shell>
  );
}

function Step({
  n, title, body, cta,
}: {
  n: string;
  title: string;
  body: string;
  cta?: { label: string; href: string };
}) {
  const isExternal = cta?.href.startsWith("http");
  return (
    <div className="bg-bg p-5 flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <span className="caption text-fg-dim tnum">{n}</span>
      </div>
      <h3 className="font-serif text-[17px] leading-snug mb-2 max-w-[22ch]">
        {title}
      </h3>
      <p className="text-[12.5px] text-fg-mute leading-relaxed flex-1">{body}</p>
      {cta && (
        <a
          href={cta.href}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noreferrer" : undefined}
          className="mt-3 text-2xs text-accent hover:underline tnum"
        >
          {cta.label}
        </a>
      )}
    </div>
  );
}

function CreditTile({
  label,
  pts,
  emphasize,
}: {
  label: string;
  pts: string;
  emphasize?: boolean;
}) {
  return (
    <div className="bg-bg p-4">
      <div className="caption text-fg-dim mb-1.5">{label}</div>
      <div
        className={`tnum text-[15px] ${
          emphasize ? "text-accent font-medium" : "text-fg"
        }`}
      >
        {pts}
      </div>
    </div>
  );
}

function PathCard({
  n,
  verb,
  status,
  statusNote,
  title,
  body,
  code,
  cta,
  href,
}: {
  n: string;
  verb: string;
  status: "beta" | "soon" | "live";
  statusNote?: string;
  title: string;
  body: string;
  code: string;
  cta: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group bg-bg p-6 sm:p-7 hover:bg-bg-elev/60 transition-colors flex flex-col"
    >
      <div className="flex items-baseline justify-between mb-5">
        <span className="caption text-fg-dim">{n}</span>
        <span className="caption text-accent group-hover:tracking-[0.18em] transition-all">
          {verb}
        </span>
      </div>
      <h3 className="font-serif text-[20px] leading-snug mb-3 max-w-[26ch]">
        {title}
      </h3>
      <div className="mb-4">
        <StatusBadge kind={status} />
        {statusNote && (
          <div className="text-2xs text-fg-dim mt-1.5">{statusNote}</div>
        )}
      </div>
      <p className="text-fg-mute text-[13px] leading-relaxed mb-5 flex-1">
        {body}
      </p>
      <pre className="text-[11.5px] leading-relaxed text-fg-mute bg-bg-elev/60 border border-line p-3 overflow-x-auto mb-5">
        <code>{code}</code>
      </pre>
      <span className="text-[12px] text-fg-mute group-hover:text-accent transition-colors">
        {cta}
      </span>
    </Link>
  );
}

function CreatorStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg p-3 sm:p-4 text-center">
      <div className="caption text-fg-dim mb-1">{label}</div>
      <div className="text-[16px] sm:text-[18px] tnum tracking-tightest text-accent">
        {value}
      </div>
    </div>
  );
}

function Mechanism({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-px bg-accent/60 shrink-0" />
      <div>
        <div className="text-fg text-[13px] mb-1.5">{label}</div>
        <div className="text-fg-mute leading-relaxed">{body}</div>
      </div>
    </div>
  );
}

function Promise({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div>
      <div className="caption text-fg-dim mb-2">{n}</div>
      <div className="font-serif text-[18px] leading-snug mb-2.5 max-w-[22ch]">
        {title}
      </div>
      <div className="text-fg-mute text-[12.5px] leading-relaxed">{body}</div>
    </div>
  );
}

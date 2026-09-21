import { BrandLockup, BrandMark } from "@/components/Brand";
import Link from "next/link";

const feeRoutes = [
  { value: "30", label: "Market creator", note: "Keeps earning each time the market settles.", className: "lp-route--creator" },
  { value: "20", label: "Bonded resolver", note: "Held through the challenge window. Wrong calls forfeit it.", className: "lp-route--resolver" },
  { value: "50", label: "Builder commons", note: "Paid to builders by verified progress, never popularity.", className: "lp-route--commons" },
];

const safeguards = [
  ["01", "Bond the answer", "A resolver locks USDC behind every settlement."],
  ["02", "Open challenge", "Anyone can match the bond and dispute the call."],
  ["03", "Slash the miss", "A bad settlement forfeits its fee back to traders."],
  ["04", "Promote accuracy", "Proven forecasters earn the right to resolve next."],
];

export default function Home() {
  return (
    <div className="lp">
      <Header />
      <main>
        <Hero />
        <FeeFlow />
        <Thesis />
        <Settlement />
        <Infrastructure />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="lp-nav lp-frame">
      <a href="#top" className="lp-brand" aria-label="Registrai home"><BrandLockup markClassName="lp-brand-mark" wordmarkClassName="lp-brand-name" /></a>
      <div className="lp-nav-center" aria-hidden="true"><span>The anti-launchpad</span><i /><span>Built on Arc</span></div>
      <Link href="/bridge" className="lp-bridge-link">Bridge USDC <span>→</span></Link>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="lp-hero lp-frame">
      <div className="lp-hero-copy">
        <p className="lp-kicker lp-reveal">The anti-launchpad.</p>
        <h1 className="lp-reveal lp-delay-1">Fund builders.<br /><em>Don&apos;t buy their bags.</em></h1>
        <p className="lp-deck lp-reveal lp-delay-2">A prediction market that funds people who ship—without turning them into assets. No token sale. No insider allocation. No unlock waiting for your exit liquidity.</p>
        <div className="lp-hero-meta lp-reveal lp-delay-3"><span><b>01</b> Trade outcomes</span><span><b>02</b> Fund verified work</span><span><b>03</b> Own no one&apos;s bag</span></div>
      </div>
      <MarketTicket />
    </section>
  );
}

function MarketTicket() {
  return (
    <aside className="lp-ticket lp-reveal lp-delay-2" aria-label="Example market">
      <div className="lp-ticket-top"><span>LIVE MARKET / 0027</span><span className="lp-live"><i /> OPEN</span></div>
      <div className="lp-ticket-body">
        <p className="lp-ticket-label">Outcome market · not a token sale</p>
        <h2>Will an Arc-native consumer app reach 10k weekly users by Dec. 31?</h2>
        <div className="lp-chart" aria-hidden="true">
          <svg viewBox="0 0 500 160" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff5a1f" stopOpacity=".34" /><stop offset="1" stopColor="#ff5a1f" stopOpacity="0" /></linearGradient></defs><path className="lp-area" d="M0 146 C35 136 43 117 79 123 S128 144 158 108 208 116 238 95 281 104 315 72 358 93 389 51 440 64 500 17 V160 H0Z" /><path className="lp-line" d="M0 146 C35 136 43 117 79 123 S128 144 158 108 208 116 238 95 281 104 315 72 358 93 389 51 440 64 500 17" /></svg>
          <div className="lp-chart-end"><span>67</span>%</div>
        </div>
        <div className="lp-outcomes"><div><span>YES</span><strong>67¢</strong></div><div><span>NO</span><strong>33¢</strong></div></div>
      </div>
      <div className="lp-ticket-foot"><span>VOLUME <b>$84,720</b></span><span>RESOLVER BOND <b>$5,000</b></span></div>
      <div className="lp-stamp">NO TOKEN</div>
    </aside>
  );
}

function FeeFlow() {
  return (
    <section className="lp-fees">
      <div className="lp-frame">
        <div className="lp-section-head"><p className="lp-kicker">Funding without fundraising</p><h2>Launchpads fund promises.<br />Markets can fund proof.</h2><p>One percent at resolution. Visible, fixed, and routed to the people doing the work.</p></div>
        <div className="lp-flow" aria-label="One percent fee distribution">
          <div className="lp-flow-source"><span>RESOLUTION FEE</span><strong>100<sup>bps</sup></strong><small>charged once</small></div>
          <div className="lp-flow-line" aria-hidden="true"><i /><i /><i /></div>
          <div className="lp-routes">{feeRoutes.map((route) => <article className={`lp-route ${route.className}`} key={route.label}><div className="lp-route-number">{route.value}<sup>bps</sup></div><h3>{route.label}</h3><p>{route.note}</p></article>)}</div>
        </div>
        <p className="lp-fineprint">Registrai draws from the commons on the same terms as every other builder, with the same verified milestones and a hard 20% per-epoch cap. If we stop shipping, we stop earning.</p>
      </div>
    </section>
  );
}

function Thesis() {
  return (
    <section className="lp-thesis lp-frame">
      <div className="lp-thesis-title"><p className="lp-kicker">Anti-launchpad by design</p><h2>No presale.<br />No unlock.<br /><em>No exit bag.</em></h2></div>
      <div className="lp-thesis-copy"><p className="lp-pullquote">“Trade the outcome. Never the builder.”</p><div className="lp-copy-columns"><p>A launchpad makes funding depend on selling the next buyer a more expensive token. Price becomes the project&apos;s fate, and every holder starts talking their book.</p><p>Registrai separates the trade from the funding. Traders forecast verifiable outcomes. Builders sell nothing and earn from the shared commons only after they ship.</p></div></div>
    </section>
  );
}

function Settlement() {
  return (
    <section className="lp-settlement"><div className="lp-frame"><div className="lp-settlement-head"><div><p className="lp-kicker">Honest by construction</p><h2>Settlement with<br />something to lose.</h2></div><p>Access is free. The answer is bonded. That makes the resolver the one party the protocol can punish for being wrong.</p></div><div className="lp-steps">{safeguards.map(([number, title, copy]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div></div></section>
  );
}

function Infrastructure() {
  return (
    <section className="lp-infra lp-frame"><div className="lp-orbit" aria-hidden="true"><div className="lp-orbit-ring"><span>ARC</span></div><i className="lp-satellite lp-satellite-a" /><i className="lp-satellite lp-satellite-b" /></div><div className="lp-infra-copy"><p className="lp-kicker">One market, every ecosystem</p><h2>Builders can ship anywhere.<br />Markets settle on Arc.</h2><p>Registrai can verify progress across networks, so builders never need to migrate, issue a token, or join a chain-specific launch. Arc is the settlement layer—not the boundary.</p><dl><div><dt>Builder scope</dt><dd>Any chain</dd></div><div><dt>Settlement</dt><dd>Arc</dd></div><div><dt>Payouts</dt><dd>USDC</dd></div></dl></div></section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer lp-frame"><div><BrandMark className="lp-footer-mark" /><p>The anti-launchpad.<br />Fund builders without buying their bags.</p></div><div className="lp-footer-links"><Link href="/bridge">Bridge USDC →</Link><a href="/brand/registrai-brand-kit.zip" download>Brand kit ↓</a><a href="https://github.com/registrai-multichain" target="_blank" rel="noreferrer">GitHub ↗</a></div><div className="lp-footer-status"><i /> Building in public<br /><span>Warsaw / 2026</span></div></footer>
  );
}

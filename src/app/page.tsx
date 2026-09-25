import { BrandLockup, BrandMark } from "@/components/Brand";
import { REGI_CONTRACT, REGI_DEXSCREENER_URL, REGI_EXPLORER_URL } from "@/lib/regi";
import Link from "next/link";

const feeRoutes = [
  { value: "30", label: "Market creator", note: "Earns 30% of the fee on every trade, paid as it happens.", className: "lp-route--creator" },
  { value: "20", label: "Bonded agent", note: "Held until the market settles, then paid to the agent. On a void it goes to the successful challenger, otherwise the season pool.", className: "lp-route--resolver" },
  { value: "50", label: "The builder", note: "Income of the builder the market is about, credited per epoch and taxed progressively when claimed. The tax funds the season pool.", className: "lp-route--builder" },
];

const safeguards = [
  ["01", "Bond the answer", "The agent locks USDC behind every answer it attests."],
  ["02", "Open challenge", "Anyone can match the bond and dispute the answer. An independent resolver rules."],
  ["03", "Slash the miss", "If the resolver rules the answer Invalid, the agent's bond is slashed to the challenger."],
  ["04", "Void, don't guess", "If the market then can't settle, it voids: traders get their net cost back (what they put in after fees, minus what they took out), and the challenger receives the agent's held 20%."],
];

export default function Home() {
  return (
    <div className="lp">
      <Header />
      <main>
        <Hero />
        <RegiBootstrap />
        <FeeFlow />
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
      <div className="lp-nav-center" aria-hidden="true"><span>Builder markets</span><i /><span>Built on Arc</span></div>
      <span className="lp-nav-links">
        <a href="https://builder.registrai.cc/builders/" className="lp-bridge-link">Verified builders <span>→</span></a>
        <Link href="/bridge" className="lp-bridge-link">Bridge USDC <span>→</span></Link>
      </span>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="lp-hero lp-frame">
      <div className="lp-hero-copy">
        <p className="lp-kicker lp-reveal">Markets for builders—not builder tokens.</p>
        <h1 className="lp-reveal lp-delay-1">Fund builders.<br /><em>Don&apos;t buy their bags.</em></h1>
        <p className="lp-deck lp-reveal lp-delay-2">Perennial turns prediction-market fees into funding for verified work. $REGI bootstraps Registrai on Arc; builders still issue nothing, and markets settle in USDC.</p>
        <div className="lp-hero-meta lp-reveal lp-delay-3"><span><b>01</b> Trade outcomes</span><span><b>02</b> Fund verified work</span><span><b>03</b> Bootstrap the rails</span></div>
        <a className="lp-hero-live lp-reveal lp-delay-3" href="https://builder.registrai.cc/builders/"><i /> Live on Arc mainnet: the verified builder registry <span>→</span></a>
      </div>
      <MarketTicket />
    </section>
  );
}

function MarketTicket() {
  return (
    <aside className="lp-ticket lp-reveal lp-delay-2" aria-label="Example market (preview)">
      <div className="lp-ticket-top"><span>MARKET PREVIEW</span><span className="lp-soon">Coming to Arc mainnet</span></div>
      <div className="lp-ticket-body">
        <p className="lp-ticket-label">Outcome market · builder stays tokenless</p>
        <h2>Will an Arc-native consumer app reach 10k weekly users by Dec. 31?</h2>
        <div className="lp-chart" aria-hidden="true">
          <svg viewBox="0 0 500 160" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff5a1f" stopOpacity=".34" /><stop offset="1" stopColor="#ff5a1f" stopOpacity="0" /></linearGradient></defs><path className="lp-area" d="M0 146 C35 136 43 117 79 123 S128 144 158 108 208 116 238 95 281 104 315 72 358 93 389 51 440 64 500 17 V160 H0Z" /><path className="lp-line" d="M0 146 C35 136 43 117 79 123 S128 144 158 108 208 116 238 95 281 104 315 72 358 93 389 51 440 64 500 17" /></svg>
          <div className="lp-chart-end"><span>67</span>%</div>
        </div>
        <div className="lp-outcomes"><div><span>YES</span><strong>67¢</strong></div><div><span>NO</span><strong>33¢</strong></div></div>
      </div>
      <div className="lp-ticket-foot"><span>EXAMPLE VOLUME <b>$84,720</b></span><span>AGENT BOND <b>$5,000</b></span></div>
      <div className="lp-stamp">USDC MARKET</div>
    </aside>
  );
}

function RegiBootstrap() {
  return (
    <section id="regi" className="lp-regi">
      <div className="lp-frame lp-regi-grid">
        <div>
          <p className="lp-kicker">$REGI / bootstrap token</p>
          <h2>Bootstrap the network.<br /><em>Don&apos;t tokenize the builders.</em></h2>
        </div>
        <div className="lp-regi-copy">
          <p>$REGI is Registrai&apos;s Arc-native bootstrapping instrument: a way to coordinate attention, liquidity, and early network growth. It is separate from builder funding. Builders sell no token; market collateral, bonds, and payouts remain in USDC; a builder earns from the markets about its own work, and season rewards go to building progress traders confirmed.</p>
          <div className="lp-regi-ca">
            <span>official contract · Arc</span>
            <code>{REGI_CONTRACT}</code>
            <div className="lp-regi-links">
              <a href={REGI_EXPLORER_URL} target="_blank" rel="noreferrer">Arc explorer ↗</a>
              <a href={REGI_DEXSCREENER_URL} target="_blank" rel="noreferrer">DexScreener ↗</a>
            </div>
          </div>
          <dl className="lp-regi-facts">
            <div><dt>Network</dt><dd>Arc mainnet</dd></div>
            <div><dt>Symbol</dt><dd>$REGI</dd></div>
            <div><dt>Supply</dt><dd>1,000,000,000</dd></div>
          </dl>
        </div>
      </div>
    </section>
  );
}

function FeeFlow() {
  return (
    <section className="lp-fees">
      <div className="lp-frame">
        <div className="lp-section-head"><p className="lp-kicker">Funding without fundraising</p><h2>Launchpads fund promises.<br />Markets can fund proof.</h2><p>One percent on every buy and sell. Nothing is charged at settlement. Visible, fixed in code, and routed to the people doing the work.</p></div>
        <div className="lp-flow" aria-label="One percent fee distribution">
          <div className="lp-flow-source"><span>TRADING FEE</span><strong>100<sup>bps</sup></strong><small>on every trade</small></div>
          <div className="lp-flow-line" aria-hidden="true"><i /><i /><i /></div>
          <div className="lp-routes">{feeRoutes.map((route) => <article className={`lp-route ${route.className}`} key={route.label}><div className="lp-route-number">{route.value}<sup>bps</sup></div><h3>{route.label}</h3><p>{route.note}</p></article>)}</div>
        </div>
        <p className="lp-fineprint">After each epoch a builder&apos;s income is taxed progressively (0% on the first $1,000 at launch, up to 30% above $50,000) into the season pool, which rewards building progress traders confirmed. Registrai takes 1% of what is left; it pays for the caretaker that monitors milestones. Markets open on Arc mainnet after the builder registry.</p>
        <p className="lp-fineprint">Common markets charge the same 1% with the same split, except the 50% goes to the Registrai treasury. They are open to any bonded agent paired with an approved, independent dispute resolver, and that agent earns 20% of the trading fees on every market it settles correctly.</p>
      </div>
    </section>
  );
}

function Settlement() {
  return (
    <section className="lp-settlement"><div className="lp-frame"><div className="lp-settlement-head"><div><p className="lp-kicker">Honest by construction</p><h2>Settlement with<br />something to lose.</h2></div><p>Access is free. The answer is bonded. That makes the agent the one party the protocol can punish for being wrong.</p></div><div className="lp-steps">{safeguards.map(([number, title, copy]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div></div></section>
  );
}

function Infrastructure() {
  return (
    <section className="lp-infra lp-frame"><div className="lp-orbit" aria-hidden="true"><div className="lp-orbit-ring"><span>ARC</span></div><i className="lp-satellite lp-satellite-a" /><i className="lp-satellite lp-satellite-b" /></div><div className="lp-infra-copy"><p className="lp-kicker">One market, every ecosystem</p><h2>Builders can ship anywhere.<br />Markets settle on Arc.</h2><p>Registrai can verify progress across networks, so builders never need to migrate, issue a token, or join a chain-specific launch. Arc is the settlement layer—not the boundary.</p><dl><div><dt>Builder scope</dt><dd>Any chain</dd></div><div><dt>Settlement</dt><dd>Arc</dd></div><div><dt>Payouts</dt><dd>USDC</dd></div></dl></div></section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer lp-frame"><div><BrandMark className="lp-footer-mark" /></div><div className="lp-footer-links"><a href="https://builder.registrai.cc/builders/">Verified builders →</a><Link href="/bridge">Bridge USDC →</Link><a href={REGI_EXPLORER_URL} target="_blank" rel="noreferrer">$REGI on Arc ↗</a><a href="/brand/registrai-brand-kit-regi.zip" download>Brand kit ↓</a><a href="https://github.com/registrai-multichain" target="_blank" rel="noreferrer">GitHub ↗</a></div><div className="lp-footer-status"><i /> Building in public<br /><span>Warsaw / 2026</span></div></footer>
  );
}

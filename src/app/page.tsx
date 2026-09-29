import { BrandLockup, BrandMark } from "@/components/Brand";
import { REGISTRAI_X_URL, REGI_CONTRACT, REGI_DEXSCREENER_URL, REGI_EXPLORER_URL } from "@/lib/regi";
import Link from "next/link";

const steps = [
  { value: "01", label: "Verify control", note: "Sign a proof with your wallet and publish it in your repo or on your domain. Registrai checks it and keeps re-checking it.", className: "lp-route--creator" },
  { value: "02", label: "Prove progress", note: "Bonded agents track your public milestones, such as releases, deploys and users, and post them on Arc. Anyone can dispute a wrong reading.", className: "lp-route--resolver" },
  { value: "03", label: "Get seen", note: "A public builder profile and the Verified Builder badge, which can't be bought, sold or transferred.", className: "lp-route--builder" },
];

const safeguards = [
  ["01", "Bond the reading", "The agent locks USDC behind every milestone it posts."],
  ["02", "Open challenge", "Anyone can match the bond and dispute a reading. An independent resolver rules."],
  ["03", "Slash the miss", "If the resolver rules the reading invalid, the agent's bond goes to the challenger."],
  ["04", "Keep the record", "Every reading, dispute and ruling stays on chain, so anyone can check a builder's history."],
];

export default function Home() {
  return (
    <div className="lp">
      <Header />
      <main>
        <Hero />
        <RegiBootstrap />
        <HowItWorks />
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
      <div className="lp-nav-center" aria-hidden="true"><span>Verified builders</span><i /><span>Built on Arc</span></div>
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
        <p className="lp-kicker lp-reveal">For project builders, on any chain.</p>
        <h1 className="lp-reveal lp-delay-1">Launchpads sell promises.<br /><em>Registrai shows proof.</em></h1>
        <p className="lp-deck lp-reveal lp-delay-2">Registrai verifies who controls a project and records what it ships on Arc, checked by bonded agents anyone can challenge. Builders issue no token and never have to move chains.</p>
        <div className="lp-hero-meta lp-reveal lp-delay-3"><span><b>01</b> Verify control</span><span><b>02</b> Prove progress</span><span><b>03</b> Get seen</span></div>
        <a className="lp-hero-live lp-reveal lp-delay-3" href="https://builder.registrai.cc/builders/"><i /> Live on Arc mainnet: the verified builder registry <span>→</span></a>
      </div>
      <ProofCard />
    </section>
  );
}

function ProofCard() {
  return (
    <aside className="lp-ticket lp-reveal lp-delay-2" aria-label="Example builder proof (illustration)">
      <div className="lp-ticket-top"><span>BUILDER PROOF</span><span className="lp-soon">Example</span></div>
      <div className="lp-ticket-body">
        <p className="lp-ticket-label">Milestone feed · recorded on Arc</p>
        <h2>Releases shipped by a verified Arc builder, attested every week.</h2>
        <div className="lp-chart" aria-hidden="true">
          <svg viewBox="0 0 500 160" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff5a1f" stopOpacity=".34" /><stop offset="1" stopColor="#ff5a1f" stopOpacity="0" /></linearGradient></defs><path className="lp-area" d="M0 150 L60 150 L60 132 L140 132 L140 118 L200 118 L200 96 L270 96 L270 80 L330 80 L330 58 L410 58 L410 36 L500 36 V160 H0Z" /><path className="lp-line" d="M0 150 L60 150 L60 132 L140 132 L140 118 L200 118 L200 96 L270 96 L270 80 L330 80 L330 58 L410 58 L410 36 L500 36" /></svg>
          <div className="lp-chart-end"><span>12</span> releases</div>
        </div>
        <div className="lp-outcomes"><div><span>CONTROL</span><strong>Verified</strong></div><div><span>DISPUTES</span><strong>0</strong></div></div>
      </div>
      <div className="lp-ticket-foot"><span>PROOF <b>repo file + wallet</b></span><span>AGENT BOND <b>$5,000</b></span></div>
      <div className="lp-stamp">VERIFIED</div>
    </aside>
  );
}

function RegiBootstrap() {
  return (
    <section id="regi" className="lp-regi">
      <div className="lp-frame lp-regi-grid">
        <div>
          <p className="lp-kicker">$REGI</p>
          <h2>Registrai&apos;s token on Arc.<br /><em>Builders never need one.</em></h2>
        </div>
        <div className="lp-regi-copy">
          <p>$REGI is Registrai&apos;s token on Arc mainnet. It is separate from verification: builders don&apos;t hold, buy or issue a token to be verified, and agent bonds stay in USDC. The official contract is below; anything else using the name is not ours.</p>
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

function HowItWorks() {
  return (
    <section className="lp-fees">
      <div className="lp-frame">
        <div className="lp-section-head"><p className="lp-kicker">Proof, not promises</p><h2>How Registrai<br />supports builders.</h2><p>No token to launch and nothing to buy. Prove you control your project, let bonded agents record what you ship, and point anyone to one public record.</p></div>
        <div className="lp-flow" aria-label="How verification works">
          <div className="lp-flow-source"><span>YOUR PROJECT</span><strong>Any</strong><small>chain, open or closed source</small></div>
          <div className="lp-flow-line" aria-hidden="true"><i /><i /><i /></div>
          <div className="lp-routes">{steps.map((step) => <article className={`lp-route ${step.className}`} key={step.label}><div className="lp-route-number">{step.value}</div><h3>{step.label}</h3><p>{step.note}</p></article>)}</div>
        </div>
        <p className="lp-fineprint">Open-source projects prove control with a signed file in their repo; closed-source projects with a signed file on their domain plus their onchain deployments. <a href="https://builder.registrai.cc/verify/">Verify your project →</a></p>
      </div>
    </section>
  );
}

function Settlement() {
  return (
    <section className="lp-settlement"><div className="lp-frame"><div className="lp-settlement-head"><div><p className="lp-kicker">Honest by construction</p><h2>Proof with<br />something to lose.</h2></div><p>Reading the record is free. Every reading is bonded. That makes the agent the one party the protocol can punish for being wrong.</p></div><div className="lp-steps">{safeguards.map(([number, title, copy]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div></div></section>
  );
}

function Infrastructure() {
  return (
    <section className="lp-infra lp-frame"><div className="lp-orbit" aria-hidden="true"><div className="lp-orbit-ring"><span>ARC</span></div><i className="lp-satellite lp-satellite-a" /><i className="lp-satellite lp-satellite-b" /></div><div className="lp-infra-copy"><p className="lp-kicker">One registry, every ecosystem</p><h2>Builders can ship anywhere.<br />Proof lives on Arc.</h2><p>Registrai verifies progress across networks, so builders never need to migrate, issue a token, or join a chain-specific launch. Arc is where the proof is recorded, not the boundary.</p><dl><div><dt>Builder scope</dt><dd>Any chain</dd></div><div><dt>Proof recorded</dt><dd>Arc</dd></div><div><dt>Bonds</dt><dd>USDC</dd></div></dl></div></section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer lp-frame"><div><BrandMark className="lp-footer-mark" /></div><div className="lp-footer-links"><a href="https://builder.registrai.cc/builders/">Verified builders →</a><Link href="/bridge">Bridge USDC →</Link><a href={REGI_EXPLORER_URL} target="_blank" rel="noreferrer">$REGI on Arc ↗</a><a href="/brand/registrai-brand-kit-regi.zip" download>Brand kit ↓</a><a href={REGISTRAI_X_URL} target="_blank" rel="me noreferrer">X @registraicc ↗</a><a href="https://github.com/registrai-multichain" target="_blank" rel="noreferrer">GitHub ↗</a><a href="mailto:contact@registrai.cc">contact@registrai.cc</a></div><div className="lp-footer-status"><i /> Building in public<br /><span>Warsaw / 2026</span></div></footer>
  );
}

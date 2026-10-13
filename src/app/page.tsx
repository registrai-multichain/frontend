import { BrandLockup, BrandMark } from "@/components/Brand";
import { REGISTRAI_X_URL, REGI_CONTRACT, REGI_DEXSCREENER_URL, REGI_EXPLORER_URL } from "@/lib/regi";
import { InfoBubble } from "@/components/InfoBubble";
import Link from "next/link";
import { Reveal } from "@/components/landing/Reveal";
import { LiveBoard, LiveChips } from "@/components/landing/LiveBoard";
import "./landing.css";

import { AUDIENCE, AUDIENCE_SECTION, FOOTER_BRAND_LINE, HERO, HOW_WE_PUBLISH, HOW_WE_PUBLISH_URL, INDICES_URL, MEASURED, MEASURED_LABEL, PRODUCTS, PRODUCTS_SECTION, STEPS, STEPS_INFO, STEPS_SECTION, TIERS, TIERS_SECTION } from "@/lib/landing";

export default function Home() {
  return (
    <div className="lp">
      <Header />
      <main>
        <Hero />
        <Measured />
        <Products />
        <Steps />
        <Audience />
        <Tiers />
        <HowWePublish />
        <RegiBootstrap />
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
        <a href={INDICES_URL} className="lp-bridge-link">Indices <span>→</span></a>
        <a href="https://builder.registrai.cc/builders/" className="lp-bridge-link">Verified builders <span>→</span></a>
        <Link href="/bridge" className="lp-bridge-link">Bridge USDC <span>→</span></Link>
      </span>
    </header>
  );
}

function Hero() {
  const [lead, accent] = HERO.headline.endsWith(HERO.headlineAccent)
    ? [HERO.headline.slice(0, -HERO.headlineAccent.length), HERO.headlineAccent]
    : [HERO.headline, ""];
  return (
    <section id="top" className="lp-x-hero">
      <div className="lp-x-hero-bg" aria-hidden="true"><i className="lp-x-grid" /><i className="lp-x-glow" /><i className="lp-x-scan" /></div>
      <div className="lp-frame lp-x-hero-grid">
        <div className="lp-x-hero-copy">
          <p className="lp-kicker lp-reveal">{HERO.eyebrow}</p>
          <h1 className="lp-x-h1">
            <span className="lp-x-line"><span style={{ ["--i" as string]: 0 }}>{lead}</span></span>
            {accent && <span className="lp-x-line"><em style={{ ["--i" as string]: 1 }}>{accent}</em></span>}
          </h1>
          <p className="lp-deck lp-reveal lp-delay-2">{HERO.subline}</p>
          <div className="lp-cta-row lp-reveal lp-delay-3">
            <a className="lp-cta lp-cta--primary lp-x-cta" href={INDICES_URL}>{HERO.primaryCta} <span>→</span></a>
            <a className="lp-cta lp-x-cta" href={HERO.secondaryHref}>{HERO.secondaryCta} <span>→</span></a>
          </div>
          <p className="lp-micro lp-reveal lp-delay-3">{HERO.microcopy}</p>
        </div>
        <div className="lp-x-hero-board lp-reveal lp-delay-2"><LiveBoard /></div>
      </div>
    </section>
  );
}

function Measured() {
  const row = [...MEASURED, ...MEASURED];
  return (
    <section className="lp-x-marquee" aria-label={MEASURED_LABEL}>
      <span className="lp-x-marquee-label">{MEASURED_LABEL}</span>
      <div className="lp-x-marquee-track"><ul>{row.map((n, k) => <li key={k} aria-hidden={k >= MEASURED.length}>{n}</li>)}</ul></div>
    </section>
  );
}

function Products() {
  return (
    <section className="lp-x-products">
      <div className="lp-frame">
        <Reveal className="lp-x-head"><p className="lp-kicker">{PRODUCTS_SECTION.kicker}</p><h2>Four products. One record of Arc.</h2></Reveal>
        <Reveal className="lp-x-cards">
          {PRODUCTS.map((p, k) => (
            <article className={`lp-x-card${k === 0 ? " lp-x-card--wide lp-x-card--dark" : k === 2 ? " lp-x-card--wide" : ""}`} key={p.name} style={{ ["--i" as string]: k }}>
              <div className="lp-x-card-top">
                <span className="lp-x-num">0{k + 1}</span>
                <span className={`lp-x-pill lp-x-pill--${p.tag === "Live" ? "live" : p.tag === "Building now" ? "build" : "later"}`}><i />{p.tag}</span>
              </div>
              <h3>{p.name}{p.info && <InfoBubble label={`How the ${p.name.toLowerCase()} work`}>{p.info}</InfoBubble>}</h3>
              {p.line && <p>{p.line}</p>}
              {p.items && (
                <ul>
                  {p.items.map((i) => (
                    <li key={i.text}>{i.name && <strong>{i.name} </strong>}<span>{i.text}</span>{i.tag && <span className={`lp-x-mini lp-x-mini--${i.tag === "Live" ? "live" : "build"}`}>{i.tag}</span>}</li>
                  ))}
                </ul>
              )}
              {k === 0 && <LiveChips />}
              {p.link && <a className="lp-x-link" href={p.link.href}>{p.link.label} <span>→</span></a>}
            </article>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

function Steps() {
  return (
    <section className="lp-x-steps">
      <div className="lp-frame">
        <Reveal className="lp-x-head lp-x-head--dark">
          <p className="lp-kicker">{STEPS_SECTION.kicker}<InfoBubble label="The index method">{STEPS_INFO}</InfoBubble></p>
          <h2>{STEPS_SECTION.headline}</h2>
        </Reveal>
        <Reveal className="lp-x-steps-row">
          <svg className="lp-x-wire" viewBox="0 0 1000 8" preserveAspectRatio="none" aria-hidden="true"><path d="M0 4 H1000" /></svg>
          {STEPS.map((st, k) => (
            <div className="lp-x-step" key={st.n} style={{ ["--i" as string]: k }}>
              <span className="lp-x-step-n">{st.n}</span>
              <h3>{st.title}</h3>
              <p>{st.text}</p>
            </div>
          ))}
        </Reveal>
        <Reveal className="lp-x-steps-cta"><a className="lp-cta lp-cta--primary lp-x-cta" href={INDICES_URL}>Open the indices <span>→</span></a></Reveal>
      </div>
    </section>
  );
}

function Audience() {
  return (
    <section className="lp-x-audience">
      <div className="lp-frame">
        <Reveal className="lp-x-head"><p className="lp-kicker">{AUDIENCE_SECTION.kicker}</p><h2>Built for the people who need to know what&apos;s real on Arc.</h2></Reveal>
        <Reveal as="ul" className="lp-x-aud">
          {AUDIENCE.map((a, k) => <li key={a.who} style={{ ["--i" as string]: k }}><span className="lp-x-num">0{k + 1}</span><strong>{a.who}</strong><span>{a.what.charAt(0).toUpperCase() + a.what.slice(1)}</span></li>)}
        </Reveal>
      </div>
    </section>
  );
}

function Tiers() {
  return (
    <section className="lp-tiers lp-frame">
      <p className="lp-kicker">{TIERS_SECTION.kicker}</p>
      <h2>{TIERS_SECTION.headline}</h2>
      <div className="lp-tier-grid">
        {TIERS.map((tier) => (
          <article className="lp-tier" key={tier.name}>
            <h3>{tier.name}</h3>
            {tier.headline && <p className="lp-tier-headline">{tier.headline}</p>}
            <p className="lp-tier-price">{tier.price}</p>
            <ul>
              {tier.items.map((item) => (
                <li key={item.text}>{item.text}{item.tag && <span className="lp-tag">{item.tag}</span>}</li>
              ))}
            </ul>
            {tier.href.startsWith("mailto:")
              ? <a className="lp-cta" href={tier.href}>{tier.cta} <span>→</span></a>
              : <a className="lp-cta lp-cta--primary" href={tier.href} target="_blank" rel="noreferrer">{tier.cta} <span>→</span></a>}
          </article>
        ))}
      </div>
    </section>
  );
}

function HowWePublish() {
  return (
    <section className="lp-publish lp-frame">
      <div>
        <p className="lp-kicker">{HOW_WE_PUBLISH.kicker}</p>
        <h2>{HOW_WE_PUBLISH.headline}</h2>
        <a className="lp-cta lp-publish-link" href={HOW_WE_PUBLISH_URL} target="_blank" rel="noreferrer">{HOW_WE_PUBLISH.link} <span>→</span></a>
      </div>
      <div>
        <ul>{HOW_WE_PUBLISH.lines.map((line) => <li key={line}>{line}</li>)}</ul>
      </div>
    </section>
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
          <p>$REGI is Registrai&apos;s token on Arc mainnet. It is separate from verification: builders don&apos;t hold, buy or issue a token to be verified. The official contract is below; anything else using the name is not ours.</p>
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

function Footer() {
  return (
    <footer className="lp-footer lp-frame"><div><BrandMark className="lp-footer-mark" /></div><div className="lp-footer-links"><a href={INDICES_URL}>Indices →</a><a href="https://builder.registrai.cc/builders/">Verified builders →</a><Link href="/bridge">Bridge USDC →</Link><a href={REGI_EXPLORER_URL} target="_blank" rel="noreferrer">$REGI on Arc ↗</a><a href="/brand/registrai-brand-kit-regi.zip" download>Brand kit ↓</a><a href={REGISTRAI_X_URL} target="_blank" rel="me noreferrer">X @registraicc ↗</a><a href="https://github.com/registrai-multichain" target="_blank" rel="noreferrer">GitHub ↗</a><a href="mailto:contact@registrai.cc">contact@registrai.cc</a></div><div className="lp-footer-status"><i /> Building in public<br /><span>Warsaw / 2026</span></div><p className="lp-footer-note">{FOOTER_BRAND_LINE}</p></footer>
  );
}

import { BrandLockup, BrandMark } from "@/components/Brand";
import { REGISTRAI_X_URL, REGI_CONTRACT, REGI_DEXSCREENER_URL, REGI_EXPLORER_URL } from "@/lib/regi";
import Link from "next/link";

import { FOOTER_BRAND_LINE, FOOTER_PAUSE_LINE, HERO, HOW_WE_PUBLISH, HOW_WE_PUBLISH_URL, STRIP, TRACK_RECORD_URL, TIERS, TIERS_SECTION, VERIFY_URL } from "@/lib/landing";

export default function Home() {
  return (
    <div className="lp">
      <Header />
      <main>
        <Hero />
        <WhatTabulaDoes />
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
        <a href="https://builder.registrai.cc/builders/" className="lp-bridge-link">Verified builders <span>→</span></a>
        <Link href="/bridge" className="lp-bridge-link">Bridge USDC <span>→</span></Link>
      </span>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="lp-hero lp-hero--solo lp-frame">
      <div className="lp-hero-copy">
        <p className="lp-kicker lp-reveal">{HERO.eyebrow}</p>
        <h1 className="lp-reveal lp-delay-1">{HERO.headline}</h1>
        <p className="lp-deck lp-reveal lp-delay-2">{HERO.subline}</p>
        <div className="lp-cta-row lp-reveal lp-delay-3">
          <a className="lp-cta lp-cta--primary" href={VERIFY_URL} target="_blank" rel="noreferrer">{HERO.primaryCta} <span>→</span></a>
          <a className="lp-cta" href={HOW_WE_PUBLISH_URL} target="_blank" rel="noreferrer">{HERO.secondaryCta} <span>→</span></a>
        </div>
        <p className="lp-micro lp-reveal lp-delay-3">{HERO.microcopy}</p>
      </div>
    </section>
  );
}

function WhatTabulaDoes() {
  return (
    <section className="lp-fees">
      <div className="lp-frame">
        <p className="lp-kicker">{STRIP.kicker}</p>
        <div className="lp-routes">
          {STRIP.items.map((item) => (
            <article className="lp-route" key={item.name}>
              <h3>{item.name}</h3>
              <p>{item.line}</p>
              <span className="lp-tag">{item.tag}</span>
            </article>
          ))}
        </div>
        <p className="lp-fineprint">{STRIP.note}{" "}<a href={TRACK_RECORD_URL} target="_blank" rel="noreferrer">{STRIP.trackLink}</a></p>
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
    <footer className="lp-footer lp-frame"><div><BrandMark className="lp-footer-mark" /></div><div className="lp-footer-links"><a href="https://builder.registrai.cc/builders/">Verified builders →</a><Link href="/bridge">Bridge USDC →</Link><a href={REGI_EXPLORER_URL} target="_blank" rel="noreferrer">$REGI on Arc ↗</a><a href="/brand/registrai-brand-kit-regi.zip" download>Brand kit ↓</a><a href={REGISTRAI_X_URL} target="_blank" rel="me noreferrer">X @registraicc ↗</a><a href="https://github.com/registrai-multichain" target="_blank" rel="noreferrer">GitHub ↗</a><a href="mailto:contact@registrai.cc">contact@registrai.cc</a></div><div className="lp-footer-status"><i /> Building in public<br /><span>Warsaw / 2026</span></div><p className="lp-footer-note">{FOOTER_BRAND_LINE}<br />{FOOTER_PAUSE_LINE}</p></footer>
  );
}

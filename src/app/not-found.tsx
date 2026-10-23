import Link from "next/link";
import { BrandLockup } from "@/components/Brand";

/**
 * The 404 for every Registrai site. Deliberately not the app's Shell: that
 * shell is the testnet app's (its nav and footer point into testnet), and the
 * public registrai.cc must not lead there.
 */
export default function NotFound() {
  return (
    <div className="lp">
      <header className="lp-nav lp-frame">
        <Link href="/" className="lp-brand" aria-label="Registrai home">
          <BrandLockup markClassName="lp-brand-mark" wordmarkClassName="lp-brand-name" />
        </Link>
        <span />
        <span />
      </header>
      <main className="lp-frame lp-404">
        <p className="lp-kicker">404</p>
        <h1>
          That page isn&apos;t <em>here</em>.
        </h1>
        <p className="lp-deck">The address may be mistyped, or the page has moved.</p>
        <div className="lp-404-links">
          <Link href="/" className="lp-bridge-link">
            Home <span>→</span>
          </Link>
          <a href="https://builder.registrai.cc/builders/" className="lp-bridge-link">
            Verified builders <span>→</span>
          </a>
        </div>
      </main>
    </div>
  );
}

import Link from "next/link";
import { FREEZE } from "@/lib/freeze";
import { REGISTRAI_X_URL } from "@/lib/regi";

/** One line under the top bar of every markets-app and dashboard page. */
export function FreezeBanner({ withdraw = true }: { withdraw?: boolean }) {
  return (
    <div className="freeze-banner" role="status">
      <p className="freeze-banner-in">
        <b>{FREEZE.title}.</b> {FREEZE.text}{" "}
        {withdraw && (
          <>
            <a href={FREEZE.withdrawHref}>Withdraw funds</a> ·{" "}
          </>
        )}
        <a href={REGISTRAI_X_URL} target="_blank" rel="me noreferrer">
          Updates on X ↗
        </a>
      </p>
    </div>
  );
}

/** The full notice that replaces the markets, proposals and "How it works" pages. */
export function FreezeNotice() {
  return (
    <section className="max-w-[64ch]" aria-labelledby="freeze-title">
      <h1 id="freeze-title" className="pa-h1 pu-h">
        {FREEZE.title}
      </h1>
      <p className="pa-lede mt-2">{FREEZE.text}</p>
      <div className="pa-card mt-8">
        <h2 className="pa-h3">Have money in a market?</h2>
        <p className="pa-muted mt-1">{FREEZE.funds}</p>
        <Link href="/rounds/" className="pa-btn mt-4">
          Withdraw and claim →
        </Link>
      </div>
      <p className="pa-muted mt-8">
        Registrai keeps supporting project builders: the{" "}
        <a className="pa-link" href="https://builder.registrai.cc/builders/">
          verified builder registry
        </a>{" "}
        stays live on Arc. Follow{" "}
        <a className="pa-link" href={REGISTRAI_X_URL} target="_blank" rel="me noreferrer">
          @registraicc
        </a>{" "}
        for the update.
      </p>
    </section>
  );
}

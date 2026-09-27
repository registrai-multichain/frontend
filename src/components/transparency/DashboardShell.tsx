import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "../Brand";
import { WalletButton } from "../WalletButton";
import { Toasts } from "../paper/Toasts";
import { BUILDERS } from "@/lib/builders-network";
import { APP_URL, HOME_URL } from "@/lib/site-nav";

// Keep the server-to-client prop JSON-safe (viem's chain object carries functions).
const WALLET_CHAIN = { id: BUILDERS.chain.id, name: BUILDERS.chain.name, shortName: BUILDERS.chain.shortName };

/** dashboard.registrai.cc is its own site: brand + wallet only, no app navigation. */
export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <div className="paper-theme paper-type flex min-h-screen flex-col">
      <header className="pa-topbar">
        <div className="pa-top">
          <Link href="/" className="pa-brand transition-opacity hover:opacity-80" aria-label="Registrai transparency dashboard">
            <BrandLockup markClassName="h-7 w-7" wordmarkClassName="text-[20px]" />
            <small>Transparency</small>
          </Link>
          <div className="pa-top-right">
            <WalletButton chain={WALLET_CHAIN} />
          </div>
        </div>
      </header>

      <main className="pa-main w-full flex-1">{children}</main>

      <footer className="pa-foot">
        <div className="pa-foot-in">
          <span>Read live from Arc mainnet</span>
          <span className="flex flex-wrap gap-4">
            <a href={HOME_URL}>registrai.cc ↗</a>
            <a href={APP_URL}>App ↗</a>
            <a href="https://github.com/registrai-multichain" target="_blank" rel="noreferrer">GitHub ↗</a>
          </span>
        </div>
      </footer>
      <Toasts />
    </div>
  );
}

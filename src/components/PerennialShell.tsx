import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "./Brand";
import { WalletButton } from "./WalletButton";
import { PaperNav, type NavItem } from "./paper/PaperNav";
import { Toasts } from "./paper/Toasts";
import { BalancePill } from "./perennial/BalancePill";
import { PERENNIAL, networkStatusLine } from "@/lib/perennial-network";

// Keep the server-to-client prop JSON-safe (viem's chain object carries functions).
const WALLET_CHAIN = { id: PERENNIAL.chain.id, name: PERENNIAL.chain.name, shortName: PERENNIAL.chain.shortName };

const NAV: NavItem[] = [
  { href: "/perennial/", label: "Markets", also: ["/perennial/wonder/"] },
  { href: "/rounds/", label: "Rounds" },
  { href: "/perennial/builders/", label: "Builders" },
  { href: "/atlas/", label: "Atlas" },
  { href: "/perennial/economy/", label: "How it works" },
  { href: "/transparency/", label: "Transparency" },
];

export function PerennialShell({ children }: { children: ReactNode }) {
  return (
    <div className="paper-theme paper-type flex min-h-screen flex-col">
      <header className="pa-topbar">
        <div className="pa-top">
          <Link href="/" className="pa-brand transition-opacity hover:opacity-80" aria-label="Registrai home">
            <BrandLockup markClassName="h-7 w-7" wordmarkClassName="text-[20px]" />
          </Link>
          <PaperNav items={NAV} variant="bar" />
          <div className="pa-top-right">
            <BalancePill />
            <WalletButton chain={WALLET_CHAIN} />
          </div>
        </div>
        <PaperNav items={NAV} variant="row" />
      </header>

      <main className="pa-main w-full flex-1">{children}</main>

      <footer className="pa-foot">
        <div className="pa-foot-in">
          <span>{networkStatusLine(PERENNIAL)} · settles in {PERENNIAL.network === "mainnet" ? "USDC" : "test USDC"}</span>
          <span className="flex flex-wrap gap-4">
            <Link href="/">Home</Link>
            <a href="https://github.com/registrai-multichain" target="_blank" rel="noreferrer">GitHub ↗</a>
          </span>
        </div>
      </footer>
      <Toasts />
    </div>
  );
}

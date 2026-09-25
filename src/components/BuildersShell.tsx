import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "./Brand";
import { WalletButton } from "./WalletButton";
import { PaperNav, type NavItem } from "./paper/PaperNav";
import { BUILDERS } from "@/lib/builders-network";

// JSON-safe for the client WalletButton (viem's chain object carries functions).
const WALLET_CHAIN = { id: BUILDERS.chain.id, name: BUILDERS.chain.name, shortName: BUILDERS.chain.shortName };

const NAV: NavItem[] = [
  { href: "/builders/", label: "Gallery" },
  { href: "/verify/", label: "Verify" },
  { href: "/guide/", label: "Guide" },
];

/**
 * The builder side's frame (/builders, /verify, /guide, /admin): the paper look,
 * pinned to the BUILDERS network and saying nothing about markets (mainnet phase 1
 * has only the builder registries).
 */
export function BuildersShell({ children, wallet = false }: { children: ReactNode; wallet?: boolean }) {
  return (
    <div className="paper-theme paper-type flex min-h-screen flex-col">
      <header className="pa-topbar">
        <div className="pa-top">
          <Link href="/" className="pa-brand transition-opacity hover:opacity-80" aria-label="Registrai home">
            <BrandLockup markClassName="h-7 w-7" wordmarkClassName="text-[20px]" />
            <small>builders</small>
          </Link>
          <PaperNav items={NAV} variant="bar" />
          <div className="pa-top-right">{wallet && <WalletButton chain={WALLET_CHAIN} />}</div>
        </div>
        <PaperNav items={NAV} variant="row" />
      </header>

      <main className="pa-main w-full flex-1">{children}</main>

      <footer className="pa-foot">
        <div className="pa-foot-in">
          <span>Verified builders on {BUILDERS.label}</span>
          <span className="flex flex-wrap gap-4">
            <Link href="/guide/">Builder guide</Link>
            <a href="https://registrai.cc">registrai.cc ↗</a>
            <a href="https://github.com/registrai-multichain" target="_blank" rel="noreferrer">GitHub ↗</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

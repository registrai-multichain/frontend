import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "./Brand";
import { WalletButton } from "./WalletButton";
import { PERENNIAL } from "@/lib/perennial-network";

export function PerennialShell({ children }: { children: ReactNode }) {
  return (
    <div className="perennial-theme flex min-h-screen flex-col">
      <header className="perennial-nav sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-xl">
        <div className="mx-auto grid h-[70px] w-full max-w-[1280px] grid-cols-[1fr_auto] items-center gap-4 px-5 sm:h-[82px] sm:grid-cols-[1fr_auto_1fr] sm:px-10">
          <Link href="/" className="flex w-max items-center gap-2.5 transition-opacity hover:opacity-80" aria-label="Registrai home">
            <BrandLockup markClassName="h-7 w-7 sm:h-8 sm:w-8" wordmarkClassName="text-[19px] sm:text-[21px]" />
            <span className="border border-line px-1.5 py-0.5 text-[9px] uppercase tracking-[0.15em] text-fg-dim">
              perennial
            </span>
          </Link>

          <div className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-fg-dim sm:flex">
            <i className="h-1.5 w-1.5 rounded-full bg-up" />
            Arc testnet markets
          </div>

          <nav className="flex items-center justify-self-end gap-3">
            <Link href="/bridge" className="hidden font-mono text-[9px] uppercase tracking-[0.13em] text-fg-dim transition-colors hover:text-fg md:inline">
              bridge
            </Link>
            <WalletButton chain={PERENNIAL.chain} />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] flex-1 px-5 pb-24 sm:px-10">{children}</main>

      <footer className="mt-14 border-t border-line">
        <div className="mx-auto grid w-full max-w-[1280px] items-center gap-5 px-5 py-7 text-[9px] uppercase tracking-[0.12em] text-fg-dim sm:grid-cols-[1fr_auto] sm:px-10">
          <span>Perennial / Arc testnet / test USDC</span>
          <div className="flex flex-wrap gap-4">
            <Link href="/" className="transition-colors hover:text-accent">home ↗</Link>
            <a href="https://github.com/registrai-multichain" target="_blank" rel="noreferrer" className="transition-colors hover:text-accent">github ↗</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

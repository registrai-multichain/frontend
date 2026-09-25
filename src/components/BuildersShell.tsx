import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "./Brand";
import { WalletButton } from "./WalletButton";
import { BUILDERS, buildersStatusLine } from "@/lib/builders-network";

// JSON-safe for the client WalletButton (viem's chain object carries functions).
const WALLET_CHAIN = { id: BUILDERS.chain.id, name: BUILDERS.chain.name, shortName: BUILDERS.chain.shortName };

/**
 * The builder side's frame (/builders, /verify): Perennial's visual language,
 * but pinned to the BUILDERS network and saying nothing about markets — in
 * mainnet phase 1 only the builder registries exist.
 */
export function BuildersShell({ children, wallet = false }: { children: ReactNode; wallet?: boolean }) {
  return (
    <div className="perennial-theme builders-theme flex min-h-screen flex-col">
      <header className="perennial-nav sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-xl">
        <div className="mx-auto grid h-[70px] w-full max-w-[1280px] grid-cols-[1fr_auto] items-center gap-4 px-5 sm:h-[82px] sm:grid-cols-[1fr_auto_1fr] sm:px-10">
          <Link href="/" className="flex w-max items-center gap-2.5 transition-opacity hover:opacity-80" aria-label="Registrai home">
            <BrandLockup markClassName="h-7 w-7 sm:h-8 sm:w-8" wordmarkClassName="text-[19px] sm:text-[21px]" />
            <span className="hidden border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-[0.15em] text-fg-mute min-[420px]:inline">builders</span>
          </Link>

          <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-mute sm:flex">
            <i className={`h-1.5 w-1.5 rounded-full ${BUILDERS.deployed ? "bg-up" : "bg-fg-dim"}`} />
            {buildersStatusLine(BUILDERS)}
          </div>

          <nav className="flex items-center justify-self-end gap-3 sm:gap-4">
            <Link href="/builders" className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-fg-mute transition-colors hover:text-fg">
              gallery
            </Link>
            <Link href="/verify" className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-fg-mute transition-colors hover:text-fg">
              verify
            </Link>
            <Link href="/guide" className="hidden font-mono text-[10.5px] uppercase tracking-[0.13em] text-fg-mute transition-colors hover:text-fg min-[430px]:inline">
              guide
            </Link>
            {wallet && <WalletButton chain={WALLET_CHAIN} />}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-24 sm:px-10">{children}</main>

      <footer className="mt-14 border-t border-line">
        <div className="mx-auto grid w-full max-w-[1280px] items-center gap-5 px-4 py-7 text-[10px] uppercase tracking-[0.12em] text-fg-mute sm:grid-cols-[1fr_auto] sm:px-10">
          <span>Verified builders / {BUILDERS.label}</span>
          <div className="flex flex-wrap gap-4">
            <Link href="/guide" className="transition-colors hover:text-accent">builder guide</Link>
            <a href="https://registrai.cc" className="transition-colors hover:text-accent">registrai.cc ↗</a>
            <a href="https://github.com/registrai-multichain" target="_blank" rel="noreferrer" className="transition-colors hover:text-accent">github ↗</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

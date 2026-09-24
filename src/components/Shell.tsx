import Link from "next/link";
import { WalletButton } from "./WalletButton";
import { StatusBadge } from "./StatusBadge";
import { NavMenu } from "./NavMenu";
import { BrandLockup } from "./Brand";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <main className="flex-1 w-full max-w-[920px] mx-auto px-6 sm:px-10 pb-24">
        {children}
      </main>
      <Footer />
    </div>
  );
}

function TopNav() {
  return (
    <header className="w-full border-b border-line sticky top-0 z-10 bg-bg">
      <div className="max-w-[920px] mx-auto px-5 sm:px-10 h-14 sm:h-16 flex items-center justify-between gap-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 sm:gap-3 hover:opacity-80 transition-opacity min-w-0"
          aria-label="Registrai"
        >
          <BrandLockup
            markClassName="h-7 w-7 sm:h-9 sm:w-9"
            wordmarkClassName="text-[19px] sm:text-[22px]"
          />
          <StatusBadge kind="beta" className="hidden sm:inline-flex ml-1" />
        </Link>
        <nav className="flex items-center gap-4 sm:gap-5 text-[12px] tracking-wide text-fg-mute shrink-0">
          {/* The two market surfaces sit together and are colour-coded by where
              the 50% leg of the 1% resolution fee goes: perennial in commons
              teal (builder commons), common markets in paper ink (Registrai
              treasury). Same fee, same 30/20/50 split. */}
          <Link
            href="/perennial"
            className="hidden sm:inline text-commons font-medium hover:opacity-70 transition-opacity"
          >
            perennial
          </Link>
          <Link
            href="/markets"
            className="hidden sm:inline hover:text-fg transition-colors"
          >
            common markets
          </Link>
          <NavMenu />
          <WalletButton />
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line mt-24">
      <div className="max-w-[920px] mx-auto px-6 sm:px-10 py-10 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <BrandLockup
            markClassName="h-9 w-9"
            wordmarkClassName="text-[22px]"
          />
          <div className="flex items-center gap-4 text-2xs tracking-wide text-fg-dim">
            <a href="/brand/registrai-brand-kit-regi.zip" download className="hover:text-accent transition-colors">
              brand kit ↓
            </a>
            <a
              href="https://github.com/registrai-multichain"
              target="_blank"
              rel="noreferrer"
              className="hover:text-accent transition-colors"
            >
              github ↗
            </a>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] tracking-wide text-fg-dim border-t border-line pt-4">
          <div className="flex items-center gap-2">
            <span>registrai // EVM · arc testnet // v2 · onchain credits live</span>
            <a
              href="https://testnet.arcscan.app/address/0xF5897349819B16f4431A61Ad61293C1b31bD3381"
              target="_blank"
              rel="noreferrer"
              className="text-fg-mute hover:text-accent transition-colors"
            >
              ↗ points contract
            </a>
          </div>
          <div className="flex items-center gap-4">
            <span>fees fixed in code</span>
            <span className="text-fg-dim/60">·</span>
            <span>oracle layer free</span>
            <span className="text-fg-dim/60">·</span>
            <Link href="/#regi" className="hover:text-accent transition-colors">$REGI bootstraps network</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

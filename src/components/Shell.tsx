import Link from "next/link";
import { WalletButton } from "./WalletButton";
import { StatusBadge } from "./StatusBadge";

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
    <header className="w-full border-b border-line/80 sticky top-0 z-10 backdrop-blur-md bg-bg/70">
      <div className="max-w-[920px] mx-auto px-6 sm:px-10 h-14 sm:h-16 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          aria-label="Registrai"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/wordmark.png"
            alt="Registrai"
            className="h-10 sm:h-12 w-auto wordmark-invert"
          />
          <StatusBadge kind="beta" className="ml-1" />
        </Link>
        <nav className="flex items-center gap-5 text-[12px] tracking-wide text-fg-mute">
          <Link href="/" className="hover:text-fg transition-colors">
            feeds
          </Link>
          <Link href="/markets" className="hover:text-fg transition-colors">
            markets
          </Link>
          <Link href="/vault" className="hover:text-fg transition-colors">
            vault
          </Link>
          <Link href="/agents/create" className="hidden md:inline hover:text-fg transition-colors">
            become agent
          </Link>
          <Link href="/profile" className="hover:text-fg transition-colors">
            profile
          </Link>
          <Link href="/docs" className="hover:text-fg transition-colors">
            docs
          </Link>
          <Link href="/devlog" className="hidden md:inline hover:text-fg transition-colors">
            devlog
          </Link>
          <Link href="/about" className="hidden md:inline hover:text-fg transition-colors">
            about
          </Link>
          <a
            href="https://github.com/registrai"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:inline hover:text-fg transition-colors"
          >
            github ↗
          </a>
          <WalletButton />
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line/80 mt-24">
      <div className="max-w-[920px] mx-auto px-6 sm:px-10 py-10 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/wordmark.png"
            alt="Registrai"
            className="h-10 sm:h-12 w-auto wordmark-invert"
          />
          <a
            href="https://github.com/registrai-multichain"
            target="_blank"
            rel="noreferrer"
            className="text-2xs tracking-wide text-fg-dim hover:text-accent transition-colors"
          >
            github ↗
          </a>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] tracking-wide text-fg-dim border-t border-line/60 pt-4">
          <div className="flex items-center gap-2">
            <span>registrai // arc testnet // v0.1</span>
            <a
              href="https://testnet.arcscan.app/address/0xBB6F4B18776Fd20Bb53a1205375273373DD1E5bA"
              target="_blank"
              rel="noreferrer"
              className="text-fg-mute hover:text-accent transition-colors"
            >
              ↗ contracts
            </a>
          </div>
          <div className="flex items-center gap-4">
            <span>no admin keys</span>
            <span className="text-fg-dim/60">·</span>
            <span>oracle layer free</span>
            <span className="text-fg-dim/60">·</span>
            <span>no token</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

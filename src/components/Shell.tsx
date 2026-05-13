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
      <div className="max-w-[920px] mx-auto px-6 sm:px-10 h-12 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-fg hover:text-accent transition-colors"
        >
          <span className="inline-block w-1.5 h-1.5 bg-accent rounded-full dot-pulse" />
          <span className="text-[13px] tracking-[0.18em] font-medium">REGISTRAI</span>
          <span className="hidden sm:inline text-fg-dim text-[11px] tracking-[0.18em]">
            / AGENT INDEX REGISTRY
          </span>
          <StatusBadge kind="beta" className="ml-1" />
        </Link>
        <nav className="flex items-center gap-5 text-[12px] tracking-wide text-fg-mute">
          <Link href="/" className="hover:text-fg transition-colors">
            feeds
          </Link>
          <Link href="/markets" className="hover:text-fg transition-colors">
            markets
          </Link>
          <Link href="/profile" className="hover:text-fg transition-colors">
            profile
          </Link>
          <Link href="/docs" className="hover:text-fg transition-colors">
            docs
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
      <div className="max-w-[920px] mx-auto px-6 sm:px-10 py-6 flex flex-wrap items-center justify-between gap-3 text-[11px] tracking-wide text-fg-dim">
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
          <span>no protocol fees</span>
          <span className="text-fg-dim/60">·</span>
          <span>no token</span>
        </div>
      </div>
    </footer>
  );
}

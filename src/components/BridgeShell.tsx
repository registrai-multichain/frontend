"use client";

/**
 * Chrome for the bridge, deliberately NOT the main site's `Shell`.
 *
 * The rest of registrai.cc is an Arc-only app: its `Shell` renders a
 * `WalletButton` bound to the Arc chain registry. The bridge is the opposite —
 * it is multichain by definition and spends most of its time asking the wallet
 * to sit on Base or Ethereum. Sharing chrome put two competing wallet
 * connections on one page: the header insisting on Arc while the bridge drove
 * the user somewhere else.
 *
 * So the bridge gets its own header, showing the one wallet state that is
 * actually true for this page while sharing the landing page identity.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { chainByChainId } from "@/lib/cctp/domains";
import { BrandLockup } from "@/components/Brand";

export function BridgeShell({
  children,
  address,
  chainId,
  chainLabel,
  onConnect,
  error,
}: {
  children: ReactNode;
  address?: string;
  chainId?: number;
  chainLabel?: string;
  onConnect: () => void;
  error?: string;
}) {
  const chain = chainId ? chainByChainId(chainId) : undefined;

  return (
    <div className="bridge-theme flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 w-full border-b border-line bg-bg/90 backdrop-blur-lg">
        <div className="mx-auto flex h-[70px] max-w-[1180px] items-center justify-between gap-3 px-5 sm:h-[82px] sm:px-10">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80"
            aria-label="Registrai"
          >
            <BrandLockup
              markClassName="h-7 w-7 sm:h-8 sm:w-8"
              wordmarkClassName="text-[19px] sm:text-[21px]"
            />
            <span className="hidden border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-fg-dim sm:inline">
              bridge
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-3 text-[12px]">
            {address ? (
              <>
                <span className="hidden text-2xs uppercase tracking-[0.14em] text-fg-dim sm:inline">
                  {chainLabel ?? (chain ? chain.name : chainId ? `chain ${chainId}` : "unknown chain")}
                </span>
                <span className="tnum border border-line px-2 py-1 text-[11px] text-fg-mute">
                  {address.slice(0, 6)}…{address.slice(-4)}
                </span>
              </>
            ) : (
              <button
                onClick={onConnect}
                className="border border-accent bg-accent px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-bg transition-opacity hover:opacity-85"
              >
                connect
              </button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-auto w-full max-w-[1180px] px-5 pt-4 sm:px-10">
          <p className="border border-down/50 bg-down/[0.06] px-3 py-2 text-2xs text-down">{error}</p>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-5 pb-24 sm:px-10">{children}</main>

      <footer className="mt-20 border-t border-line">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-5 py-8 text-[11px] tracking-wide text-fg-dim sm:px-10">
          <span>
            registrai bridge // circle cctp // burn-and-mint, no custody
          </span>
          <span className="flex items-center gap-3">
            <a href="/brand/registrai-brand-kit-regi.zip" download className="transition-colors hover:text-accent">
              brand kit ↓
            </a>
            <Link href="/" className="transition-colors hover:text-accent">
              home ↗
            </Link>
            <a
              href="https://github.com/registrai-multichain"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-accent"
            >
              github ↗
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}

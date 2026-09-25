"use client";

import { useEffect, useState } from "react";
import { isMobileUserAgent, metamaskDappLink } from "@/lib/verify-invite";

/**
 * A phone with no wallet in this browser (a DM link opened in Telegram's or
 * X's in-app browser): offer to reopen this exact page, invite and all, in the
 * MetaMask app's browser, and the link to paste into any other wallet's browser.
 * Renders nothing on desktop or where a wallet is injected. Decided after
 * mount, so the static HTML never differs from the first client render.
 */
export function useMobileWithoutWallet(): string | null {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    if (window.ethereum || !isMobileUserAgent(navigator.userAgent)) return;
    setHref(window.location.href);
  }, []);
  return href;
}

export function MobileWalletLink({ href }: { href: string }) {
  const [copied, setCopied] = useState(false);
  const mm = metamaskDappLink(href);
  return (
    <div className="vf-mobile-wallet">
      <p className="vf-note">No wallet in this browser. Open this page in your wallet app to continue:</p>
      {mm && (
        <a className="vf-primary" href={mm}>
          open in MetaMask
        </a>
      )}
      <p className="vf-hint">
        Another wallet (Rabby, Coinbase Wallet, Trust, OKX)? Copy this page&apos;s link and open it in the wallet&apos;s built-in browser.{" "}
        <button
          type="button"
          className="vf-mini"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(href);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // clipboard blocked: the address bar still has it
            }
          }}
        >
          {copied ? "copied" : "copy link"}
        </button>
      </p>
    </div>
  );
}

/**
 * Pure helpers for the invitee's first screen on /verify: the next badge
 * number and its art, and the MetaMask link that reopens the page inside the
 * wallet's own browser on a phone (where a DM link opens in Telegram's or X's
 * browser, with no wallet in it).
 */
import { serialLabel } from "./verified-builder-badge";

/** Serials with rendered art in public/badge/<net>/ (scripts/render-badges.py); later ones use the generic picture. */
export const RENDERED_BADGE_SERIALS = 50;

/** "Next up: No. 001" from the badge's nextSerial, or null while unknown. */
export function nextBadgeLine(nextSerial: number | null | undefined): string | null {
  if (!nextSerial || !Number.isSafeInteger(nextSerial) || nextSerial < 1) return null;
  return `Next up: ${serialLabel(nextSerial)}`;
}

/** The art for the next badge: its own numbered picture while one is rendered, else the generic one. */
export function nextBadgeImage(network: string, nextSerial: number | null | undefined): string {
  const n = nextSerial && Number.isSafeInteger(nextSerial) && nextSerial >= 1 ? nextSerial : 0;
  return n >= 1 && n <= RENDERED_BADGE_SERIALS ? `/badge/${network}/${n}.jpg` : `/badge/${network}/badge-generic.jpg`;
}

/** A phone or tablet browser (where there is usually no injected wallet). */
export function isMobileUserAgent(ua: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

/**
 * MetaMask's universal link that opens `href` in the MetaMask app's browser
 * (`https://metamask.app.link/dapp/<host><path><query>`). Only for https pages;
 * the fragment is dropped (the app does not keep it).
 */
export function metamaskDappLink(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  return `https://metamask.app.link/dapp/${u.host}${u.pathname}${u.search}`;
}

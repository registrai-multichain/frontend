/**
 * A domain project's picture: the site's own icon, found server-side
 * (GET /api/icon on the builders site) so visitors' browsers never contact
 * the project's site and the page CSP stays `img-src 'self'`.
 *
 * Where it looks, in order: /apple-touch-icon.png (usually 180 px), the
 * homepage's <link rel="apple-touch-icon" | "icon"> (the largest declared,
 * never SVG), then /favicon.ico. Every request follows the proof check's rules
 * (proofUrlAllowed: https, a public host, no IP literal / localhost / port;
 * manual redirects, each target re-checked, at most PROOF_MAX_REDIRECTS),
 * with byte caps and one deadline. An image counts only when its bytes are
 * PNG, JPEG, GIF, WebP or ICO (sniffed, not the Content-Type): never SVG,
 * which could run script if served from our origin.
 *
 * RELATIVE IMPORTS ONLY: wrangler bundles this file into the Pages Functions.
 */
import { PROOF_MAX_REDIRECTS, proofHostAllowed, proofUrlAllowed, readCapped } from "./proof-fetch";

export const ICON_MAX_BYTES = 200 * 1024;
export const ICON_HTML_MAX_BYTES = 256 * 1024;
export const ICON_TIMEOUT_MS = 8_000;
export const ICON_API_PATH = "/api/icon";

export type IconType = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/x-icon";

/** Pure: the image type by its magic bytes, or null (SVG, HTML, anything else). */
export function sniffImageType(b: Uint8Array): IconType | null {
  const at = (i: number) => b[i];
  if (b.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (b.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (b.length >= 6 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif";
  if (b.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) {
    return "image/webp";
  }
  if (b.length >= 6 && at(0) === 0x00 && at(1) === 0x00 && (at(2) === 0x01 || at(2) === 0x02) && at(3) === 0x00) return "image/x-icon";
  return null;
}

/**
 * Pure: the icon URLs a homepage declares, best first: apple-touch-icon, then
 * rel=icon by its largest declared size; SVG (by type or extension) left out;
 * resolved against the page URL, only those proofUrlAllowed accepts.
 */
export function iconLinksFromHtml(html: string, pageUrl: string): string[] {
  const found: { url: string; rank: number; size: number }[] = [];
  const head = html.slice(0, ICON_HTML_MAX_BYTES);
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (name: string) => {
      const a = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
      return a ? (a[2] ?? a[3] ?? a[4] ?? "").trim() : "";
    };
    const rel = attr("rel").toLowerCase().split(/\s+/);
    const isApple = rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed");
    if (!isApple && !rel.includes("icon")) continue;
    const href = attr("href");
    if (!href || /^data:/i.test(href)) continue;
    if (/svg/i.test(attr("type")) || /\.svgz?(\?|#|$)/i.test(href)) continue;
    let url: string;
    try {
      url = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    if (!proofUrlAllowed(url)) continue;
    const size = Math.max(0, ...attr("sizes").split(/\s+/).map((s) => Number(s.split(/x/i)[0]) || 0));
    found.push({ url, rank: isApple ? 0 : 1, size });
  }
  found.sort((a, b) => a.rank - b.rank || b.size - a.size);
  return [...new Set(found.map((f) => f.url))];
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

/** At most the first `max` bytes of a body (the rest is not downloaded). */
async function readPrefix(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).slice(0, max);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  while (n < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
  }
  await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(n, max));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, out.length - at);
    out.set(part, at);
    at += part.length;
    if (at >= out.length) break;
  }
  return out;
}

/**
 * One GET under the proof rules. `prefix`: the first `max` bytes of any 2xx
 * body (a homepage: its <head> comes first); otherwise the whole body, or
 * null when it is over `max` (an icon).
 */
async function safeGet(
  url: string,
  o: { fetchImpl: typeof fetch; signal: AbortSignal; max: number; accept: string; prefix?: boolean },
): Promise<{ bytes: Uint8Array; url: string } | null> {
  if (!proofUrlAllowed(url)) return null;
  // Called as a plain function: the Workers runtime rejects fetch invoked as a
  // method of another object ("Illegal invocation").
  const f = o.fetchImpl;
  let target = url;
  for (let hop = 0; ; hop++) {
    const res = await f(target, {
      redirect: "manual",
      signal: o.signal,
      headers: { accept: o.accept, "user-agent": "registrai-icon (+https://builder.registrai.cc)" },
    });
    if (REDIRECT.has(res.status)) {
      const loc = res.headers.get("location");
      if (!loc || hop >= PROOF_MAX_REDIRECTS) return null;
      let next: string;
      try {
        next = new URL(loc, target).toString();
      } catch {
        return null;
      }
      if (!proofUrlAllowed(next)) return null;
      target = next;
      continue;
    }
    if (!res.ok) return null;
    const bytes = o.prefix ? await readPrefix(res, o.max) : await readCapped(res, o.max);
    return bytes ? { bytes, url: target } : null;
  }
}

export interface SiteIcon {
  bytes: Uint8Array;
  type: IconType;
  url: string;
}

/** Server side: the site's icon for a domain source (`domain:<host>`), or null. */
export async function findSiteIcon(
  source: string,
  o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<SiteIcon | null> {
  if (!source.startsWith("domain:")) return null;
  const host = source.slice(7);
  if (!proofHostAllowed(host)) return null;
  const f = o.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(o.timeoutMs ?? ICON_TIMEOUT_MS);
  const origin = `https://${host}`;
  const tryImage = async (url: string): Promise<SiteIcon | null> => {
    const r = await safeGet(url, { fetchImpl: f, signal, max: ICON_MAX_BYTES, accept: "image/png,image/*;q=0.8" }).catch(() => null);
    if (!r) return null;
    const type = sniffImageType(r.bytes);
    return type ? { bytes: r.bytes, type, url: r.url } : null;
  };
  try {
    const apple = await tryImage(`${origin}/apple-touch-icon.png`);
    if (apple) return apple;
    const page = await safeGet(`${origin}/`, { fetchImpl: f, signal, max: ICON_HTML_MAX_BYTES, accept: "text/html", prefix: true }).catch(() => null);
    if (page) {
      const html = new TextDecoder().decode(page.bytes);
      for (const url of iconLinksFromHtml(html, page.url).slice(0, 4)) {
        const icon = await tryImage(url);
        if (icon) return icon;
      }
    }
    return await tryImage(`${origin}/favicon.ico`);
  } catch {
    return null;
  }
}

const X_HANDLE_RE = /^@?([A-Za-z0-9_]{1,15})$/;

/**
 * The X profile picture of a handle through unavatar.io (it resolves X's
 * current picture; `fallback=false` answers 404 instead of a generic image),
 * or null for a handle that is not one.
 */
export function xAvatarUrl(handle: string): string | null {
  const m = X_HANDLE_RE.exec(handle.trim());
  return m ? `https://unavatar.io/x/${m[1]}?fallback=false` : null;
}

/**
 * Server side: a project's X profile picture, the fallback when its site has
 * no usable icon (a bot wall, or none at all). Same rules as a site icon: https
 * only, redirects re-checked, capped bytes, and it must sniff as an image.
 */
export async function findXAvatar(
  handle: string,
  o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<SiteIcon | null> {
  const url = xAvatarUrl(handle);
  if (!url) return null;
  const signal = AbortSignal.timeout(o.timeoutMs ?? ICON_TIMEOUT_MS);
  const r = await safeGet(url, { fetchImpl: o.fetchImpl ?? fetch, signal, max: ICON_MAX_BYTES, accept: "image/*" }).catch(() => null);
  if (!r) return null;
  const type = sniffImageType(r.bytes);
  return type ? { bytes: r.bytes, type, url: r.url } : null;
}

/** The picture URL a page shows for a domain source: this site's /api/icon (relative, so it is same-origin). */
export function siteIconPath(source: string): string {
  return `${ICON_API_PATH}?source=${encodeURIComponent(source)}`;
}

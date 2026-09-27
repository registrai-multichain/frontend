/**
 * Mirrored project pictures in the builders KV (`avatar:<source>`), so /api/icon
 * does not depend on a free third party at request time. The loader
 * (scripts/load-avatars.ts) fetches a project's X picture once, from a normal
 * connection, and stores it here; /api/icon serves it when the site has no usable
 * icon (see lib/icon.ts). A record is JSON (the KV binding here stores text):
 *
 *   { type, from: "x:@handle", fetchedAt, b64 }
 *
 * Capped at the icon size (200 KB) and checked on the way in and out: the bytes
 * must sniff as the stated image type.
 */
import { ICON_MAX_BYTES, sniffImageType, type IconType, type SiteIcon } from "../../src/lib/site-icon";
import type { KV } from "./env";

export const avatarKey = (source: string) => `avatar:${source}`;

interface MirroredAvatar {
  type: IconType;
  from: string;
  fetchedAt: string;
  b64: string;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array | null {
  try {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** The KV value for a picture; throws when it is over 200 KB or not the image it claims to be. */
export function encodeAvatar(icon: SiteIcon, from: string, now: Date): string {
  if (icon.bytes.length > ICON_MAX_BYTES) throw new Error(`picture too large: ${icon.bytes.length} bytes (max 200 KB)`);
  if (sniffImageType(icon.bytes) !== icon.type) throw new Error("the bytes are not the stated image type");
  const rec: MirroredAvatar = { type: icon.type, from, fetchedAt: now.toISOString(), b64: toB64(icon.bytes) };
  return JSON.stringify(rec);
}

/** A stored record back as an icon, or null for anything missing, oversized or not an image. */
export function decodeAvatar(raw: string | null): SiteIcon | null {
  if (!raw) return null;
  let rec: Partial<MirroredAvatar>;
  try {
    rec = JSON.parse(raw) as Partial<MirroredAvatar>;
  } catch {
    return null;
  }
  if (typeof rec.b64 !== "string" || typeof rec.type !== "string") return null;
  const bytes = fromB64(rec.b64);
  if (!bytes || bytes.length === 0 || bytes.length > ICON_MAX_BYTES) return null;
  const type = sniffImageType(bytes);
  if (!type || type !== rec.type) return null;
  return { bytes, type, url: `kv:${rec.from ?? ""}` };
}

export async function getMirroredAvatar(kv: KV, source: string): Promise<SiteIcon | null> {
  return decodeAvatar(await kv.get(avatarKey(source)));
}

/** Pure: which invites the loader looks at: domain sources with an X handle, each once, sorted. */
export function avatarCandidates(invites: { source: string; x?: string }[]): { source: string; handle: string }[] {
  const seen = new Map<string, string>();
  for (const i of invites) if (i.source.startsWith("domain:") && i.x && !seen.has(i.source)) seen.set(i.source, i.x);
  return [...seen].sort(([a], [b]) => a.localeCompare(b)).map(([source, handle]) => ({ source, handle }));
}

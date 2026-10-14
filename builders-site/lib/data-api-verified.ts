/** Data API v1 /verified: projects whose proof validates against the mainnet BuilderRegistry (same rules as the gallery). KV-cached 5 min. */
import { createPublicClient, fallback, http, type Address } from "viem";
import mainnet from "../../src/lib/deployments/arc-mainnet.json";
import { proofConfigFromEnv } from "../../src/lib/verified-builders";
import { makeFetchJson, readBuilderRecords, type BuilderRecord, type RegistryReader } from "../../src/lib/verified-builders-chain";
import { isoHour } from "./data-api-rows";
import { cached, v1Error, v1Json } from "./data-api";
import type { Env } from "./env";
import type { EdgeCacheDeps } from "./http";

export const VERIFIED_KEY = "data:verified";
export const VERIFIED_TTL_S = 300;
export type VerifiedEntry = { id: string; method: "registry"; since: string };
type Read = () => Promise<BuilderRecord[]>;

export function verifiedFromRecords(records: BuilderRecord[]): VerifiedEntry[] {
  const best = new Map<string, number>();
  for (const b of records) {
    if (!b.active) continue;
    for (const p of b.projects) {
      if (p.status !== "verified" || !p.canonical || !p.active) continue;
      const h = Math.floor(p.addedAt / 3600);
      best.set(p.source, Math.min(best.get(p.source) ?? Infinity, h));
    }
  }
  return [...best].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, h]) => ({ id, method: "registry" as const, since: isoHour(h) }));
}

// Arc mainnet builder registry, straight from the deployments record: src/lib/builders-network.ts reads Next's
// process.env when it loads, and Workers have no process (test/worker-imports.test.ts).
// Arc's public RPC rate-limits eth_call from Cloudflare Workers ("rate limit exceeded" from the second call on), so
// Blockdaemon's public Arc endpoint goes first, with backoff, and the public RPC is the fallback.
const ARC_RPCS = ["https://rpc.blockdaemon.mainnet.arc.io", "https://rpc.mainnet.arc.io"];
const REG = mainnet.builders as { BuilderRegistry: string; CaretakerRegistry: string | null; operator: string | null };

const chainRead = (env: Env): Read => async () => {
  const client = createPublicClient({ transport: fallback(ARC_RPCS.map((u) => http(u, { retryCount: 3, retryDelay: 600 }))) });
  return readBuilderRecords(client as unknown as RegistryReader, {
    builderRegistry: REG.BuilderRegistry as Address, caretakerRegistry: (REG.CaretakerRegistry as Address | null) ?? null, operator: (REG.operator as Address | null) ?? null,
    chainId: mainnet.chainId, proofConfig: proofConfigFromEnv(env as unknown as Record<string, string | undefined>), fetchJson: makeFetchJson({ timeoutMs: 8_000 }),
  });
};

export async function loadVerified(env: Env, _deps: EdgeCacheDeps, read: Read = chainRead(env)): Promise<{ updated: string; verified: VerifiedEntry[] } | null> {
  let stale: { updated: string; verified: VerifiedEntry[] } | null = null;
  try { stale = JSON.parse((await env.INVITES.get(VERIFIED_KEY)) ?? "null"); } catch { stale = null; }
  if (stale && Date.now() - Date.parse(stale.updated) < VERIFIED_TTL_S * 1000) return stale;
  let fresh: { updated: string; verified: VerifiedEntry[] };
  try {
    fresh = { updated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), verified: verifiedFromRecords(await read()) };
  } catch (err) {
    console.warn("data-api verified read failed", err);
    return stale;
  }
  // a KV put failure (e.g. a 429 from concurrent writers of one key) must not throw away a good read
  await env.INVITES.put(VERIFIED_KEY, JSON.stringify(fresh)).catch((err: unknown) => console.warn("data-api verified cache write failed", err));
  return fresh;
}

/** For /members: the KV copy only, never the chain on the request path. A stale or missing copy is refreshed in the background. */
export async function verifiedIds(env: Env, deps: EdgeCacheDeps, read?: Read): Promise<Set<string>> {
  let v: { updated: string; verified: VerifiedEntry[] } | null = null;
  try { v = JSON.parse((await env.INVITES.get(VERIFIED_KEY)) ?? "null"); } catch { v = null; }
  if ((!v || Date.now() - Date.parse(v.updated) >= VERIFIED_TTL_S * 1000) && deps.waitUntil) deps.waitUntil(loadVerified(env, deps, read).catch(() => null));
  return new Set(v?.verified.map((x) => x.id) ?? []);
}

export function handleVerified(req: Request, env: Env, deps: EdgeCacheDeps = {}, read?: Read): Promise<Response> {
  return cached(req, deps, "verified", async () => {
    const v = await loadVerified(env, deps, read);
    return v ? v1Json(req, v, VERIFIED_TTL_S) : v1Error(503, "Verified projects are not available right now. Retry later.");
  }, VERIFIED_TTL_S);
}

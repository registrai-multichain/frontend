/**
 * Evidence re-check results (contract: src/lib/verify.ts). KV `verify:<source>` and `verify:track` -> VerifyMap.
 *   GET  /api/bot/facts          radar (Bearer RADAR_PUBLISH_SECRET): { sources: ProjectFacts-without-reviewedBy[] }, embargoed facts included
 *   POST /api/bot/facts/verify   radar (Bearer): { source | "track", results } merged into verify:<source>; one KV write; 404 for a source with no facts (not "track")
 */
import { mergeVerify, validateVerifyInput, VERIFY_TRACK, type VerifyMap } from "../../src/lib/verify";
import { botGuard } from "./bot-auth";
import { FACTS_KEY_PREFIX, listNames, MAX_SOURCES, mapChunks } from "./kv-chunks";
import type { Env, KV } from "./env";
import { errorJson, json, readJson } from "./http";

export const VERIFY_PREFIX = "verify:";

/** The verify map of a source (or "track"); empty when absent or unreadable. */
export async function getVerify(kv: KV, source: string): Promise<VerifyMap> {
  const text = await kv.get(`${VERIFY_PREFIX}${source}`);
  if (!text) return {};
  try {
    const p = JSON.parse(text) as unknown;
    return typeof p === "object" && p !== null && !Array.isArray(p) ? (p as VerifyMap) : {};
  } catch {
    return {};
  }
}

export async function handleBotFacts(req: Request, env: Env): Promise<Response> {
  const refused = botGuard(req, env, "GET", "fact listing");
  if (refused) return refused;
  const names = await listNames(env.INVITES, FACTS_KEY_PREFIX);
  if (names.length > MAX_SOURCES) return errorJson(507, "too many sources");
  const sources: Record<string, unknown>[] = [];
  for (const text of await mapChunks(names, (n) => env.INVITES.get(n))) {
    if (!text) continue;
    try {
      const p = JSON.parse(text) as Record<string, unknown>;
      if (!p || typeof p.source !== "string" || !Array.isArray(p.facts)) continue;
      const { reviewedBy: _b, ...rest } = p;
      void _b;
      sources.push(rest);
    } catch {
      /* an unreadable record is skipped */
    }
  }
  return json({ sources });
}

export async function handleBotVerify(req: Request, env: Env, nowMs = Date.now()): Promise<Response> {
  const refused = botGuard(req, env, "POST", "verify publishing");
  if (refused) return refused;
  const v = validateVerifyInput(await readJson(req), nowMs);
  if (!v.ok) return errorJson(400, v.error);
  if (v.source !== VERIFY_TRACK && (await env.INVITES.get(`${FACTS_KEY_PREFIX}${v.source}`)) === null) return errorJson(404, "no facts for this source");
  const merged = mergeVerify(await getVerify(env.INVITES, v.source), v.results);
  await env.INVITES.put(`${VERIFY_PREFIX}${v.source}`, JSON.stringify(merged));
  return json({ ok: true, source: v.source, stored: Object.keys(v.results).length });
}

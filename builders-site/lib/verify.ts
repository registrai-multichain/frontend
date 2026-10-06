/**
 * Evidence re-check results (contract: src/lib/verify.ts). KV `verify:<source>` and `verify:track` -> VerifyMap.
 *   GET  /api/bot/facts          radar (Bearer RADAR_PUBLISH_SECRET): { sources: ProjectFacts-without-reviewedBy[] }, embargoed facts included
 *   POST /api/bot/facts/verify   radar (Bearer): { source | "track", results } merged into verify:<source>; one KV write
 */
import { mergeVerify, validateVerifyInput, type VerifyMap } from "../../src/lib/verify";
import { botGuard } from "./bot-auth";
import type { Env, KV } from "./env";
import { errorJson, json, readJson } from "./http";

export const VERIFY_PREFIX = "verify:";
const FACTS_KEY_PREFIX = "facts:"; // = FACTS_PREFIX in facts.ts (not imported: facts.ts imports this file)

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
  const sources: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.INVITES.list({ prefix: FACTS_KEY_PREFIX, cursor });
    for (const k of page.keys) {
      const text = await env.INVITES.get(k.name);
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
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return json({ sources });
}

export async function handleBotVerify(req: Request, env: Env, nowMs = Date.now()): Promise<Response> {
  const refused = botGuard(req, env, "POST", "verify publishing");
  if (refused) return refused;
  const v = validateVerifyInput(await readJson(req), nowMs);
  if (!v.ok) return errorJson(400, v.error);
  const merged = mergeVerify(await getVerify(env.INVITES, v.source), v.results);
  await env.INVITES.put(`${VERIFY_PREFIX}${v.source}`, JSON.stringify(merged));
  return json({ ok: true, source: v.source, stored: Object.keys(v.results).length });
}

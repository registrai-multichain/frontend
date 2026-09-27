/**
 * Nomination drafts (contract: src/lib/drafts.ts): prepared by the investigation
 * session, reviewed and signed by the owner in /admin → Nominate on chain. Private
 * (a draft's profile holds red flags): only the session-gated admin API serves them.
 *
 *   GET    /api/admin/drafts            every draft: "nominate" first, then "hold", each by name
 *   POST   /api/admin/drafts            store one (validated); the middleware allows admins only
 *   DELETE /api/admin/drafts/<source>   drop one (admin)
 */
import { validateDraft, type NominationDraft } from "../../src/lib/drafts";
import { normalizeSource } from "../../src/lib/verified-builders";
import type { Env, KV } from "./env";
import { errorJson, json, readJson } from "./http";

export const DRAFT_PREFIX = "draft:";
const key = (source: string) => `${DRAFT_PREFIX}${source}`;

export async function listDrafts(kv: KV): Promise<NominationDraft[]> {
  const out: NominationDraft[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: DRAFT_PREFIX, cursor });
    for (const k of page.keys) {
      const raw = await kv.get(k.name);
      if (!raw) continue;
      try {
        const v = validateDraft(JSON.parse(raw));
        if (v.ok) out.push(v.value);
      } catch {
        // an unreadable record is skipped, never served
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => (a.recommendation === b.recommendation ? a.invite.name.localeCompare(b.invite.name) : a.recommendation === "nominate" ? -1 : 1));
}

/** GET / POST /api/admin/drafts */
export async function handleAdminDrafts(req: Request, env: Env): Promise<Response> {
  const method = req.method.toUpperCase();
  if (method === "GET") return json({ drafts: await listDrafts(env.INVITES) });
  if (method === "POST") {
    const v = validateDraft(await readJson(req));
    if (!v.ok) return errorJson(400, v.error);
    await env.INVITES.put(key(v.value.source), JSON.stringify(v.value), { metadata: { source: v.value.source, name: v.value.invite.name } });
    return json({ draft: v.value });
  }
  return errorJson(405, "method not allowed");
}

/** DELETE /api/admin/drafts/<source> */
export async function handleAdminDraft(req: Request, env: Env, rawSource: string): Promise<Response> {
  if (req.method.toUpperCase() !== "DELETE") return errorJson(405, "method not allowed");
  const source = normalizeSource(rawSource);
  if (!source || source !== rawSource) return errorJson(400, "not a canonical source");
  await env.INVITES.delete(key(source));
  return json({ deleted: source });
}

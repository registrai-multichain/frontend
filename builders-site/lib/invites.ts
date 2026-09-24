/**
 * Invites (KV `invite:<normalized source>` -> InviteRecord JSON, its public
 * projection as the key's metadata) plus a public index (`index:invites`,
 * PublicInvite[]) so the gallery's GET /api/invites is one KV read, never a
 * list: KV lists are slow to see new keys and scarce on the free plan.
 *
 *   GET    /api/invites                    public fields only, cached 60 s (one edge key, query ignored)
 *   POST   /api/invites/open {source,code} claim-link open tracking; always 204. Cheap
 *                                          rejects first (size, type, code format)
 *                                          before any KV read; at most one write per
 *                                          invite a minute
 *   GET    /api/admin/invites              everything, with each claim link
 *   POST   /api/admin/invites              create (409 + the existing one if the source is taken)
 *   PATCH  /api/admin/invites              edit name / x / note
 *   DELETE /api/admin/invites?source=
 */
import {
  INVITE_CODE_RE,
  applyInviteFields,
  claimLink,
  inviteKey,
  newInvite,
  publicInvite,
  recordOpen,
  safeEqual,
  validateInviteInput,
  type InviteRecord,
  type PublicInvite,
} from "../../src/lib/builders-admin";
import { normalizeSource } from "../../src/lib/verified-builders";
import type { Env, KV } from "./env";
import { errorJson, json, noContent, randomHex, readJson, siteOrigin } from "./http";

export const INDEX_KEY = "index:invites";

function parseRecord(raw: string | null): InviteRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as InviteRecord;
    return typeof r?.source === "string" && typeof r.code === "string" ? r : null;
  } catch {
    return null;
  }
}

export async function getInvite(kv: KV, source: string): Promise<InviteRecord | null> {
  return parseRecord(await kv.get(inviteKey(source)));
}

async function putInvite(kv: KV, r: InviteRecord): Promise<void> {
  await kv.put(inviteKey(r.source), JSON.stringify(r), { metadata: publicInvite(r) });
}

const byCreated = (a: PublicInvite, b: PublicInvite) => a.createdAt.localeCompare(b.createdAt) || a.source.localeCompare(b.source);

/** The public index; rebuilt from a KV list when missing. */
export async function readIndex(kv: KV): Promise<PublicInvite[]> {
  const raw = await kv.get(INDEX_KEY);
  if (raw) {
    try {
      const idx = JSON.parse(raw);
      if (Array.isArray(idx)) return idx as PublicInvite[];
    } catch {
      // fall through: rebuild
    }
  }
  const out: PublicInvite[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list<PublicInvite>({ prefix: "invite:", cursor });
    for (const k of page.keys) {
      if (k.metadata && typeof k.metadata.source === "string") out.push(k.metadata);
      else {
        const r = parseRecord(await kv.get(k.name));
        if (r) out.push(publicInvite(r));
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  out.sort(byCreated);
  await kv.put(INDEX_KEY, JSON.stringify(out));
  return out;
}

async function updateIndex(kv: KV, source: string, entry: PublicInvite | null): Promise<void> {
  const idx = (await readIndex(kv)).filter((p) => p.source !== source);
  if (entry) idx.push(entry);
  idx.sort(byCreated);
  await kv.put(INDEX_KEY, JSON.stringify(idx));
}

// ───────────────────────────── public ─────────────────────────────

export async function handlePublicInvites(env: Env): Promise<Response> {
  // Re-projected: the index only ever holds public fields, and this keeps it so.
  const invites = (await readIndex(env.INVITES)).map((p) => publicInvite(p as InviteRecord));
  return json({ invites }, 200, { "cache-control": "public, max-age=60" });
}

/** The edge cache key for GET /api/invites: the path alone (a `?x=` cannot make it miss). */
export function invitesCacheKey(requestUrl: string): string {
  return `${new URL(requestUrl).origin}/api/invites`;
}

/** An open body is tiny: `{source, code}`. */
export const OPEN_MAX_BODY = 512;
/** Opens of the same invite closer together than this are not written again. */
export const OPEN_DEBOUNCE_MS = 60_000;

/**
 * A claim link was opened. Wrong or missing codes are ignored silently: always
 * 204. Everything that costs nothing is checked before the one KV read: the
 * declared size, the content type, the body's shape, the code's format and the
 * source's; the write is skipped when the same invite was opened in the last minute.
 */
export async function handleInviteOpen(req: Request, env: Env, nowMs = Date.now()): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > OPEN_MAX_BODY) return noContent();
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return noContent();
  const text = await req.text().catch(() => "");
  if (!text || text.length > OPEN_MAX_BODY) return noContent();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return noContent();
  }
  if (typeof body !== "object" || body === null) return noContent();
  const { source: rawSource, code } = body as Record<string, unknown>;
  if (typeof code !== "string" || !INVITE_CODE_RE.test(code)) return noContent();
  if (typeof rawSource !== "string" || rawSource.length > 300) return noContent();
  const source = normalizeSource(rawSource);
  if (!source) return noContent();
  const r = await getInvite(env.INVITES, source);
  if (!r || !safeEqual(r.code, code)) return noContent();
  const last = r.lastOpenedAt ? Date.parse(r.lastOpenedAt) : NaN;
  if (Number.isFinite(last) && nowMs - last >= 0 && nowMs - last < OPEN_DEBOUNCE_MS) return noContent();
  await putInvite(env.INVITES, recordOpen(r, new Date(nowMs).toISOString()));
  return noContent();
}

// ───────────────────────────── admin ─────────────────────────────

const withLink = (env: Env, r: InviteRecord) => ({ ...r, claimLink: claimLink(siteOrigin(env), r.source, r.code) });

export async function handleAdminInvites(req: Request, env: Env, admin: string, nowMs = Date.now()): Promise<Response> {
  const kv = env.INVITES;
  switch (req.method.toUpperCase()) {
    case "GET": {
      const idx = await readIndex(kv);
      const records = (await Promise.all(idx.map((p) => getInvite(kv, p.source)))).filter((r): r is InviteRecord => r !== null);
      records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json({ invites: records.map((r) => withLink(env, r)) });
    }
    case "POST": {
      const v = validateInviteInput(await readJson(req));
      if (!v.ok) return errorJson(400, v.error);
      const existing = await getInvite(kv, v.source);
      if (existing) return errorJson(409, "already invited", { invite: withLink(env, existing) });
      const r = newInvite(v.source, v.fields, { code: randomHex(12), createdAt: new Date(nowMs).toISOString(), createdBy: admin });
      await putInvite(kv, r);
      await updateIndex(kv, r.source, publicInvite(r));
      return json({ invite: withLink(env, r) }, 201);
    }
    case "PATCH": {
      const v = validateInviteInput(await readJson(req));
      if (!v.ok) return errorJson(400, v.error);
      const existing = await getInvite(kv, v.source);
      if (!existing) return errorJson(404, "no invite for that source");
      const r = applyInviteFields(existing, v.fields);
      await putInvite(kv, r);
      await updateIndex(kv, r.source, publicInvite(r));
      return json({ invite: withLink(env, r) });
    }
    case "DELETE": {
      const source = normalizeSource(new URL(req.url).searchParams.get("source") ?? "");
      if (!source) return errorJson(400, "?source= is required");
      if (!(await getInvite(kv, source))) return errorJson(404, "no invite for that source");
      await kv.delete(inviteKey(source));
      await updateIndex(kv, source, null);
      return json({ deleted: source });
    }
    default:
      return errorJson(405, "method not allowed");
  }
}

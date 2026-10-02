/**
 * Public track record: the shared contract between the radar keeper (publisher) and the builder site
 * (POST /api/track, public GET). Format is fixed by the Tabula phase 1 constraints.
 *
 * Storage: KV `track:<yyyy-mm>` = { items: StoredItem[] } (max 2000, oldest dropped, deduped by id).
 */
import { evidenceItem, hasVerdict } from "./facts";
import { normalizeSource } from "./verified-builders";

export const PUBLIC_KINDS: readonly string[] = [
  "OwnershipTransferred", "OwnershipTransferStarted", "RoleGranted", "RoleRevoked", "RoleAdminChanged",
  "Upgraded", "AdminChanged", "BeaconUpgraded", "Paused", "Unpaused", "Blacklisted", "UnBlacklisted",
  "CallScheduled", "MinDelayChange", "AddedOwner", "RemovedOwner", "ChangedThreshold",
  "EnabledModule", "DisabledModule", "ChangedGuard", "ChangedFallbackHandler",
  "mint", "outflow", "control-map",
];
export const TRACK_LIMITS = { batch: 50, month: 2000, text: 300, evidence: 5, reason: 300 } as const;
/** Copy rule for public pages: describe what changed and when, never what it meant. */
export const BANNED_TRACK_WORDS = ["caught", "prevented", "saved", "stopped", "protected", "attack", "hack", "exploit", "scam", "rug"] as const;

export interface TrackItem {
  id: string;
  source: string;
  kind: string;
  text: string;
  evidence: string[];
  observedAt: string;
  alertTime: string;
  blockTime: string | null;
}
export type StoredItem = TrackItem & { publishedAt: string; retracted?: { at: string; reason: string } };

const ID_RE = /^[0-9a-f]{64}$/;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const BANNED_RE = new RegExp(`\\b(${BANNED_TRACK_WORDS.join("|")})\\b`, "i");
const MAX_WATCHING = 10_000;
const DAY_MS = 86_400_000;

/** Copy rule: no verdict word and no banned word (whole-word, case-insensitive). */
export const describesOnly = (text: string): boolean => !hasVerdict(text) && !BANNED_RE.test(text);

const isTime = (v: unknown): v is string => typeof v === "string" && TIME_RE.test(v) && Number.isFinite(Date.parse(v));

export function validateBatch(body: unknown, nowMs: number = Date.now()): { ok: true; watching: number; items: TrackItem[] } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "expected a JSON object" };
  const b = body as Record<string, unknown>;
  if (typeof b.watching !== "number" || !Number.isInteger(b.watching) || b.watching < 0 || b.watching > MAX_WATCHING) {
    return { ok: false, error: `watching must be an integer from 0 to ${MAX_WATCHING}` };
  }
  if (!Array.isArray(b.items)) return { ok: false, error: "items must be a list" };
  if (b.items.length > TRACK_LIMITS.batch) return { ok: false, error: `at most ${TRACK_LIMITS.batch} items per batch` };
  const items: TrackItem[] = [];
  for (const [i, raw] of b.items.entries()) {
    const at = `item ${i}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: `${at}: must be an object` };
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || !ID_RE.test(r.id)) return { ok: false, error: `${at}: id must be 64 lowercase hex characters` };
    if (typeof r.source !== "string" || normalizeSource(r.source) !== r.source) return { ok: false, error: `${at}: source must be canonical` };
    if (typeof r.kind !== "string" || !PUBLIC_KINDS.includes(r.kind)) return { ok: false, error: `${at}: kind is not public` };
    if (typeof r.text !== "string" || r.text.length < 1 || r.text.length > TRACK_LIMITS.text) return { ok: false, error: `${at}: text must be 1 to ${TRACK_LIMITS.text} characters` };
    if (!describesOnly(r.text)) return { ok: false, error: `${at}: text must describe, not judge (banned word found)` };
    if (!Array.isArray(r.evidence) || r.evidence.length < 1 || r.evidence.length > TRACK_LIMITS.evidence) return { ok: false, error: `${at}: 1 to ${TRACK_LIMITS.evidence} evidence items` };
    const evidence: string[] = [];
    for (const e of r.evidence) {
      const v = evidenceItem(e);
      if (!v) return { ok: false, error: `${at}: evidence must be an https link, an address or a tx hash` };
      evidence.push(v);
    }
    if (typeof r.observedAt !== "string" || !DAY_RE.test(r.observedAt) || !Number.isFinite(Date.parse(r.observedAt))) return { ok: false, error: `${at}: observedAt must be YYYY-MM-DD` };
    if (!isTime(r.alertTime)) return { ok: false, error: `${at}: alertTime must be an ISO UTC time` };
    if (Date.parse(r.alertTime) > nowMs + DAY_MS) return { ok: false, error: `${at}: alertTime is in the future` };
    if (r.blockTime !== null && !isTime(r.blockTime)) return { ok: false, error: `${at}: blockTime must be an ISO UTC time or null` };
    items.push({ id: r.id, source: r.source, kind: r.kind, text: r.text, evidence, observedAt: r.observedAt, alertTime: r.alertTime, blockTime: r.blockTime });
  }
  return { ok: true, watching: b.watching, items };
}

/** KV key of the month an ISO time falls in. */
export const monthKey = (iso: string): string => `track:${iso.slice(0, 7)}`;

/** Keep existing order, append unseen ids (newest last) stamped publishedAt, drop the oldest beyond the cap. */
export function mergeMonth(existing: StoredItem[], incoming: TrackItem[], nowIso: string): StoredItem[] {
  const seen = new Set(existing.map((e) => e.id));
  const out = [...existing];
  for (const it of incoming) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push({ ...it, publishedAt: nowIso });
  }
  return out.slice(-TRACK_LIMITS.month);
}

export function trackStats(items: StoredItem[], nowMs: number): { published30: number; retracted30: number; medianSeconds30: number | null } {
  const recent = items.filter((i) => {
    const t = Date.parse(i.publishedAt);
    return Number.isFinite(t) && t <= nowMs && nowMs - t <= 30 * DAY_MS;
  });
  const lags = recent
    .filter((i) => i.blockTime !== null)
    .map((i) => (Date.parse(i.alertTime) - Date.parse(i.blockTime as string)) / 1000)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const mid = lags.length >> 1;
  const medianSeconds30 = lags.length === 0 ? null : lags.length % 2 ? lags[mid] : (lags[mid - 1] + lags[mid]) / 2;
  return { published30: recent.length, retracted30: recent.filter((i) => i.retracted).length, medianSeconds30 };
}

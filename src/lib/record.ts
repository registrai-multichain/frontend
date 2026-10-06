/**
 * Daily record: the canonical JSON of everything Tabula published on a UTC day, its sha256, and the day helpers.
 * Canonical form = Python json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False):
 * keys sorted by code point, no whitespace, integers only. Proven against src/lib/__fixtures__/record_vector.json.
 *
 *   KV record:<day> -> StoredRecord, record:index -> RecordEntry[] (sorted by day)
 *   GET /api/record (the index) and GET /api/record/<day>.json (the exact hashed bytes)
 */
export interface RecordEntry { day: string; digest: string; tx: string | null }
export interface StoredRecord { json: string; digest: string; tx: string | null; createdAt: string }

export const RECORD_ORIGIN = "https://builder.registrai.cc";
export const recordUrl = (day: string): string => `${RECORD_ORIGIN}/api/record/${day}.json`;

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;

const byCodePoint = (a: string, b: string): number => {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
};

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function str(s: string): string {
  if (LONE_SURROGATE.test(s)) throw new Error("canonicalise: string is not well-formed (lone surrogate)");
  return JSON.stringify(s);
}

function emit(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "string") return str(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("canonicalise: only safe integers are allowed");
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(emit).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort(byCodePoint);
    return `{${keys.map((k) => `${str(k)}:${emit(o[k])}`).join(",")}}`;
  }
  throw new Error(`canonicalise: unsupported value (${typeof v})`);
}

/** The canonical JSON text of a value. Throws on floats, unsafe integers, NaN, lone surrogates, bigint, functions. */
export const canonicalise = (v: unknown): string => emit(v);

/** Lowercase hex sha256 of the UTF-8 bytes of `text` (Web Crypto). */
export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A real calendar date, YYYY-MM-DD. */
export function isRecordDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** Days since the epoch: the uint64 used on chain. */
export const dayToIndex = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
export const endOfDayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`) + DAY_MS - 1;

/** Null when `day` may be snapshotted now: only today (UTC); a record is the public state at the moment it was taken. */
export function validateRecordDay(day: unknown, nowMs: number): string | null {
  if (!isRecordDay(day)) return "day must be a date, YYYY-MM-DD";
  if (dayToIndex(day) !== Math.floor(nowMs / DAY_MS)) return "day must be today (UTC)";
  return null;
}

/** A 32-byte hex tx hash, lowercased; null otherwise. */
export const validateTx = (tx: unknown): string | null => (typeof tx === "string" && TX_RE.test(tx) ? tx.toLowerCase() : null);

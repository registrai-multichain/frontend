import { isRecordDay } from "./record";
import type { VerifyMap } from "./verify";

/** Plain labels only (owner copy rules): the explanation sits behind the "i" bubble. */
export const RECORD_COPY = {
  heading: "Record",
  howTo: "How to check a day: download the JSON, run `shasum -a 256 <file>`, and compare the result with the digest in the Anchored event of the transaction.",
  howWePublish: "Each fact and track record item shows the date its evidence was last re-checked. A daily record of what we published is stored, and its digest is written to Arc.",
} as const;

export const recordPath = "/api/record";
export const EXPLORER_TX = "https://explorer.arc.io/tx/";

/** `YYYY-MM-DD` (UTC) of an ISO time; null when absent or unparseable. */
export function checkDay(iso: string | undefined | null): string | null {
  if (typeof iso !== "string" || !Number.isFinite(Date.parse(iso))) return null;
  return new Date(iso).toISOString().slice(0, 10);
}

export function recheckedLine(iso: string | undefined | null): string | null {
  const d = checkDay(iso);
  return d ? `Evidence re-checked on ${d}` : null;
}

export const shortDigest = (d: string): string => `${d.slice(0, 8)}…${d.slice(-6)}`;

export function txHref(tx: string | null | undefined): string | null {
  return typeof tx === "string" && /^0x[0-9a-fA-F]{64}$/.test(tx) ? `${EXPLORER_TX}${tx}` : null;
}

export const jsonHref = (day: string): string | null => (isRecordDay(day) ? `${recordPath}/${day}.json` : null);

export type RecordRow = { day: string; digest: string; tx: string | null; txUrl: string | null; jsonUrl: string };
export type RecordState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; rows: RecordRow[] };

export function recordState(res: { status: number; body: unknown } | null): RecordState {
  if (!res) return { kind: "loading" };
  if (res.status !== 200 || !Array.isArray(res.body)) return { kind: "error" };
  const rows: RecordRow[] = [];
  for (const raw of res.body as unknown[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.day !== "string" || typeof o.digest !== "string" || !/^[0-9a-f]{64}$/.test(o.digest)) continue;
    const jsonUrl = jsonHref(o.day);
    if (!jsonUrl) continue;
    if (o.tx !== null && o.tx !== undefined && txHref(o.tx as string) === null) continue;
    const tx = typeof o.tx === "string" ? o.tx : null;
    rows.push({ day: o.day, digest: o.digest, tx, txUrl: txHref(tx), jsonUrl });
  }
  rows.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  return { kind: "ready", rows };
}

/** The problems of a failed re-check, or null when the fact passed or was never checked. */
export function needsReview(verify: VerifyMap | undefined, id: string): string[] | null {
  const e = verify && Object.hasOwn(verify, id) ? verify[id] : undefined;
  return e && e.ok === false ? e.problems : null;
}

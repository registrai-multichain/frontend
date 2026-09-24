/**
 * Registrai Verified Builders — the claim format and its validity rules.
 *
 * Spec: docs/superpowers/specs/2026-09-24-verified-builders-design.md. The keeper
 * implements the SAME rules in Python, so everything here is byte-exact and
 * pinned by src/lib/__fixtures__/verified-builder-vectors.json, which both sides
 * test against. Change a rule here and the fixture (and the keeper) must move
 * with it.
 *
 * Pure except countCreateDeployments, which takes its client as an argument.
 */
import {
  getAddress,
  isAddress,
  keccak256,
  recoverMessageAddress,
  toRlp,
  type Address,
  type Hex,
} from "viem";

// ───────────────────────────── claim + file ─────────────────────────────

export interface Claim {
  builder: string;
  source: string;
  deployers: string[];
  country: string;
  chain: number;
  issued: string;
}

export interface ProofFile {
  version: number;
  claim: Claim;
  signatures: { builder: Hex; deployers: Record<string, Hex> };
}

/** Legacy profile link prefix (`profileURI = "registrai:" + source`), from
 *  before builders had projects. Only read to NAME a legacy builder on the
 *  market pages; never a claim (spec 2026-09-24-builder-projects-design.md). */
export const PROFILE_PREFIX = "registrai:";
/** Milestone feed description the keeper uses for a verified builder. */
export const MILESTONE_FEED_PREFIX = "registrai-milestone:";

/**
 * The exact bytes every signature covers (EIP-191 personal_sign over UTF-8).
 * Addresses are lowercased and deployers sorted ascending; every other field is
 * written exactly as the claim carries it, so a claim that is not already in
 * canonical form (e.g. a lowercase country) fails the validity rules instead of
 * being silently repaired.
 */
export function canonicalClaimMessage(claim: Claim): string {
  const deployers = claim.deployers.map((d) => d.toLowerCase()).sort();
  return [
    "Registrai builder claim v1",
    `builder: ${claim.builder.toLowerCase()}`,
    `source: ${claim.source}`,
    `deployers: ${deployers.length ? deployers.join(", ") : "none"}`,
    `country: ${claim.country}`,
    `chain: ${claim.chain}`,
    `issued: ${claim.issued}`,
  ].join("\n");
}

/** Today's date as the claim's `issued` (UTC, YYYY-MM-DD). */
export function issuedToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ───────────────────────────── sources ─────────────────────────────

const GH_OWNER = /^[a-z0-9](?:[a-z0-9-]{0,38})$/;
const GH_REPO = /^[a-z0-9._-]{1,100}$/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function validHost(host: string): boolean {
  if (LOCAL_HOSTS.has(host)) return true;
  if (host.length > 253) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  // The top-level label is never all-digits: rejects raw IPs other than the
  // local test host.
  if (/^\d+$/.test(labels[labels.length - 1])) return false;
  return labels.every((l) => HOST_LABEL.test(l));
}

function githubSource(owner: string, repo: string): string | null {
  const o = owner.toLowerCase();
  const r = repo.toLowerCase().replace(/\.git$/, "");
  if (!GH_OWNER.test(o) || !GH_REPO.test(r) || r === "." || r === "..") return null;
  return `github:${o}/${r}`;
}

/**
 * Normalise what a builder types into a canonical source, or null.
 *   github URL / `github.com/o/r` / `o/r` / `github:o/r` → `github:o/r` (lowercase)
 *   URL / host / `domain:host`                           → `domain:host` (lowercase,
 *                                                          no scheme, path or port)
 * A bare `a/b` is read as a GitHub repo unless its first segment has a dot
 * (GitHub owners cannot contain one), in which case it is a host with a path.
 */
export function normalizeSource(input: string): string | null {
  let s = input.trim();
  if (!s) return null;

  const lower = s.toLowerCase();
  if (lower.startsWith("github:")) {
    const [owner, repo, ...rest] = s.slice(7).split("/");
    return rest.length || !owner || !repo ? null : githubSource(owner, repo);
  }
  if (lower.startsWith("domain:")) {
    const host = s.slice(7).toLowerCase();
    return validHost(host) ? `domain:${host}` : null;
  }

  // Strip a scheme when present; remember whether there was one.
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) return null;
    s = s.slice(scheme[0].length);
  }
  // host[:port][/path][?query][#hash]
  const hostPart = s.split(/[/?#]/, 1)[0];
  const path = s.slice(hostPart.length).split(/[?#]/, 1)[0];
  const host = hostPart.replace(/:\d+$/, "").toLowerCase().replace(/\.$/, "");
  if (hostPart.includes("@")) return null; // user-info is never a source

  if (host === "github.com" || host === "www.github.com") {
    const [owner, repo] = path.split("/").filter(Boolean);
    return owner && repo ? githubSource(owner, repo) : null;
  }
  if (!scheme && !host.includes(".") && !LOCAL_HOSTS.has(host)) {
    // `owner/repo` shorthand.
    const parts = s.replace(/\/$/, "").split("/");
    return parts.length === 2 ? githubSource(parts[0], parts[1]) : null;
  }
  return validHost(host) ? `domain:${host}` : null;
}

/** @deprecated Legacy only: the source a pre-projects `registrai:` profile
 *  link names. The profile no longer carries the claim; a builder's claims are
 *  its projects (BuilderRegistry.projectsOf). Used for display names only. */
export function sourceFromProfileURI(uri: string): string | null {
  if (!uri.startsWith(PROFILE_PREFIX)) return null;
  const source = uri.slice(PROFILE_PREFIX.length);
  return normalizeSource(source) === source ? source : null;
}

/** BuilderRegistry.MAX_SOURCE_LEN: a project's source, in UTF-8 bytes. */
export const MAX_SOURCE_LEN = 128;
/** BuilderRegistry.MAX_PROJECTS_PER_BUILDER: every project ever added counts
 *  (a removed project keeps its slot). */
export const MAX_PROJECTS_PER_BUILDER = 16;

/** UTF-8 length, as the registry measures a string. */
export const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** A canonical source the registry will take (≤ MAX_SOURCE_LEN bytes). */
export function sourceFits(source: string): boolean {
  return byteLength(source) <= MAX_SOURCE_LEN;
}

/** Human form: `owner/repo` or the host. */
export function sourceLabel(source: string): string {
  return source.replace(/^github:/, "").replace(/^domain:/, "");
}

export interface ProofFetchConfig {
  /** PROOF_GITHUB_BASE, default https://raw.githubusercontent.com */
  githubBase?: string;
  /** PROOF_DOMAIN_SCHEME, default https (http only for localhost / 127.0.0.1). */
  domainScheme?: string;
  /** PROOF_DOMAIN_PORT — test-only, honoured for localhost / 127.0.0.1 over http
   *  (mirrors the keeper), so a local "domain" server can run unprivileged. */
  domainPort?: number;
}

export const DEFAULT_GITHUB_BASE = "https://raw.githubusercontent.com";

/** Test-only overrides from the environment (scripts; never the browser). */
export function proofConfigFromEnv(env: Record<string, string | undefined>): ProofFetchConfig {
  return {
    githubBase: env.PROOF_GITHUB_BASE || undefined,
    domainScheme: env.PROOF_DOMAIN_SCHEME || undefined,
    domainPort: env.PROOF_DOMAIN_PORT ? Number(env.PROOF_DOMAIN_PORT) : undefined,
  };
}

/** Where the proof file for a canonical source is served. Throws on a
 *  non-canonical source or a disallowed scheme. */
export function proofUrl(source: string, cfg: ProofFetchConfig = {}): string {
  if (normalizeSource(source) !== source) throw new Error(`not a canonical source: ${source}`);
  if (source.startsWith("github:")) {
    const base = (cfg.githubBase ?? DEFAULT_GITHUB_BASE).replace(/\/+$/, "");
    return `${base}/${source.slice(7)}/HEAD/.registrai.json`;
  }
  const host = source.slice(7);
  const scheme = (cfg.domainScheme ?? "https").toLowerCase();
  if (scheme !== "https" && !(scheme === "http" && LOCAL_HOSTS.has(host))) {
    throw new Error(`scheme ${scheme} is only allowed for localhost / 127.0.0.1`);
  }
  const port =
    cfg.domainPort && scheme === "http" && LOCAL_HOSTS.has(host) && Number.isInteger(cfg.domainPort) ? `:${cfg.domainPort}` : "";
  return `${scheme}://${host}${port}/.well-known/registrai.json`;
}

/** Where the builder puts the file, for copy. */
export function proofLocation(source: string): string {
  return source.startsWith("github:")
    ? `.registrai.json at the root of ${sourceLabel(source)} (default branch)`
    : `https://${sourceLabel(source)}/.well-known/registrai.json`;
}

// ───────────────────────────── validity ─────────────────────────────

export type ProofResult =
  | { valid: true; claim: Claim }
  /** rule 0 = not a well-formed v1 file; 1..5 = the spec's validity rules. */
  | { valid: false; rule: 0 | 1 | 2 | 3 | 4 | 5; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof JsonNonInteger);
/** A 65-byte (r, s, v) signature as hex. The 64-byte EIP-2098 compact form is
 *  refused (the keeper refuses it too): one canonical encoding. */
const isHexSig = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{130}$/.test(v);
/** A JSON integer ≥ 0 (never a float like 5042.0, a string or a negative). */
const isJsonUint = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/**
 * A JSON number written with a fraction or an exponent (`1.0`, `5042e0`).
 * JSON.parse turns `1.0` into the integer 1; parseProofText keeps it as this
 * marker instead, so a proof whose `version` / `chain` is not a JSON integer
 * is refused exactly as the keeper (Python's json keeps floats) refuses it.
 */
export class JsonNonInteger {
  constructor(readonly literal: string) {}
  toJSON(): number {
    return Number(this.literal);
  }
}

/**
 * Parse a proof file's text. Same syntax as JSON.parse (it throws the same
 * SyntaxError on invalid JSON), except that every number with a fraction or
 * an exponent becomes a JsonNonInteger. Use it for every fetched proof before
 * validateProof.
 */
export function parseProofText(text: string): unknown {
  JSON.parse(text); // the syntax check (throws SyntaxError)
  const s = text;
  let i = 0;
  const NUM = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
  const STR = /"(?:[^"\\]|\\.)*"/y;
  const ws = () => {
    while (i < s.length && (s[i] === " " || s[i] === "\t" || s[i] === "\n" || s[i] === "\r")) i++;
  };
  const str = (): string => {
    STR.lastIndex = i;
    const m = STR.exec(s)!;
    i = STR.lastIndex;
    return JSON.parse(m[0]) as string;
  };
  const value = (): unknown => {
    ws();
    const c = s[i];
    if (c === "{") {
      i++;
      const o: Record<string, unknown> = {};
      ws();
      if (s[i] === "}") return i++, o;
      for (;;) {
        ws();
        const k = str();
        ws();
        i++; // :
        // defineProperty, as JSON.parse does: a "__proto__" key is a plain key.
        Object.defineProperty(o, k, { value: value(), enumerable: true, writable: true, configurable: true });
        ws();
        if (s[i++] === "}") return o;
      }
    }
    if (c === "[") {
      i++;
      const a: unknown[] = [];
      ws();
      if (s[i] === "]") return i++, a;
      for (;;) {
        a.push(value());
        ws();
        if (s[i++] === "]") return a;
      }
    }
    if (c === '"') return str();
    if (c === "t") return (i += 4), true;
    if (c === "f") return (i += 5), false;
    if (c === "n") return (i += 4), null;
    NUM.lastIndex = i;
    const m = NUM.exec(s)!;
    i = NUM.lastIndex;
    return m[1] || m[2] ? new JsonNonInteger(m[0]) : Number(m[0]);
  };
  return value();
}

async function recovers(message: string, signature: unknown, expected: string): Promise<boolean> {
  if (!isHexSig(signature)) return false;
  try {
    const who = await recoverMessageAddress({ message, signature });
    return who.toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * The spec's five rules, in order; the first failure is reported. `file` is
 * the parsed JSON exactly as fetched (unknown shape) — parse fetched text with
 * parseProofText, so a float `version` / `chain` is seen as one. Shape (rule
 * 0): `chain` a JSON integer ≥ 0, `signatures.deployers` an object (may be
 * empty). Signatures are 65-byte hex (a 64-byte EIP-2098 compact one fails
 * its rule: 3 for the builder, 5 for a deployer).
 */
export async function validateProof(
  file: unknown,
  ctx: { expectedSource: string; onchainOwner: string; chainId: number },
): Promise<ProofResult> {
  const bad = (rule: 0 | 1 | 2 | 3 | 4 | 5, reason: string): ProofResult => ({ valid: false, rule, reason });

  // Shape (rule 0): the fields exist with the right JSON types.
  if (!isObj(file) || !isObj(file.claim) || !isObj(file.signatures)) return bad(0, "not a registrai.json v1 file");
  const c = file.claim;
  const sigs = file.signatures;
  if (
    typeof c.builder !== "string" || !isAddress(c.builder, { strict: false }) ||
    typeof c.source !== "string" ||
    !Array.isArray(c.deployers) || !c.deployers.every((d) => typeof d === "string" && isAddress(d, { strict: false })) ||
    typeof c.country !== "string" ||
    !isJsonUint(c.chain) ||
    typeof c.issued !== "string"
  ) {
    return bad(0, "claim fields are missing or have the wrong type (chain must be a JSON integer)");
  }
  // Always an object, empty when there is no other deployer to sign.
  if (!isObj(sigs.deployers)) return bad(0, "signatures.deployers must be an object");
  const claim: Claim = {
    builder: c.builder,
    source: c.source,
    deployers: c.deployers as string[],
    country: c.country,
    chain: c.chain,
    issued: c.issued,
  };

  // Rule 1. `version` is the JSON integer 1: never 1.0, "1" or true.
  if (!isJsonUint(file.version) || file.version !== 1) return bad(1, `version must be the integer 1`);
  if (!/^[A-Z]{2}$/.test(claim.country)) return bad(1, `country must be two uppercase letters`);
  if (claim.chain !== ctx.chainId) return bad(1, `claim is for chain ${claim.chain}, this deployment is chain ${ctx.chainId}`);

  // Rule 2.
  if (claim.source !== ctx.expectedSource) return bad(2, `claim names ${claim.source}, expected ${ctx.expectedSource}`);

  // Rule 3.
  const message = canonicalClaimMessage(claim);
  if (!(await recovers(message, sigs.builder, claim.builder))) {
    return bad(3, "builder signature does not recover to claim.builder");
  }

  // Rule 4.
  if (claim.builder.toLowerCase() !== ctx.onchainOwner.toLowerCase()) {
    return bad(4, `claim.builder is not the on-chain owner ${ctx.onchainOwner}`);
  }

  // Rule 5.
  if (claim.source.startsWith("github:") && claim.deployers.length > 0) {
    return bad(5, "open-source claims must list no deployers");
  }
  const deployerSigs = new Map<string, unknown>(
    Object.entries(sigs.deployers as Record<string, unknown>).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const d of claim.deployers) {
    if (d.toLowerCase() === claim.builder.toLowerCase()) continue;
    if (!(await recovers(message, deployerSigs.get(d.toLowerCase()), d))) {
      return bad(5, `deployer ${d.toLowerCase()} has not signed this claim`);
    }
  }
  return { valid: true, claim };
}

// ───────────────────────────── status ─────────────────────────────

/** A project: its proof checks out (verified), does not (lapsed), or the
 *  project was removed / its builder deactivated (inactive: never checked). */
export type ProjectStatus = "verified" | "lapsed" | "inactive";

export function projectStatus(p: { builderActive: boolean; active: boolean; proofValid: boolean }): ProjectStatus {
  if (!p.builderActive || !p.active) return "inactive";
  return p.proofValid ? "verified" : "lapsed";
}

export type BuilderStatus = "verified" | "pending" | "lapsed" | "unverified" | "inactive";

/**
 * Spec 2026-09-24-builder-projects-design.md "Status" (the keeper applies the same rules):
 *   inactive    the builder is deactivated on chain
 *   verified    ≥1 verified project and CaretakerRegistry.isCaretaker(id, operator)
 *   pending     ≥1 verified project, caretaker not (yet) ours — "nominated"
 *   lapsed      has active projects, none verified
 *   unverified  no active project
 */
export function builderStatus(b: {
  active: boolean;
  projects: readonly { status: ProjectStatus }[];
  caretakerIsOperator: boolean;
}): BuilderStatus {
  if (!b.active) return "inactive";
  if (b.projects.some((p) => p.status === "verified")) return b.caretakerIsOperator ? "verified" : "pending";
  if (b.projects.some((p) => p.status === "lapsed")) return "lapsed";
  return "unverified";
}

/**
 * A builder's country: from the claims of its VERIFIED projects, in project
 * order. When they disagree the most common wins; a tie goes to the one that
 * appears first (the earliest project). null without a verified project.
 */
export function builderCountry(projects: readonly { status: string; country: string | null }[]): string | null {
  const counts = new Map<string, number>(); // insertion order = first appearance
  for (const p of projects) {
    if (p.status !== "verified" || !p.country) continue;
    counts.set(p.country, (counts.get(p.country) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [c, k] of counts) {
    if (k > n) {
      best = c;
      n = k;
    }
  }
  return best;
}

// ───────────────────────────── CREATE deployments ─────────────────────────────

/** Address of the contract `deployer` creates with CREATE at `nonce`:
 *  last 20 bytes of keccak256(rlp([deployer, nonce])). */
export function createDeployAddress(deployer: string, nonce: number | bigint): Address {
  const n = BigInt(nonce);
  if (n < 0n) throw new Error("nonce must be >= 0");
  // RLP integers are minimal big-endian bytes; zero is the empty string.
  let hex = n === 0n ? "" : n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const encoded = toRlp([deployer.toLowerCase() as Hex, `0x${hex}` as Hex]);
  return getAddress(`0x${keccak256(encoded).slice(-40)}`);
}

export type DeployCache = Record<string, { checkedNonce: number; count: number }>;

export interface DeployCountClient {
  getTransactionCount(args: { address: Address }): Promise<number>;
  getCode(args: { address: Address }): Promise<Hex | undefined>;
}

/**
 * Σ over deployers of contracts they created by direct CREATE that still hold
 * code. The cache is per deployer: `checkedNonce` is how many nonces have been
 * scanned (the next one to scan), `count` how many of those had code. Only new
 * nonces are read. Duplicate deployers count once. Returns a new cache.
 */
export async function countCreateDeployments(
  client: DeployCountClient,
  deployers: string[],
  cache: DeployCache = {},
): Promise<{ total: number; cache: DeployCache }> {
  const next: DeployCache = { ...cache };
  let total = 0;
  for (const d of [...new Set(deployers.map((x) => x.toLowerCase()))]) {
    const prior = next[d] ?? { checkedNonce: 0, count: 0 };
    const nonce = await client.getTransactionCount({ address: getAddress(d) });
    let { checkedNonce, count } = prior;
    for (; checkedNonce < nonce; checkedNonce++) {
      const code = await client.getCode({ address: createDeployAddress(d, checkedNonce) });
      if (code && code !== "0x") count++;
    }
    next[d] = { checkedNonce, count };
    total += count;
  }
  return { total, cache: next };
}

// ───────────────────────────── milestone feeds ─────────────────────────────

export interface FeedCreatedLog {
  feedId: string;
  creator: string;
  description: string;
}

/** description -> feedId over the operator's FeedCreated events, in log order
 *  (a later feed with the same description replaces an earlier one). */
export function operatorFeeds(logs: FeedCreatedLog[], operator: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of logs) {
    if (l.creator.toLowerCase() !== operator.toLowerCase()) continue;
    out[l.description] = l.feedId;
  }
  return out;
}

/** A project's milestone feed: `registrai-milestone:<source>`, else the legacy
 *  `<owner/repo>-ships-release` feed for any of the given legacy repos. */
export function milestoneFeedFor(
  feeds: Record<string, string>,
  source: string | null,
  legacyRepos: string[] = [],
): string | null {
  if (source && feeds[MILESTONE_FEED_PREFIX + source]) return feeds[MILESTONE_FEED_PREFIX + source];
  for (const repo of legacyRepos) {
    const f = feeds[`${repo}-ships-release`];
    if (f) return f;
  }
  return null;
}

/**
 * `url` with a cache-busting query parameter. A builder's CDN may cache the
 * proof file for days; asking with a new query every time gets the origin's
 * current file, so a removed proof is noticed (the keeper does the same).
 * Query only — a request header would trigger a CORS preflight in browsers.
 */
export function freshProofUrl(url: string, now: number = Date.now()): string {
  return `${url}${url.includes("?") ? "&" : "?"}registrai=${now}`;
}

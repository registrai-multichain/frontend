/** Static, sourced facts about the Arc chain for /arc/ (spec 2026-10-23-ai-search-gaps-design.md §1). Every sentence states what its source says. */
import raw from "../data/arc-chain-facts.json";

export type ChainFact = { id: string; text: string; source: string; date: string };
export type StableToken = { symbol: string; name: string; issuer: string; address: string | null; decimals: number; source: string };
export type ChainFacts = { reviewed: string; facts: ChainFact[];
  network: { rpc_url: string; rpc_source: string; explorer_url: string; explorer_source: string }; stablecoins: StableToken[] };

const DAY = /^\d{4}-\d{2}-\d{2}$/, ADDR = /^0x[0-9a-f]{40}$/;
const https = (u: unknown) => { if (typeof u !== "string") return false; try { const x = new URL(u); return x.protocol === "https:" && !x.username; } catch { return false; } };
const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function validateChainFacts(x: unknown): { ok: true; facts: ChainFacts } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const f = (x ?? {}) as Partial<ChainFacts>;
  if (typeof f.reviewed !== "string" || !DAY.test(f.reviewed)) errors.push("reviewed must be YYYY-MM-DD");
  if (!Array.isArray(f.facts) || !f.facts.length) errors.push("facts are required");
  const ids = new Set<string>();
  for (const [i, c] of (Array.isArray(f.facts) ? f.facts : []).entries()) {
    const e = (m: string) => errors.push(`fact #${i} ${c?.id ?? "?"}: ${m}`);
    if (!str(c?.id)) e("id is required"); else if (ids.has(c.id)) e("duplicate id"); else ids.add(c.id);
    if (!str(c?.text) || c.text.length > 200) e("text must be 1-200 characters");
    if (!https(c?.source)) e("source must be an https URL");
    if (typeof c?.date !== "string" || !DAY.test(c.date)) e("date must be YYYY-MM-DD");
  }
  const n = f.network;
  if (!n || !https(n.rpc_url) || !https(n.rpc_source) || !https(n.explorer_url) || !https(n.explorer_source)) errors.push("network: rpc_url, rpc_source, explorer_url, explorer_source must be https URLs");
  const syms = new Set<string>();
  for (const [i, t] of (Array.isArray(f.stablecoins) ? f.stablecoins : []).entries()) {
    const e = (m: string) => errors.push(`stablecoin #${i} ${t?.symbol ?? "?"}: ${m}`);
    if (!str(t?.symbol)) e("symbol is required"); else if (syms.has(t.symbol)) e("duplicate symbol"); else syms.add(t.symbol);
    if (!str(t?.name) || !str(t?.issuer)) e("name and issuer are required");
    if (t?.address !== null && (typeof t?.address !== "string" || !ADDR.test(t.address))) e("address must be null or 0x + 40 lower-case hex");
    if (!Number.isInteger(t?.decimals) || t.decimals < 0 || t.decimals > 36) e("decimals must be 0-36");
    if (!https(t?.source)) e("source must be an https URL");
  }
  return errors.length ? { ok: false, errors } : { ok: true, facts: f as ChainFacts };
}

const checked = validateChainFacts(raw);
if (!checked.ok) throw new Error(`arc-chain-facts.json is invalid:\n${checked.errors.join("\n")}`);
export const CHAIN_FACTS: ChainFacts = checked.facts;

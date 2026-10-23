/** Seed candidates for the ecosystem directory: the owner's tracker (read-only), the index members and DefiLlama's Arc
 * protocols, merged by name and index id. Private tracker fields (revenue, wallets, notes) are never copied. Pure. */
import { CATEGORIES, type CategoryId, type EntityStatus, type Source } from "./arc-ecosystem";

export const TRACKER_CATEGORY: Record<string, CategoryId> = {
  payments: "payments", fintech: "payments", "e-commerce": "payments", wallet: "wallets", "wallet/custody": "wallets",
  exchange: "exchanges", bank: "banks", "stablecoin issuer": "stablecoin-issuers", infrastructure: "infrastructure", technology: "infrastructure",
  "developer tools": "developer-tools", DEX: "dexs", "DEX aggregator": "dexs", DeFi: "dexs", lending: "lending", credit: "lending",
  trading: "trading", "trading company": "trading", "market maker": "market-makers", custody: "custody", RWA: "rwa", "capital markets": "rwa",
  insurer: "rwa", crosschain: "bridges", "AI agents": "ai-agents", AI: "ai-agents", "on/off-ramp": "ramps", validator: "validators",
  "asset manager": "asset-managers", "capital allocator": "asset-managers",
};
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));

export function slugify(name: string): string {
  const s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return CATEGORY_IDS.has(s) ? `${s}-project` : s || "project";
}
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

/** arc.io/ecosystem cards: data-check="<name>" and, inside the same card, href="/ecosystem/<slug>". Names and links only. */
export function parseArcPartners(html: string): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = [];
  const cards = html.split(/(?=data-check=")/).slice(1); // one chunk per card, so a card without a link never takes the next card's
  for (const c of cards) {
    const name = /^data-check="([^"]+)"/.exec(c)?.[1];
    const href = /href="(\/ecosystem\/[a-z0-9-]+)"/.exec(c)?.[1];
    if (name && href && !out.some((p) => p.url.endsWith(href))) out.push({ name: decode(name).trim(), url: `https://www.arc.io${href}` });
  }
  return out;
}

export type TrackerItem = { company: string; category?: string; status?: string; member?: string; first_seen_live?: string;
  announcements?: { date?: string; source?: string }[]; live_evidence?: string[];
  arc_contracts?: { address: string; role?: string; evidence?: string }[]; [private_: string]: unknown };
export type MemberItem = { id: string; name: string; kind: string; first_hour: string };
export type LlamaItem = { name: string; slug: string; url?: string; category?: string; chains: string[] };
export type Candidate = { slug: string; name: string; category: CategoryId | null; tracker_category?: string; status: EntityStatus;
  origins: ("tracker" | "index" | "defillama" | "arcio")[]; arcio_url?: string; index_ids: string[]; website?: string; announcements: Source[]; live_evidence: string[];
  contracts: { address: string; role: string; source: string }[]; first_announced?: string; first_live?: string;
  defillama?: { slug: string; url?: string; category?: string } };

const httpsUrl = (u?: string) => { try { const x = new URL(u ?? ""); return x.protocol === "https:" ? x.toString() : undefined; } catch { return undefined; } };

export function mergeCandidates(input: { tracker: TrackerItem[]; members: MemberItem[]; llama: LlamaItem[]; arcio?: { name: string; url: string }[] }): Candidate[] {
  const out = new Map<string, Candidate>(), byMember = new Map<string, Candidate>();
  const add = (name: string): Candidate => {
    const k = key(name);
    let c = out.get(k);
    if (!c) { c = { slug: slugify(name), name, category: null, status: "announced", origins: [], index_ids: [], announcements: [], live_evidence: [], contracts: [] }; out.set(k, c); }
    return c;
  };
  const rank: Record<EntityStatus, number> = { announced: 0, deployed: 1, live: 2 };
  const raise = (c: Candidate, s: EntityStatus) => { if (rank[s] > rank[c.status]) c.status = s; };
  for (const t of input.tracker) {
    const c = add(t.company);
    c.origins.push("tracker");
    c.tracker_category = t.category;
    c.category = (t.category && TRACKER_CATEGORY[t.category]) || null;
    raise(c, t.status === "live" ? "live" : t.status === "deployed" ? "deployed" : "announced");
    c.announcements = (t.announcements ?? []).filter((a) => httpsUrl(a.source)).map((a) => ({ url: a.source!, date: a.date }));
    c.first_announced = c.announcements.map((a) => a.date).filter(Boolean).sort()[0];
    if (t.first_seen_live) c.first_live = t.first_seen_live;
    c.live_evidence = [...(t.live_evidence ?? [])];
    c.contracts = (t.arc_contracts ?? []).filter((x) => /^0x[0-9a-fA-F]{40}$/.test(x.address) && httpsUrl(x.evidence))
      .map((x) => ({ address: x.address.toLowerCase(), role: x.role ?? "", source: x.evidence! }));
    if (t.member) { c.index_ids.push(t.member); byMember.set(t.member, c); }
  }
  for (const m of input.members) {
    const c = byMember.get(m.id) ?? add(m.name);
    if (!c.origins.includes("index")) c.origins.push("index");
    if (!c.index_ids.includes(m.id)) c.index_ids.push(m.id);
    raise(c, "live");
    if (!c.website && m.id.startsWith("domain:")) c.website = `https://${m.id.slice(7)}/`;
  }
  for (const l of input.llama) {
    if (!l.chains.includes("Arc")) continue;
    const c = out.get(key(l.name)) ?? out.get(key(l.name.replace(/\s+v\d+$/i, ""))) ?? add(l.name);
    if (!c.origins.includes("defillama")) c.origins.push("defillama");
    c.defillama = { slug: l.slug, url: l.url, category: l.category };
    raise(c, "deployed");
    c.website ??= httpsUrl(l.url);
  }
  for (const p of input.arcio ?? []) {
    const c = out.get(key(p.name)) ?? add(p.name);
    if (!c.origins.includes("arcio")) c.origins.push("arcio");
    c.arcio_url = p.url;
    if (!c.announcements.some((a) => a.url === p.url)) c.announcements.push({ url: p.url });
  }
  return [...out.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

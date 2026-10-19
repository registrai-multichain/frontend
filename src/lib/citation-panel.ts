/**
 * Citation panel: a fixed set of Arc questions asked to AI engines with web search on, to measure how often their
 * answers cite Registrai (roadmap: reports/Registrai LLM reference roadmap.md, "measurement"). Pure: prompts, response
 * parsing and scoring. scripts/citation-panel.ts does the API calls (keys from env only) and writes the results.
 * Answers vary run to run, so the metric is the share of runs that cite us, per engine, tracked over time.
 */

export type PanelGroup = "chain" | "ecosystem" | "data" | "entity" | "developer" | "brand";
export type PanelPrompt = { id: string; group: PanelGroup; text: string };
export type Engine = "openai" | "anthropic" | "perplexity" | "gemini";

/** Questions as a user would type them. Only the brand group names Registrai. Change wording only between baselines. */
export const PANEL_PROMPTS: PanelPrompt[] = [
  // the chain itself
  { id: "c01", group: "chain", text: "What is Arc, the blockchain by Circle?" },
  { id: "c02", group: "chain", text: "When did Arc mainnet launch?" },
  { id: "c03", group: "chain", text: "What is the gas token on Arc?" },
  { id: "c04", group: "chain", text: "How is Arc different from Ethereum and Solana for payments?" },
  { id: "c05", group: "chain", text: "Who runs the validators on the Arc blockchain?" },
  { id: "c06", group: "chain", text: "Is Arc blockchain EVM compatible?" },
  { id: "c07", group: "chain", text: "Which stablecoins are available on Arc?" },
  // the ecosystem
  { id: "e01", group: "ecosystem", text: "What apps are on Arc?" },
  { id: "e02", group: "ecosystem", text: "What are the most used apps on the Arc blockchain?" },
  { id: "e03", group: "ecosystem", text: "Which DEXs are on Arc?" },
  { id: "e04", group: "ecosystem", text: "Where can I lend or borrow on Arc?" },
  { id: "e05", group: "ecosystem", text: "Are there games on the Arc blockchain?" },
  { id: "e06", group: "ecosystem", text: "Which wallets support Arc?" },
  { id: "e07", group: "ecosystem", text: "How do I bridge USDC to Arc?" },
  { id: "e08", group: "ecosystem", text: "Which payment apps use Arc?" },
  { id: "e09", group: "ecosystem", text: "What new projects launched on Arc this month?" },
  { id: "e10", group: "ecosystem", text: "Which companies are building on Arc?" },
  { id: "e11", group: "ecosystem", text: "Is there an Arc ecosystem directory or list of dapps?" },
  { id: "e12", group: "ecosystem", text: "Which apps accept USDC on Arc?" },
  // numbers
  { id: "d01", group: "data", text: "What is the TVL on Arc?" },
  { id: "d02", group: "data", text: "How much USDC is on Arc?" },
  { id: "d03", group: "data", text: "How many daily transactions does Arc have?" },
  { id: "d04", group: "data", text: "How many active wallets are on Arc?" },
  { id: "d05", group: "data", text: "Which Arc app has the most stablecoin payments?" },
  { id: "d06", group: "data", text: "How much stablecoin volume do apps on Arc process per day?" },
  { id: "d07", group: "data", text: "Is there an index that tracks activity on the Arc blockchain?" },
  { id: "d08", group: "data", text: "Where can I get an API for Arc blockchain app data?" },
  // named projects on Arc
  { id: "n01", group: "entity", text: "What is Archery on Arc?" },
  { id: "n02", group: "entity", text: "Is Uniswap deployed on Arc?" },
  { id: "n03", group: "entity", text: "What is Argus on the Arc blockchain?" },
  { id: "n04", group: "entity", text: "What is Peach on Arc?" },
  { id: "n05", group: "entity", text: "What is Arclight Finance?" },
  { id: "n06", group: "entity", text: "Who controls the contracts of Tolly on Arc?" },
  { id: "n07", group: "entity", text: "What is ArcLand on Arc?" },
  { id: "n08", group: "entity", text: "Is Curve on Arc?" },
  // builders
  { id: "v01", group: "developer", text: "How do I deploy a smart contract on Arc?" },
  { id: "v02", group: "developer", text: "What is the Arc mainnet chain ID and RPC URL?" },
  { id: "v03", group: "developer", text: "What block explorer does Arc use?" },
  { id: "v04", group: "developer", text: "How do I accept USDC payments in my app on Arc?" },
  { id: "v05", group: "developer", text: "Is there an MCP server for Arc blockchain data?" },
  { id: "v06", group: "developer", text: "How can an AI agent pay for an API with USDC on Arc using x402?" },
  // the brand
  { id: "b01", group: "brand", text: "What is Registrai?" },
  { id: "b02", group: "brand", text: "What is the Arc Builders Index by Registrai?" },
  { id: "b03", group: "brand", text: "Is Registrai's Arc data reliable?" },
  { id: "b04", group: "brand", text: "What does the Registrai Data API offer?" },
];

export type Parsed = { text: string; urls: string[]; searched: string[] };
type J = Record<string, unknown>;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as J[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const uniq = (l: string[]) => [...new Set(l.filter(Boolean))];

/** The answer text, the URLs it cites, and (where the API says) the URLs its search returned. */
export function parseAnswer(engine: Engine, body: unknown): Parsed {
  const b = (body && typeof body === "object" ? body : {}) as J;
  if (engine === "openai") {
    const parts = arr(b.output).filter((o) => o.type === "message").flatMap((o) => arr(o.content)).filter((c) => c.type === "output_text");
    return { text: parts.map((c) => str(c.text)).join(""), urls: uniq(parts.flatMap((c) => arr(c.annotations)).filter((a) => a.type === "url_citation").map((a) => str(a.url))), searched: [] };
  }
  if (engine === "anthropic") {
    const blocks = arr(b.content);
    const text = blocks.filter((c) => c.type === "text");
    return { text: text.map((c) => str(c.text)).join(""), urls: uniq(text.flatMap((c) => arr(c.citations)).map((c) => str(c.url))),
      searched: uniq(blocks.filter((c) => c.type === "web_search_tool_result").flatMap((c) => arr(c.content)).map((r) => str(r.url))) };
  }
  if (engine === "perplexity") {
    const msg = (arr(b.choices)[0]?.message ?? {}) as J;
    return { text: str(msg.content), urls: uniq((Array.isArray(b.citations) ? b.citations : []).map(str)), searched: uniq(arr(b.search_results).map((r) => str(r.url))) };
  }
  // gemini: grounding URIs are Google redirects; the chunk title is the source's domain
  const cand = arr(b.candidates)[0] ?? {};
  const parts = arr((cand.content as J | undefined)?.parts);
  const chunks = arr((cand.groundingMetadata as J | undefined)?.groundingChunks).map((c) => (c.web ?? {}) as J);
  const urls = chunks.map((w) => {
    const t = str(w.title).trim().toLowerCase();
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(t) ? `https://${t}/` : str(w.uri);
  });
  return { text: parts.map((p) => str(p.text)).join(""), urls: uniq(urls), searched: [] };
}

export function domainOf(u: string): string | null {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}
const isRegistrai = (d: string) => d === "registrai.cc" || d.endsWith(".registrai.cc");

export function scoreRecord(p: Parsed) {
  const cited_domains = uniq(p.urls.map(domainOf).filter((d): d is string => d !== null));
  return { registrai_cited: cited_domains.some(isRegistrai), registrai_mentioned: /registrai/i.test(p.text), cited_domains };
}

export type PanelRecord = { engine: string; model: string; prompt_id: string; group: PanelGroup; run: number; at: string; answer: string;
  urls: string[]; searched: string[]; cited_domains: string[]; registrai_cited: boolean; registrai_mentioned: boolean; error?: string };

const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);

export function summarize(records: PanelRecord[]) {
  const engines: Record<string, { runs: number; errors: number; cited_pct: number; mentioned_pct: number; by_group: Record<string, { runs: number; cited_pct: number }> }> = {};
  for (const e of uniq(records.map((r) => r.engine))) {
    const all = records.filter((r) => r.engine === e), ok = all.filter((r) => !r.error);
    const by_group: Record<string, { runs: number; cited_pct: number }> = {};
    for (const g of uniq(ok.map((r) => r.group))) {
      const gr = ok.filter((r) => r.group === g);
      by_group[g] = { runs: gr.length, cited_pct: pct(gr.filter((r) => r.registrai_cited).length, gr.length) };
    }
    engines[e] = { runs: ok.length, errors: all.length - ok.length, cited_pct: pct(ok.filter((r) => r.registrai_cited).length, ok.length),
      mentioned_pct: pct(ok.filter((r) => r.registrai_mentioned).length, ok.length), by_group };
  }
  const count = new Map<string, number>();
  for (const r of records) if (!r.error) for (const d of r.cited_domains) count.set(d, (count.get(d) ?? 0) + 1);
  const top_domains = [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 25).map(([domain, answers]) => ({ domain, answers }));
  return { engines, top_domains };
}

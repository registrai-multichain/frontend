/**
 * Citation panel run (src/lib/citation-panel.ts): asks every panel question to each AI engine with web search on and
 * records which sites the answers cite. API keys come ONLY from the environment and are never printed; an engine
 * without a key is skipped.
 *
 *   OPENAI_API_KEY=… ANTHROPIC_API_KEY=… PERPLEXITY_API_KEY=… GEMINI_API_KEY=… npx tsx scripts/citation-panel.ts
 *   options: --runs 3 (repeat each question) --engines openai,anthropic --limit 5 (first N questions) --out docs/citation-panel
 *   models: OPENAI_MODEL, ANTHROPIC_MODEL, PERPLEXITY_MODEL, GEMINI_MODEL override the defaults below.
 *
 * Writes <out>/<date>-runs.jsonl (one line per answer) and <out>/<date>-summary.md.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PANEL_PROMPTS, parseAnswer, scoreRecord, summarize, type Engine, type PanelRecord } from "../src/lib/citation-panel";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const env = (k: string) => (process.env[k] ?? "").trim();

type Call = { model: string; request: (q: string) => Promise<unknown> };
const post = async (url: string, headers: Record<string, string>, body: unknown) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as unknown;
};

const ENGINES: Record<Engine, () => Call | null> = {
  openai: () => {
    const key = env("OPENAI_API_KEY"), model = env("OPENAI_MODEL") || "gpt-5";
    return key ? { model, request: (q) => post("https://api.openai.com/v1/responses", { authorization: `Bearer ${key}` }, { model, input: q, tools: [{ type: "web_search" }] }) } : null;
  },
  anthropic: () => {
    const key = env("ANTHROPIC_API_KEY"), model = env("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
    return key ? { model, request: (q) => post("https://api.anthropic.com/v1/messages", { "x-api-key": key, "anthropic-version": "2023-06-01" },
      { model, max_tokens: 2048, messages: [{ role: "user", content: q }], tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }] }) } : null;
  },
  perplexity: () => {
    const key = env("PERPLEXITY_API_KEY"), model = env("PERPLEXITY_MODEL") || "sonar";
    return key ? { model, request: (q) => post("https://api.perplexity.ai/chat/completions", { authorization: `Bearer ${key}` }, { model, messages: [{ role: "user", content: q }] }) } : null;
  },
  gemini: () => {
    const key = env("GEMINI_API_KEY"), model = env("GEMINI_MODEL") || "gemini-2.5-flash";
    return key ? { model, request: (q) => post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { "x-goog-api-key": key },
      { contents: [{ role: "user", parts: [{ text: q }] }], tools: [{ google_search: {} }] }) } : null;
  },
};

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (err) {
    if (!/HTTP (429|5\d\d)|timeout|aborted/i.test(String(err))) throw err;
    await new Promise((r) => setTimeout(r, 8000));
    return fn();
  }
}

async function main() {
  const runs = Number(arg("runs", "1")), limit = Number(arg("limit", String(PANEL_PROMPTS.length)));
  const wanted = (arg("engines", "openai,anthropic,perplexity,gemini") ?? "").split(",") as Engine[];
  const out = resolve(arg("out", "docs/citation-panel")!);
  mkdirSync(out, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const jsonl = resolve(out, `${day}-runs.jsonl`);
  const prompts = PANEL_PROMPTS.slice(0, limit);

  const active = wanted.map((e) => [e, ENGINES[e]?.()] as const).filter((x): x is readonly [Engine, Call] => !!x[1]);
  const skipped = wanted.filter((e) => !active.some(([a]) => a === e));
  if (!active.length) { console.error("No engine has a key. Set at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY."); process.exit(1); }
  console.log(`engines: ${active.map(([e, c]) => `${e} (${c.model})`).join(", ")}${skipped.length ? `; skipped (no key): ${skipped.join(", ")}` : ""}`);
  console.log(`${prompts.length} questions × ${runs} run(s) → ${jsonl}`);

  const records: PanelRecord[] = [];
  // engines in parallel; each engine asks its questions one at a time (rate limits)
  await Promise.all(active.map(async ([engine, call]) => {
    for (let run = 1; run <= runs; run++) for (const p of prompts) {
      const base = { engine, model: call.model, prompt_id: p.id, group: p.group, run, at: new Date().toISOString() };
      let rec: PanelRecord;
      try {
        const parsed = parseAnswer(engine, await withRetry(() => call.request(p.text)));
        rec = { ...base, answer: parsed.text.slice(0, 4000), urls: parsed.urls, searched: parsed.searched, ...scoreRecord(parsed) };
      } catch (err) {
        rec = { ...base, answer: "", urls: [], searched: [], cited_domains: [], registrai_cited: false, registrai_mentioned: false, error: String(err instanceof Error ? err.message : err).slice(0, 300) };
      }
      records.push(rec);
      appendFileSync(jsonl, `${JSON.stringify(rec)}\n`);
      console.log(`${engine} ${p.id} r${run}: ${rec.error ? `error ${rec.error.slice(0, 80)}` : `${rec.cited_domains.length} sources${rec.registrai_cited ? " · cites Registrai" : ""}`}`);
    }
  }));

  const s = summarize(records);
  const lines = [`# Citation panel ${day}`, "", `${prompts.length} questions × ${runs} run(s). Cited = a registrai.cc URL among the answer's sources. Mentioned = the name in the answer text.`, "",
    "| Engine | Model | Answers | Errors | Cited | Mentioned |", "|---|---|---|---|---|---|",
    ...active.map(([e, c]) => { const x = s.engines[e]; return `| ${e} | ${c.model} | ${x?.runs ?? 0} | ${x?.errors ?? 0} | ${x?.cited_pct ?? 0}% | ${x?.mentioned_pct ?? 0}% |`; }),
    "", "## Cited by question group", "", `| Group | ${active.map(([e]) => e).join(" | ")} |`, `|---|${active.map(() => "---").join("|")}|`,
    ...["chain", "ecosystem", "data", "entity", "developer", "brand"].map((g) => `| ${g} | ${active.map(([e]) => { const x = s.engines[e]?.by_group[g]; return x ? `${x.cited_pct}% (${x.runs})` : "–"; }).join(" | ")} |`),
    "", "## Most cited sites", "", "| Site | Answers citing it |", "|---|---|", ...s.top_domains.map((d) => `| ${d.domain} | ${d.answers} |`),
    "", "## Per question: engines that cited Registrai", "",
    ...prompts.map((p) => { const by = active.map(([e]) => e).filter((e) => records.some((r) => r.engine === e && r.prompt_id === p.id && r.registrai_cited)); return `- ${p.id} ${p.text} — ${by.length ? by.join(", ") : "none"}`; }), ""];
  writeFileSync(resolve(out, `${day}-summary.md`), lines.join("\n"));
  console.log(`\nsummary: ${resolve(out, `${day}-summary.md`)}`);
  for (const [e] of active) console.log(`${e}: cited in ${s.engines[e]?.cited_pct ?? 0}% of ${s.engines[e]?.runs ?? 0} answers`);
}

main().catch((err) => { console.error("panel failed:", err instanceof Error ? err.message : err); process.exit(1); });

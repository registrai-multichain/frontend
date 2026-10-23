import { describe, expect, test } from "vitest";
import { PANEL_PROMPTS, domainOf, parseAnswer, scoreRecord, summarize, type PanelRecord } from "./citation-panel";

describe("citation panel: prompts", () => {
  test("ids are unique, every group is covered, and only brand prompts name Registrai", () => {
    expect(new Set(PANEL_PROMPTS.map((p) => p.id)).size).toBe(PANEL_PROMPTS.length);
    expect(new Set(PANEL_PROMPTS.map((p) => p.group))).toEqual(new Set(["chain", "ecosystem", "data", "entity", "developer", "brand"]));
    expect(PANEL_PROMPTS.length).toBeGreaterThanOrEqual(40);
    for (const p of PANEL_PROMPTS) if (p.group !== "brand") expect(p.text, p.id).not.toMatch(/registrai/i);
  });
});

describe("citation panel: parsing each engine's answer", () => {
  test("OpenAI Responses: output_text with url_citation annotations", () => {
    const r = parseAnswer("openai", { output: [{ type: "web_search_call" }, { type: "message", content: [{ type: "output_text", text: "Arc is…", annotations: [
      { type: "url_citation", url: "https://builder.registrai.cc/apps/?utm_source=openai" }, { type: "url_citation", url: "https://docs.arc.io/" }] }] }] });
    expect(r.text).toBe("Arc is…");
    expect(r.urls).toEqual(["https://builder.registrai.cc/apps/?utm_source=openai", "https://docs.arc.io/"]);
  });
  test("Anthropic Messages: text citations and web search results", () => {
    const r = parseAnswer("anthropic", { content: [
      { type: "server_tool_use" }, { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://defillama.com/chain/arc" }] },
      { type: "text", text: "There are ", citations: [{ url: "https://www.arc.io/ecosystem" }] }, { type: "text", text: "many apps." }] });
    expect(r.text).toBe("There are many apps.");
    expect(r.urls).toEqual(["https://www.arc.io/ecosystem"]);
    expect(r.searched).toEqual(["https://defillama.com/chain/arc"]);
  });
  test("Perplexity: citations and search_results", () => {
    const r = parseAnswer("perplexity", { choices: [{ message: { content: "Answer [1]" } }], citations: ["https://registrai.cc/"], search_results: [{ url: "https://registrai.cc/" }, { url: "https://x.com/arc" }] });
    expect(r.urls).toEqual(["https://registrai.cc/"]);
    expect(r.searched).toEqual(["https://registrai.cc/", "https://x.com/arc"]);
  });
  test("Gemini: grounding chunks carry a redirect URI; the title is the domain", () => {
    const r = parseAnswer("gemini", { candidates: [{ content: { parts: [{ text: "Arc " }, { text: "launched." }] }, groundingMetadata: { groundingChunks: [
      { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "builder.registrai.cc" } }] } }] });
    expect(r.text).toBe("Arc launched.");
    expect(r.urls).toEqual(["https://builder.registrai.cc/"]);
  });
  test("an unexpected shape gives empty results, not a throw", () => {
    expect(parseAnswer("openai", { nope: 1 })).toEqual({ text: "", urls: [], searched: [], queries: [] });
  });
});

describe("citation panel: scoring", () => {
  test("domainOf strips www and handles junk", () => {
    expect(domainOf("https://www.arc.io/x")).toBe("arc.io");
    expect(domainOf("not a url")).toBeNull();
  });
  test("cited = a Registrai URL among the answer's citations; mentioned = the name in the text", () => {
    expect(scoreRecord({ text: "See Registrai's index.", urls: ["https://builder.registrai.cc/apps/"], searched: [], queries: [] })).toEqual({ registrai_cited: true, registrai_retrieved: false, registrai_mentioned: true, registrai_recommended: true, cited_domains: ["builder.registrai.cc"] });
    expect(scoreRecord({ text: "Arc is a chain.", urls: ["https://notregistrai.cc.evil.com/"], searched: ["https://registrai.cc/"], queries: [] }).registrai_cited).toBe(false);
  });
  test("summary: per-engine rates over successful runs, by group, and the most cited domains", () => {
    const rec = (engine: string, id: string, cited: boolean, domains: string[], error?: string): PanelRecord =>
      ({ engine, model: "m", prompt_id: id, group: id.startsWith("b") ? "brand" : "chain", run: 1, at: "t", answer: "", urls: [], searched: [], cited_domains: domains, registrai_cited: cited, registrai_mentioned: cited, ...(error ? { error } : {}) });
    const s = summarize([rec("openai", "c1", true, ["registrai.cc", "arc.io"]), rec("openai", "c2", false, ["arc.io"]), rec("openai", "c3", false, [], "429"), rec("gemini", "b1", false, ["arc.io"])]);
    expect(s.engines.openai).toMatchObject({ runs: 2, errors: 1, cited_pct: 50, mentioned_pct: 50 });
    expect(s.engines.openai.by_group.chain).toEqual({ runs: 2, cited_pct: 50 });
    expect(s.top_domains[0]).toEqual({ domain: "arc.io", answers: 3 });
  });
});

describe("citation panel: audit gaps (2026-10-23)", () => {
  test("parseAnswer records the search queries each engine ran underneath the prompt", async () => {
    const { parseAnswer } = await import("./citation-panel");
    expect(parseAnswer("openai", { output: [{ type: "web_search_call", action: { type: "search", query: "arc blockchain apps" } }, { type: "web_search_call", action: { type: "search", queries: ["arc dapps list", "arc blockchain apps"] } }] }).queries)
      .toEqual(["arc blockchain apps", "arc dapps list"]);
    expect(parseAnswer("anthropic", { content: [{ type: "server_tool_use", name: "web_search", input: { query: "Arc ecosystem directory" } }, { type: "text", text: "x" }] }).queries).toEqual(["Arc ecosystem directory"]);
    expect(parseAnswer("gemini", { candidates: [{ groundingMetadata: { webSearchQueries: ["usdc on arc"] } }] }).queries).toEqual(["usdc on arc"]);
    expect(parseAnswer("perplexity", {}).queries).toEqual([]);
  });
  test("mentioned excludes the Lithuanian word; recommended = Registrai or its domain offered as a source to use", async () => {
    const { scoreRecord } = await import("./citation-panel");
    const s = (text: string) => scoreRecord({ text, urls: [], searched: [], queries: [] });
    expect(s("\"Registrai\" is the Lithuanian word for registers.")).toMatchObject({ registrai_mentioned: false, registrai_recommended: false });
    expect(s("Registrai is a company. Arc has apps.")).toMatchObject({ registrai_mentioned: true, registrai_recommended: false });
    expect(s("For a full list, see Registrai's Arc ecosystem directory.")).toMatchObject({ registrai_mentioned: true, registrai_recommended: true });
    expect(s("According to Registrai, Arc has 258 projects.")).toMatchObject({ registrai_recommended: true });
    expect(s("Data: builder.registrai.cc/arc/")).toMatchObject({ registrai_mentioned: true, registrai_recommended: true });
  });
  test("topic gaps: per group, Registrai's cited/mentioned/recommended share against the domains that win the topic", async () => {
    const { topicGaps } = await import("./citation-panel");
    const r = (group: "chain" | "ecosystem", domains: string[], cited = false, mentioned = false, recommended = false, error?: string): PanelRecord =>
      ({ engine: "openai", model: "m", prompt_id: "x", group, run: 1, at: "t", answer: "", urls: [], searched: [], cited_domains: domains, registrai_cited: cited, registrai_mentioned: mentioned, registrai_recommended: recommended, ...(error ? { error } : {}) });
    const g = topicGaps([r("ecosystem", ["arc.io", "kucoin.com"]), r("ecosystem", ["arc.io", "builder.registrai.cc"], true, true, true), r("ecosystem", ["arc.io"]), r("ecosystem", [], false, false, false, "429"), r("chain", ["circle.com"])]);
    const eco = g.find((x) => x.group === "ecosystem")!;
    expect(eco).toMatchObject({ answers: 3, cited_pct: 33.3, mentioned_pct: 33.3, recommended_pct: 33.3 });
    expect(eco.leaders[0]).toEqual({ domain: "arc.io", pct: 100 });
    expect(eco.leaders.map((l) => l.domain)).not.toContain("builder.registrai.cc");
    expect(eco.gap).toBe(66.7);   // the leader's share minus Registrai's cited share
  });
  test("winning pages: per group, the cited URLs normalized (no query, hash, www or trailing slash) and counted once per answer", async () => {
    const { winningPages } = await import("./citation-panel");
    const r = (urls: string[]): PanelRecord => ({ engine: "openai", model: "m", prompt_id: "x", group: "ecosystem", run: 1, at: "t", answer: "", urls, searched: [], cited_domains: [], registrai_cited: false, registrai_mentioned: false });
    const w = winningPages([r(["https://www.arc.io/ecosystem?utm_source=openai", "https://arc.io/ecosystem/#apps"]), r(["https://arc.io/ecosystem/"]), r(["https://kucoin.com/a"])]);
    expect(w.ecosystem[0]).toEqual({ url: "https://arc.io/ecosystem", answers: 2 });
    expect(w.ecosystem).toHaveLength(2);
  });
  test("renderSummary has the topic gap, winning pages and search query sections, and old runs without queries still render", async () => {
    const { renderSummary } = await import("./citation-panel");
    const rec: PanelRecord = { engine: "anthropic", model: "m", prompt_id: "e01", group: "ecosystem", run: 1, at: "t", answer: "See Registrai.", urls: ["https://arc.io/ecosystem"], searched: [], cited_domains: ["arc.io"], registrai_cited: false, registrai_mentioned: true, registrai_recommended: true, queries: ["arc apps"] };
    const old = { ...rec, queries: undefined, registrai_recommended: undefined } as unknown as PanelRecord;
    const md = renderSummary([rec, old], "2026-10-24", { anthropic: "claude" });
    for (const h of ["## Topic gaps", "## Pages that win each topic", "## Searches underneath the prompts", "| anthropic | claude |"]) expect(md).toContain(h);
    expect(md).toContain("https://arc.io/ecosystem");
    expect(md).toContain("arc apps");
    expect(md).not.toContain("undefined");
  });
});

describe("citation panel: retrieval (Claude focus, 2026-10-23)", () => {
  test("scoreRecord: retrieved = a Registrai URL among the search results, cited or not", async () => {
    const { scoreRecord } = await import("./citation-panel");
    expect(scoreRecord({ text: "x", urls: [], searched: ["https://builder.registrai.cc/arc/"], queries: [] }).registrai_retrieved).toBe(true);
    expect(scoreRecord({ text: "x", urls: [], searched: ["https://x.io/"], queries: [] }).registrai_retrieved).toBe(false);
  });
  test("summary: per engine, retrieved share and 'retrieved but not cited'; engines that don't report search results show –", async () => {
    const { renderSummary } = await import("./citation-panel");
    const r = (engine: string, retrieved: boolean, cited: boolean, searched: string[]): PanelRecord => ({ engine, model: "m", prompt_id: "e01", group: "ecosystem", run: 1, at: "t", answer: "",
      urls: [], searched, cited_domains: [], registrai_cited: cited, registrai_mentioned: false, registrai_recommended: false, registrai_retrieved: retrieved, queries: [] });
    const md = renderSummary([r("anthropic", true, false, ["https://builder.registrai.cc/"]), r("anthropic", false, false, ["https://x.io/"]), r("openai", false, false, [])], "2026-10-24", { anthropic: "claude", openai: "gpt" });
    expect(md).toContain("| Engine | Model | Answers | Errors | In search results | Cited | Mentioned | Recommended |");
    expect(md).toMatch(/\| anthropic \| claude \| 2 \| 0 \| 50% \|/);
    expect(md).toMatch(/\| openai \| gpt \| 1 \| 0 \| – \|/);
    expect(md).toContain("Retrieved but not cited: anthropic 1");
  });
  test("re-scoring old runs recomputes retrieval from their saved search results", async () => {
    const { scoreRecord } = await import("./citation-panel");
    expect(scoreRecord({ text: "", urls: [], searched: ["https://www.registrai.cc/"], queries: [] }).registrai_retrieved).toBe(true);
  });
});

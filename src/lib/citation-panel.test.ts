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
    expect(parseAnswer("openai", { nope: 1 })).toEqual({ text: "", urls: [], searched: [] });
  });
});

describe("citation panel: scoring", () => {
  test("domainOf strips www and handles junk", () => {
    expect(domainOf("https://www.arc.io/x")).toBe("arc.io");
    expect(domainOf("not a url")).toBeNull();
  });
  test("cited = a Registrai URL among the answer's citations; mentioned = the name in the text", () => {
    expect(scoreRecord({ text: "See Registrai's index.", urls: ["https://builder.registrai.cc/apps/"], searched: [] })).toEqual({ registrai_cited: true, registrai_mentioned: true, cited_domains: ["builder.registrai.cc"] });
    expect(scoreRecord({ text: "Arc is a chain.", urls: ["https://notregistrai.cc.evil.com/"], searched: ["https://registrai.cc/"] }).registrai_cited).toBe(false);
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

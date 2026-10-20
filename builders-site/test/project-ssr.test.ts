import { describe, expect, test } from "vitest";
import { renderProjectSummary, setHead } from "../lib/project-ssr";
import { MemoryKV } from "./memory-kv";

const STATIC = `<!DOCTYPE html><html><head><title>Project facts · Registrai</title><meta name="description" content="What is on chain, who controls it and how it is used: neutral facts with evidence."/><link rel="canonical" href="https://builder.registrai.cc/project/"/><meta property="og:title" content="Registrai · landing"/><meta property="og:url" content="https://registrai.cc/"/><meta name="twitter:title" content="Registrai · landing"/></head><body class="b"><p>Loading…</p></body></html>`;
const fact = { id: "f1", topic: "control", text: "The owner is a 2-of-3 Safe <x>", evidence: ["0x29316db42ff99f640fd4d1bb169635b6318cd430"], observedAt: "2026-10-01T00:00:00Z" };
const ready = { kind: "ready", profile: { name: "MyArcade", website: "https://www.myarcade.fun", x: "myarcade", deployers: [], contracts: [{ label: "Game", address: "0x29316db42ff99f640fd4d1bb169635b6318cd430" }] },
  facts: { source: "domain:www.myarcade.fun", summary: "Arcade games paid in USDC.", facts: [fact], changelog: [], lastReviewedAt: "2026-10-02T00:00:00Z", reviewedBy: "Registrai" } } as never;

describe("project facts pages, server-rendered", () => {
  test("summary: name as H1, website, summary, facts with evidence links, last reviewed; values escaped", () => {
    const h = renderProjectSummary("domain:www.myarcade.fun", ready);
    expect(h).toContain("<h1>MyArcade</h1>");
    expect(h).toContain('href="https://www.myarcade.fun/"');
    expect(h).toContain("Arcade games paid in USDC.");
    expect(h).toContain("<h2>Who controls it</h2>");
    expect(h).toContain("The owner is a 2-of-3 Safe &lt;x&gt;");
    expect(h).toMatch(/href="https:\/\/[^"]+\/address\/0x29316db42ff99f640fd4d1bb169635b6318cd430"/);
    expect(h).toContain("Last reviewed 2026-10-02 by Registrai");
    expect(h).toContain("Game:");
  });

  test("head: own title, description, canonical and share tags", () => {
    const out = setHead(STATIC, { title: "MyArcade: facts · Registrai", description: "On-chain facts about MyArcade on Arc, with evidence.", canonical: "https://builder.registrai.cc/project/domain/www.myarcade.fun/" });
    expect(out).toContain("<title>MyArcade: facts · Registrai</title>");
    expect(out).toContain('<link rel="canonical" href="https://builder.registrai.cc/project/domain/www.myarcade.fun/"/>');
    expect(out).toContain('<meta name="description" content="On-chain facts about MyArcade on Arc, with evidence."/>');
    expect(out).toContain('<meta property="og:url" content="https://builder.registrai.cc/project/domain/www.myarcade.fun/"/>');
    expect(out).toContain('<meta property="og:title" content="MyArcade: facts · Registrai"/>');
    expect(out).toContain('<meta name="twitter:title" content="MyArcade: facts · Registrai"/>');
    expect(setHead(STATIC, { title: 'a"<b', description: "d", canonical: "c" })).toContain("<title>a&quot;&lt;b</title>");
  });

  describe("route", () => {
    const kv = new MemoryKV();
    const ctx = (path: string, params: string[]) => ({ request: new Request(`https://builder.registrai.cc${path}`), env: { INVITES: kv, ASSETS: { fetch: async () => new Response(STATIC, { headers: { "content-type": "text/html" } }) } },
      params: { path: params }, waitUntil: () => undefined, next: async () => new Response(STATIC, { headers: { "content-type": "text/html" } }) }) as never;

    test("/project/?source=… 301s to the path URL; bare /project/ is the static page", async () => {
      const { onRequest } = await import("../functions/project/[[path]]");
      const r = await onRequest(ctx("/project/?source=domain%3Awww.myarcade.fun", []));
      expect(r.status).toBe(301);
      expect(r.headers.get("location")).toBe("https://builder.registrai.cc/project/domain/www.myarcade.fun/");
      expect(await (await onRequest(ctx("/project/", []))).text()).toBe(STATIC);
    });

    test("a project with public facts: 200 with its own head and the facts in HTML; unknown: 404 noindex; bad path: 404", async () => {
      const { onRequest } = await import("../functions/project/[[path]]");
      await kv.put("facts:domain:www.myarcade.fun", JSON.stringify({ source: "domain:www.myarcade.fun", summary: "Arcade games paid in USDC.", facts: [fact], changelog: [], lastReviewedAt: "2026-10-02T00:00:00Z", reviewedBy: "x", rev: 1 }));
      const r = await onRequest(ctx("/project/domain/www.myarcade.fun/", ["domain", "www.myarcade.fun"]));
      expect(r.status).toBe(200);
      const h = await r.text();
      expect(h).toContain('<link rel="canonical" href="https://builder.registrai.cc/project/domain/www.myarcade.fun/"/>');
      expect(h).toContain("The owner is a 2-of-3 Safe &lt;x&gt;");
      const none = await onRequest(ctx("/project/domain/nobody.example/", ["domain", "nobody.example"]));
      expect(none.status).toBe(404);
      expect(await none.text()).toContain('<meta name="robots" content="noindex"/>');
      expect((await onRequest(ctx("/project/domain/UPPER.example/", ["domain", "UPPER.example"]))).status).toBe(404);
    });
  });
});

describe("review fixes", () => {
  // the Next page no longer declares a canonical (React re-added it on hydration): setHead inserts one
  const NEXT = `<html><head><title>Project facts · Registrai</title><meta name="description" content="generic"/></head><body><div hidden></div></body></html>`;
  test("setHead inserts canonical and og:url when absent, and a name with $& stays literal", () => {
    const out = setHead(NEXT, { title: "A$&B: facts · Registrai", description: "d", canonical: "https://builder.registrai.cc/project/domain/a.b/" });
    expect(out).toContain("<title>A$&amp;B: facts · Registrai</title>");
    expect(out.match(/rel="canonical"/g)).toHaveLength(1);
    expect(out).toContain('<link rel="canonical" href="https://builder.registrai.cc/project/domain/a.b/"/>');
    expect(out).toContain('<meta property="og:url" content="https://builder.registrai.cc/project/domain/a.b/"/>');
  });

  const SEC = { "content-type": "text/html", "content-security-policy": "default-src 'self'", "x-frame-options": "DENY" };
  const kv = new MemoryKV();
  const mk = (path: string, params: string[], method = "GET", env: Record<string, unknown> = {}) => ({ request: new Request(`https://builder.registrai.cc${path}`, { method }),
    env: { INVITES: kv, ASSETS: { fetch: async () => new Response(STATIC, { headers: SEC }) }, ...env }, params: { path: params }, waitUntil: () => undefined,
    next: async () => new Response("NEXT", { headers: SEC }) }) as never;

  test("project pages keep the static page's security headers", async () => {
    const { onRequest } = await import("../functions/project/[[path]]");
    await kv.put("facts:domain:www.myarcade.fun", JSON.stringify({ source: "domain:www.myarcade.fun", facts: [fact], changelog: [], lastReviewedAt: "", reviewedBy: "x", rev: 1 }));
    for (const [p, s] of [["/project/domain/www.myarcade.fun/", ["domain", "www.myarcade.fun"]], ["/project/domain/nobody.example/", ["domain", "nobody.example"]]] as const) {
      const r = await onRequest(mk(p, [...s]));
      expect(r.headers.get("content-security-policy"), p).toBe("default-src 'self'");
      expect(r.headers.get("x-frame-options"), p).toBe("DENY");
      expect(r.headers.get("content-type"), p).toContain("text/html");
    }
  });

  test("the route's own Next files (index.txt, __next.*) pass through to the static assets", async () => {
    const { onRequest } = await import("../functions/project/[[path]]");
    for (const segs of [["index.txt"], ["__next._tree.txt"], ["domain", "www.myarcade.fun", "index.txt"], ["domain", "www.myarcade.fun", "__next._tree.txt"]])
      expect(await (await onRequest(mk(`/project/${segs.join("/")}`, segs))).text(), segs.join("/")).toBe("NEXT");
  });

  test("data down: 503 with Retry-After, not a cached 200", async () => {
    const { onRequest } = await import("../functions/project/[[path]]");
    const broken = { get: async () => { throw new Error("kv down"); } };
    const r = await onRequest(mk("/project/domain/www.myarcade.fun/", ["domain", "www.myarcade.fun"], "GET", { INVITES: broken }));
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("60");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

describe("factsHtml", () => {
  test("the facts part of the summary, without the H1", async () => {
    const { factsHtml } = await import("../lib/project-ssr");
    const s = factsHtml(ready);
    expect(s).toContain("<h2>Who controls it</h2>");
    expect(s).not.toContain("<h1>");
    expect(renderProjectSummary("domain:www.myarcade.fun", ready)).toContain(s);
  });
});

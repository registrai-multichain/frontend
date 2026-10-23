import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";

const E: ArcEntity[] = [
  { slug: "aave", name: "Aave", category: "lending", status: "announced", summary: "Lending.", status_evidence: [{ url: "https://www.arc.io/x" }], sources: [{ url: "https://aave.com/" }], website: "https://aave.com", last_reviewed: "2026-10-20" },
  { slug: "pipe", name: "Pi|pe *x*", category: "dexs", status: "live", summary: "A DEX.", status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }], sources: [{ url: "https://p.example/" }], last_reviewed: "2026-10-20" },
];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() } }));
const collect = vi.fn();
vi.mock("../lib/arc-numbers", async (orig) => ({ ...(await orig<typeof import("../lib/arc-numbers")>()), collectArcNumbers: (...a: unknown[]) => collect(...a) }));

describe("/llms-full.txt", () => {
  test("header with the credit line, methodology, question pages, one escaped line per project; /arc/ failing never fails the file", async () => {
    collect.mockRejectedValue(new Error("rpc down"));
    const { buildLlmsFull } = await import("../lib/llms-full");
    const t = await buildLlmsFull({ INVITES: { get: async () => null } } as never, { cache: null }, Date.parse("2026-10-23T12:00:00Z"));
    expect(t.startsWith("# Registrai: Arc ecosystem data (full reference)\n")).toBe(true);
    expect(t).toContain("Registrai, builder.registrai.cc, CC BY 4.0");
    expect(t).toContain("Updated 2026-10-23 12:00 UTC");
    expect(t).toContain("https://github.com/registrai-multichain/arc-ecosystem");
    expect(t).toContain("# Methodology");
    expect(t).toContain("## Arc in numbers\n\nNot available right now.");
    expect(t).toContain("# How to get USDC onto Arc");
    expect(t).toContain("- **Aave** (Lending, Announced): Lending. https://aave.com — https://builder.registrai.cc/ecosystem/aave/");
    expect(t).toContain("- **Pi\\|pe \\*x\\*** (DEXs, Live on mainnet): A DEX. — https://builder.registrai.cc/ecosystem/pipe/");
    expect(t).not.toMatch(/<[a-z]/i);
  });
  test("route: text/plain, cached an hour, GET/HEAD only; llms.txt points to it and no longer claims 'started receiving payments'", async () => {
    collect.mockRejectedValue(new Error("rpc down"));
    const { onRequest } = await import("../functions/llms-full.txt");
    const ctx = (method = "GET") => ({ request: new Request("https://builder.registrai.cc/llms-full.txt", { method }), env: { INVITES: { get: async () => null } }, params: {}, waitUntil: () => undefined }) as never;
    const r = await onRequest(ctx());
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("public, max-age=600");   // review M7: a degraded build is kept 10 min, not an hour
    expect(await (await onRequest(ctx("HEAD"))).text()).toBe("");
    expect((await onRequest(ctx("POST"))).status).toBe(405);
    for (const f of [resolve(__dirname, "../../public/llms.txt"), resolve(__dirname, "../functions/llms.txt.ts")]) {
      const s = readFileSync(f, "utf8");
      expect(s, f).toContain("https://builder.registrai.cc/llms-full.txt");
      expect(s, f).not.toContain("started receiving payments");
    }
  });
  test("review I5: reuses the edge-cached /arc/ and question pages instead of recomputing them", async () => {
    collect.mockReset();
    const store = new Map<string, Response>([
      ["https://builder.registrai.cc/arc/?v=arc", new Response("<main><h1>Arc in numbers</h1><p>CACHED ARC</p></main>", { headers: { "content-type": "text/html" } })],
      ["https://builder.registrai.cc/arc/new/?v=arc-q%3Anew", new Response("<main><h1>New</h1><p>CACHED NEW</p></main>", { headers: { "content-type": "text/html" } })],
    ]);
    const cache = { match: async (k: Request) => store.get(k.url)?.clone(), put: async () => undefined } as unknown as Cache;
    const { buildLlmsFullDoc } = await import("../lib/llms-full");
    const d = await buildLlmsFullDoc({ INVITES: { get: async () => null } } as never, { cache }, Date.parse("2026-10-23T12:00:00Z"));
    expect(collect).not.toHaveBeenCalled();
    expect(d.text).toContain("CACHED ARC");
    expect(d.text).toContain("CACHED NEW");
    expect(d.text).not.toContain("## Arc in numbers\n\nNot available right now");
    expect(d.degraded).toBe(false);
  });
  test("review I5: on an /arc/ miss the aei file already read is passed on, not parsed again", async () => {
    collect.mockReset();
    collect.mockRejectedValue(new Error("rpc down"));
    const { buildLlmsFullDoc } = await import("../lib/llms-full");
    const d = await buildLlmsFullDoc({ INVITES: { get: async () => null } } as never, { cache: null }, Date.parse("2026-10-23T12:00:00Z"));
    expect(collect).toHaveBeenCalledTimes(1);
    expect(collect.mock.calls[0][3]).toHaveProperty("aei");
    expect(d.degraded).toBe(true);
  });
  test("review I3: a question page built while a source was down marks the whole file degraded", async () => {
    collect.mockReset();
    const store = new Map<string, Response>([
      ["https://builder.registrai.cc/arc/?v=arc", new Response("<main><h1>Arc in numbers</h1><p>A</p></main>")],
      ["https://builder.registrai.cc/arc/arc-vs-ethereum-vs-solana/?v=arc-q%3Aarc-vs-ethereum-vs-solana", new Response("<main><h1>Compare</h1><p>B</p></main>", { headers: { "x-registrai-degraded": "1" } })],
    ]);
    const cache = { match: async (k: Request) => store.get(k.url)?.clone(), put: async () => undefined } as unknown as Cache;
    const { buildLlmsFullDoc } = await import("../lib/llms-full");
    const d = await buildLlmsFullDoc({ INVITES: { get: async () => null } } as never, { cache }, Date.parse("2026-10-23T12:00:00Z"));
    expect(d.text).toContain("# Compare");
    expect(d.degraded).toBe(true);
  });
});


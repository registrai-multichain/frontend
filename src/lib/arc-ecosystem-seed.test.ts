import { describe, expect, test } from "vitest";
import { TRACKER_CATEGORY, mergeCandidates, slugify } from "./arc-ecosystem-seed";
import { CATEGORIES } from "./arc-ecosystem";

describe("seed", () => {
  test("slugify: ASCII kebab, accents folded, symbols dropped, category ids avoided", () => {
    expect(slugify("Société <Générale> & \"Co\"")).toBe("societe-generale-co");
    expect(slugify("OKX DEX")).toBe("okx-dex");
    expect(slugify("DEXs")).toBe("dexs-project");
  });
  test("every tracker category maps to a known category", () => {
    const ids = new Set<string>(CATEGORIES.map((c) => c.id));
    for (const [k, v] of Object.entries(TRACKER_CATEGORY)) expect(ids.has(v), k).toBe(true);
    for (const k of ["payments", "wallet", "exchange", "bank", "stablecoin issuer", "DEX", "lending", "AI agents", "crosschain", "on/off-ramp", "validator"]) expect(TRACKER_CATEGORY[k], k).toBeDefined();
  });
  test("merges a tracker entry, its index member and its DefiLlama listing into one candidate; drops private fields", () => {
    const out = mergeCandidates({
      tracker: [{ company: "Aave", category: "lending", status: "live", member: "integration:aave", first_seen_live: "2026-10-10",
        announcements: [{ date: "2025-10-28", source: "https://www.arc.io/pressroom/a" }], live_evidence: ["https://github.com/aave-dao/x — AaveV4Arc"],
        arc_contracts: [{ address: "0x17288DFC86205301064577B98B02B81017E6F79C", role: "Core Hub", evidence: "https://github.com/aave-dao/x" }],
        revenue_usd: 9, wallets: ["0xabc"], research_notes: "private" }],
      members: [{ id: "integration:aave", name: "Aave", kind: "integration", first_hour: "2026-10-11T19:00:00Z" }, { id: "domain:archery.wtf", name: "Archery", kind: "builder", first_hour: "2026-10-10T00:00:00Z" }],
      llama: [{ name: "Aave V4", slug: "aave-v4", url: "https://aave.com", category: "Lending", chains: ["Ethereum", "Arc"] }, { name: "OffArc", slug: "x", chains: ["Base"] }],
    });
    expect(out.map((c) => c.slug)).toEqual(["aave", "archery"]);
    const aave = out[0];
    expect(aave).toMatchObject({ name: "Aave", category: "lending", status: "live", index_ids: ["integration:aave"], first_announced: "2025-10-28", first_live: "2026-10-10", website: "https://aave.com/" });
    expect(aave.origins.sort()).toEqual(["defillama", "index", "tracker"]);
    expect(aave.contracts[0].address).toBe("0x17288dfc86205301064577b98b02b81017e6f79c");
    expect(JSON.stringify(aave)).not.toMatch(/revenue|wallets|private/);
    expect(out[1]).toMatchObject({ slug: "archery", status: "live", origins: ["index"], index_ids: ["domain:archery.wtf"], first_live: "2026-10-10", website: "https://archery.wtf/" });
  });
  test("DefiLlama-only Arc protocols become deployed candidates", () => {
    const [c] = mergeCandidates({ tracker: [], members: [], llama: [{ name: "Beefy", slug: "beefy", url: "https://beefy.com", category: "Yield", chains: ["Arc"] }] });
    expect(c).toMatchObject({ slug: "beefy", status: "deployed", origins: ["defillama"], category: null });
  });
});

import { parseArcPartners } from "./arc-ecosystem-seed";
describe("arc.io partners", () => {
  const html = `<div data-check="Alcove" role="listitem" class="ecosystem-item w-dyn-item"><div class="u-hide"><a aria-label="ecosystem link" href="/ecosystem/alcove" class="w-inline-block"></a></div><p>Alcove</p></div>
<div data-check="Aave" role="listitem" class="ecosystem-item w-dyn-item"><div class="u-hide"><a aria-label="ecosystem link" href="/ecosystem/aave" class="w-inline-block"></a></div></div>
<div data-check="Bad &amp; Co" role="listitem" class="ecosystem-item"><a href="https://evil.example/x">x</a></div>`;
  test("names and arc.io page URLs, entities decoded, non-arc.io links dropped", () => {
    expect(parseArcPartners(html)).toEqual([{ name: "Alcove", url: "https://www.arc.io/ecosystem/alcove" }, { name: "Aave", url: "https://www.arc.io/ecosystem/aave" }]);
  });
  test("an arc.io partner merges into the same-name candidate; a new one is announced with its arc.io page", () => {
    const out = mergeCandidates({ tracker: [{ company: "Aave", category: "lending", status: "live" }], members: [], llama: [], arcio: [{ name: "Aave", url: "https://www.arc.io/ecosystem/aave" }, { name: "Alcove", url: "https://www.arc.io/ecosystem/alcove" }] });
    expect(out.find((c) => c.slug === "aave")).toMatchObject({ status: "live", arcio_url: "https://www.arc.io/ecosystem/aave" });
    expect(out.find((c) => c.slug === "aave")!.origins).toContain("arcio");
    expect(out.find((c) => c.slug === "alcove")).toMatchObject({ status: "announced", origins: ["arcio"], announcements: [{ url: "https://www.arc.io/ecosystem/alcove" }] });
  });
});

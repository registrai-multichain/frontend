/** The project page's states and footer, rendered on the server (no fetch: the parts take their state as props). */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LoadFailed, Missing, View } from "./ProjectFactsPage";
import type { PublicProjectFacts } from "@/lib/facts";

const SRC = "domain:kairo.market";
const facts: PublicProjectFacts = {
  source: SRC,
  facts: [{ id: "f1", topic: "control", text: "One account deployed all contracts.", evidence: ["https://kairo.market/docs"], observedAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z" }],
  changelog: [],
  lastReviewedAt: "2026-09-28T00:00:00.000Z",
  reviewedBy: "Registrai",
};
const view = (f: unknown) => renderToStaticMarkup(<View source={SRC} state={{ kind: "ready", profile: null, facts: f as PublicProjectFacts }} />);

describe("project page", () => {
  test("missing: no claim the project is absent from the registry; links back to the builders", () => {
    const html = renderToStaticMarkup(<Missing />);
    expect(html).toContain("No public facts for this project yet.");
    expect(html).not.toContain("not in the registry");
    expect(html).toMatch(/href="\/builders\/?"/); // next/link drops the slash outside the build (trailingSlash)
  });
  test("a failed load says so", () => {
    const html = renderToStaticMarkup(<LoadFailed />);
    expect(html).toContain("Couldn&#x27;t load this page. Try again.");
    expect(html).not.toContain("No public facts");
  });
  test("reviewed by Registrai, never a wallet (even from an older API answer)", () => {
    expect(view(facts)).toContain("Last reviewed 2026-09-28 by Registrai");
    const old = view({ ...facts, reviewedBy: "0xb7ecf980a4732b75e57e2ec80903dee3964f2573", rev: 4 });
    expect(old).toContain("by Registrai");
    expect(old).not.toContain("0xb7ec");
    expect(view({ ...facts, lastReviewedAt: undefined })).not.toContain("Last reviewed");
  });
});

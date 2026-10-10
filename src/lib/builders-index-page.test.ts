import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { indexFixture } from "./builders-index-fixture";
import { ABI_COPY, abiState, baseTip, decayTip } from "./builders-index-page";
import { INDEX } from "./abi-live-mock";

describe("page state", () => {
  test("404 is the empty state, bad bodies are errors, a good body is ready", () => {
    expect(abiState(null).kind).toBe("loading");
    expect(abiState({ status: 404, body: { error: "no data" } }).kind).toBe("empty");
    expect(abiState({ status: 500, body: {} }).kind).toBe("error");
    expect(abiState({ status: 200, body: { nope: 1 } }).kind).toBe("error");
    expect(abiState({ status: 200, body: indexFixture() }).kind).toBe("ready");
    expect(abiState({ status: 200, body: INDEX }).kind).toBe("ready");
  });
});

describe("copy comes from the file", () => {
  test("base and roll-off tips use the file's level, date and half-life", () => {
    expect(baseTip(INDEX)).toContain("1,000");
    expect(baseTip(INDEX)).toContain("2 Oct 2026");
    expect(decayTip({ ...INDEX, params: { ...INDEX.params, half_life_days: 9 } })).toContain("every 9 days");
    expect(ABI_COPY.pace).toMatch(/Pace/);
  });
});

describe("data only: no order-entry words anywhere in the page source", () => {
  const root = resolve(__dirname, "../..");
  const walk = (dir: string): string[] =>
    readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  const isTest = (f: string) => /\.test\.(ts|tsx)$/.test(f);
  // R7: the points pilot (ticket, positions, leaderboard and its rules engine) is exempt from this ban;
  // its own copy lint is src/lib/abi-pilot-copy.test.ts.
  const isPilot = (f: string) => /\/builders-index\/pilot\//.test(f) || /\/abi-pilot[^/]*$/.test(f);
  const all = [
    ...walk("src/app/builders-index"),
    ...walk("src/components/builders-index"),
    ...walk("src/lib").filter((f) => /\/(abi-[^/]*|builders-index[^/]*)\.(ts|css)$/.test(f)),
    ...walk("builders-site/lib").filter((f) => /\/builders-index\.ts$/.test(f) || /\/bot-auth\.ts$/.test(f)),
    ...walk("builders-site/functions/api/index"),
  ].filter((f) => !isTest(f));
  const files = all.filter((f) => !isPilot(f));
  // the CSS property names `position` (sticky bar, bubbles) are layout, not a word of the copy
  const text = (f: string) => readFileSync(resolve(root, f), "utf8").replace(/\bposition\s*:/g, "pos:");
  const WORDS = /\b(trade|trades|trading|trader|traders|long|short|leverage|leveraged|perp|perps|perpetual|perpetuals|buy|buys|sell|sells|bet|bets|betting|wager|wagers|odds|position|positions|swap|swaps|futures|order|orders|wallet|connect)\b/i;
  test("the glob finds the sources, the stylesheet included", () => {
    // the exemption covers exactly the pilot's own files
    expect(all.filter(isPilot).sort()).toEqual([
      "src/components/builders-index/pilot/PilotPanel.tsx", "src/components/builders-index/pilot/PilotTables.tsx",
      "src/components/builders-index/pilot/Ticket.tsx", "src/components/builders-index/pilot/pilot.css",
      "src/lib/abi-pilot-api.ts", "src/lib/abi-pilot-copy.ts", "src/lib/abi-pilot.ts",
    ]);
    for (const f of ["src/app/builders-index/page.tsx", "src/components/builders-index/IndexPage.tsx", "src/components/builders-index/terminal.css", "src/lib/abi-live.ts", "src/lib/abi-terminal.ts", "src/lib/builders-index.ts", "builders-site/functions/api/index/seen.ts"]) expect(files).toContain(f);
  });
  test.each(files)("%s", (f) => {
    expect(text(f).match(WORDS)?.[0]).toBeUndefined();
  });
  const built = resolve(root, "dist-builders/builders-index/index.html");
  test.skipIf(!existsSync(built))("the built page (skipped: run the builders-site build to create dist-builders)", () => {
    const html = readFileSync(built, "utf8").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
    expect(html.match(WORDS)?.[0]).toBeUndefined();
  });
});

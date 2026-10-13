import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { indexFixture } from "./builders-index-fixture";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { metadata } from "@/app/builders-index/page";
import { BuildersShell } from "@/components/BuildersShell";
import { ABI_COPY, abiState, baseTip, decayTip, INDEX_FOOT_NOTE, startGate } from "./builders-index-page";
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
      "src/components/builders-index/pilot/RegiLock.tsx", "src/components/builders-index/pilot/Ticket.tsx", "src/components/builders-index/pilot/pilot.css",
      "src/lib/abi-pilot-api.ts", "src/lib/abi-pilot-copy.ts", "src/lib/abi-pilot-lock.ts", "src/lib/abi-pilot.ts",
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

describe("audit SS-3: engine restarts after a mismatched seen file back off", () => {
  test("60 s, 120 s, then 300 s (cap) between tries; a matching pair resets; a new index file always may", () => {
    const g = startGate();
    expect(g.due(0, false)).toBe(true);
    g.miss(0);
    expect(g.due(59_999, false)).toBe(false);
    expect(g.due(60_000, false)).toBe(true);
    g.miss(60_000);
    expect(g.due(179_999, false)).toBe(false);
    expect(g.due(180_000, false)).toBe(true);
    g.miss(180_000);
    expect(g.due(479_999, false)).toBe(false);
    g.miss(480_000);
    expect(g.due(779_999, false)).toBe(false); // capped at 300 s
    expect(g.due(780_000, false)).toBe(true);
    expect(g.due(480_001, true)).toBe(true); // the index changed: try at once
    g.ok();
    expect(g.misses).toBe(0);
    expect(g.due(480_001, false)).toBe(true);
    g.miss(0);
    expect(g.due(60_000, false)).toBe(true); // back to 60 s
  });
  test("stale server data waits for a new index file", () => {
    const g = startGate();
    g.hold();
    expect(g.due(Number.MAX_SAFE_INTEGER, false)).toBe(false);
    expect(g.due(0, true)).toBe(true);
  });
  test("one tab over an hour of mismatch downloads the seen file 14 times, not 60", () => {
    const g = startGate();
    let downloads = 0;
    for (let t = 0; t < 3600_000; t += 60_000) if (g.due(t, false)) { downloads++; g.miss(t); }
    expect(downloads).toBe(14); // minutes 0, 1, 3, then every 5 minutes (8, 13, …, 58)
  });
});

const Shell = BuildersShell as FC<{ note?: ReactNode; children?: ReactNode }>;
describe("audit L5 and L12: the page's footer line and its share tags", () => {
  test("the footer says the index is independent, on every state of the page", () => {
    expect(INDEX_FOOT_NOTE).toBe("Independent. Not affiliated with Circle or Arc.");
    const html = renderToStaticMarkup(createElement(Shell, { note: INDEX_FOOT_NOTE }, createElement("p", null, "Loading…")));
    expect(html).toMatch(/<footer class="pa-foot">[\s\S]*Independent\. Not affiliated with Circle or Arc\.[\s\S]*<\/footer>/);
    // every builder page carries it (the shell footer, with the Terms / Privacy / Pilot rules links), never twice
    expect(html.match(/Not affiliated with Circle or Arc/g)).toHaveLength(1);
    const plain = renderToStaticMarkup(createElement(Shell, null, null));
    expect(plain.match(/Not affiliated with Circle or Arc/g)).toHaveLength(1);
    for (const href of ["/terms", "/privacy", "/pilot-rules"]) expect(plain).toContain(`href="${href}"`);
  });
  test("plain title and description, in the OpenGraph and Twitter tags too; no landing-page slogan", () => {
    const title = "Arc indices · Registrai";
    const description = "Hourly indices of builder, integration and ecosystem activity on Arc mainnet, computed from public chain data.";
    expect(metadata).toMatchObject({ title, description, openGraph: { title, description, url: "https://builder.registrai.cc/builders-index/" }, twitter: { title, description } });
    expect(JSON.stringify(metadata)).not.toMatch(/Tabula|Proof, mapped|proof layer|You judge/i);
  });
});

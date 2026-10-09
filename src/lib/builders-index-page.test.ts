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

describe("data only: no trading words anywhere in the page source", () => {
  const root = resolve(__dirname, "../..");
  const files = [
    "src/app/builders-index/page.tsx",
    "src/components/builders-index/IndexPage.tsx",
    "src/lib/builders-index-page.ts",
    "src/lib/builders-index.ts",
    "src/lib/builders-index-fixture.ts",
    "src/lib/abi-live.ts",
    "src/lib/abi-live-mock.ts",
    "src/lib/abi-terminal.ts",
    "builders-site/lib/builders-index.ts",
    ...readdirSync(resolve(root, "builders-site/functions/api/index")).map((f) => `builders-site/functions/api/index/${f}`),
  ];
  const WORDS = /\b(trade|trades|trading|trader|traders|long|short|leverage|leveraged|perp|perps|perpetual|perpetuals|buy|buys|sell|sells|bet|bets|betting|wager|wagers|odds|position|positions|swap|swaps|futures)\b/i;
  test.each(files)("%s", (f) => {
    expect(readFileSync(resolve(root, f), "utf8").match(WORDS)?.[0]).toBeUndefined();
  });
  test("the page does not use the wallet shell", () => {
    expect(readFileSync(resolve(root, "src/app/builders-index/page.tsx"), "utf8")).not.toMatch(/wallet/i);
  });
  const built = resolve(root, "dist-builders/builders-index/index.html");
  test.skipIf(!existsSync(built))("the built page (skipped: run the builders-site build to create dist-builders)", () => {
    const text = readFileSync(built, "utf8").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
    expect(text.match(WORDS)?.[0]).toBeUndefined();
  });
});

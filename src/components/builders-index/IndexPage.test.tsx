import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { INDEX, HB, mockRpc, SEEN } from "@/lib/abi-live-mock";
import { createEngine } from "@/lib/abi-live";
import { Terminal } from "./IndexPage";

const st = { kind: "idle", text: "closed 21:00 UTC" };
const html = (props: Partial<Parameters<typeof Terminal>[0]> = {}) => renderToStaticMarkup(createElement(Terminal, { d: INDEX, R: null, closedLocal: [], st, ...props }));

describe("the terminal markup", () => {
  test("has every panel, with labelled controls", () => {
    const h = html();
    for (const t of ["Arc Builders Index", "Why ABI moved", "Time &amp; sales", "Members", "Open hour", "Method", "Older activity rolling off", "New payments add; older activity rolls off."]) expect(h).toContain(t);
    for (const l of ["Range", "Chart type", "Window", "Minimum payment", "About pace", "About roll-off", "About this breakdown"]) expect(h).toContain(`aria-label="${l}"`);
    for (const b of ["24H", "3D", "7D", "All", "Candles", "Line", "This hour", "≥ $1", "≥ $10"]) expect(h).toContain(`>${b}</button>`);
    expect(h).toMatch(/aria-pressed="true">24H</); // default range
  });
  test("the roll-off row is computed from the file", () => {
    const h = html();
    expect(h).toContain(`Roll-off · half-life ${INDEX.params.half_life_days} d`);
    const h2 = html({ d: { ...INDEX, params: { ...INDEX.params, half_life_days: 9 }, live: { ...INDEX.live!, decay_h: Math.pow(0.5, 1 / (9 * 24)) } } });
    expect(h2).toContain("Roll-off · half-life 9 d");
    expect(h2).toContain("pts −0.320%/h");
  });
  test("the base layer shows dashes for payment stats; members link to project pages", () => {
    const h = html();
    expect(h).toMatch(/href="\/project\/?\?source=domain%3Aargus.world"/);
    expect(h).toContain("chain-wide");
  });
  test("with the open hour: live status, tape rows and the countdown cell", async () => {
    const e = createEngine({ call: mockRpc(HB + 4100) as never });
    e.load(INDEX.live!, SEEN);
    const R = await e.tick();
    const h = html({ R, st: { kind: "live", text: "Live · 21:00:05 UTC" } });
    expect(h).toContain("Live · 21:00:05 UTC");
    expect(h).toContain("Closed hours");
    expect(h).toContain("new</span>");
  });
  test("data only: no order-entry controls", () => {
    expect(html()).not.toMatch(/\b(trade|buy|sell|long|short|leverage|perp|wager|bet)\b/i);
    expect(html()).not.toMatch(/<input|type="submit"/i);
  });
});

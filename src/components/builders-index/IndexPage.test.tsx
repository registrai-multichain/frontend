import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ARGUS, INDEX, HB, HS, mockRpc, scIndex, SEEN } from "@/lib/abi-live-mock";
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
    e.load(INDEX, SEEN);
    const R = await e.tick();
    const h = html({ R, st: { kind: "live", text: "Live · 21:00:05 UTC" } });
    expect(h).toContain("Live · 21:00:05 UTC");
    expect(h).toContain("Closed hours");
    expect(h).toContain("new</span>");
  });
  test("stablecoins and milestones panels: plain labels, explanations behind info buttons", () => {
    const h = html();
    for (const t of ["Stablecoins · 24h", "Into members", "Arc (est.)", "Milestones", "None recorded yet."]) expect(h).toContain(t);
    for (const l of ["About stablecoins", "About milestones", "Stablecoins, milestones, open hour"]) expect(h).toContain(`aria-label="${l}"`);
    expect(h).not.toContain("abi-ms-mark");
  });
  test("coins from the file; one not counted yet shows when it starts", () => {
    const d = { ...scIndex(), head_time: new Date((HS - 7200) * 1000).toISOString() };
    d.stablecoins = [{ symbol: "EURC", currency: "EUR", issuer: "Circle", address: "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1", decimals: 6, added: HS }];
    d.volume_24h = { USDC: { members_usd: 28317.33, members_payments: 7913, base_usd_est: 0, base_transfers_est: 0 } };
    const h = html({ d });
    expect(h).toMatch(/USDC<span class="abi-cc">USD<\/span>/);
    expect(h).toContain("$28,317");
    expect(h).toContain("7,913");
    expect(h).toContain("from 21:00");
  });
  test("milestones: newest first, evidence as explorer or https links with text only, markers on their candle", async () => {
    const d = scIndex();
    d.milestones[0].title = "<img src=x onerror=alert(1)>";
    const e = createEngine({ call: mockRpc(HB + 4100) as never });
    e.load(d, SEEN);
    const R = await e.tick();
    const h = html({ d, R });
    const panel = h.slice(h.indexOf('aria-label="Milestones"'));
    expect(panel.indexOf("Peach release")).toBeLessThan(panel.indexOf("Argus release"));
    expect(h).toContain(`href="https://explorer.arc.io/address/${ARGUS}"`);
    expect(h).toContain(`href="https://explorer.arc.io/tx/0x${"ab".repeat(32)}"`);
    expect(h).toContain('href="https://docs.arc.io/"');
    expect(h).toContain('rel="noopener noreferrer nofollow"');
    expect(h).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(h).not.toContain("<img");
    expect(h).toContain("×1.25");
    // the open hour carries both of its milestones' markers
    expect(h.match(/class="abi-ms-mark"/g)).toHaveLength(2);
  });
  test("data only: no order-entry controls", () => {
    expect(html()).not.toMatch(/\b(trade|buy|sell|long|short|leverage|perp|wager|bet)\b/i);
    expect(html()).not.toMatch(/<input|type="submit"/i);
  });
});

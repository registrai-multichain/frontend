import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { PilotTables, type PilotTablesProps } from "@/components/builders-index/pilot/PilotTables";
import { Ticket, type TicketProps } from "@/components/builders-index/pilot/Ticket";
import { liqPrice } from "./abi-pilot";
import type { PilotAccountView } from "./abi-pilot-api";
import { fmtSigned, fmtWhen, openLabel, PILOT_COPY, PILOT_DISCLAIMER, PILOT_DISCLAIMERS, PILOT_LIQ_NOTE } from "./abi-pilot-copy";

/**
 * R7 copy lint for the points pilot: no prize-type words anywhere in pilot copy (UI strings, server
 * error messages, the rendered markup), except inside the two exact disclaimer strings. "payout" may be
 * a code identifier (the engine's field), never a string.
 */
const BANNED = /\b(prizes?|rewards?|rewarded|rewarding|earn|earns|earned|earning|earnings|win|wins|winning|winnings|winners?|cash[\s-]?out|cashout|payouts?|redeem\w*|redemption|airdrops?|worth|value|valued)\b/i;

const root = resolve(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
const SOURCES = [
  ...walk("src/components/builders-index/pilot"),
  ...walk("src/lib").filter((f) => /\/abi-pilot[^/]*\.ts$/.test(f)),
  ...walk("builders-site/lib").filter((f) => /\/pilot[^/]*\.ts$/.test(f)),
  ...walk("builders-site/functions/api/pilot"),
  "builders-site/functions/api/index/mark.ts",
].filter((f) => !/\.test\.tsx?$/.test(f));

/** String literals (all three quote kinds) and JSX text of a TS/TSX source; comments and code are dropped. */
export function copyOf(src: string): string[] {
  const out: string[] = [];
  let code = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { const j = src.indexOf("\n", i); i = j < 0 ? src.length : j; continue; }
    if (c === "/" && d === "*") { const j = src.indexOf("*/", i + 2); i = j < 0 ? src.length : j + 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) { if (src[j] === "\\") { s += src[j + 1]; j += 2; continue; } s += src[j]; j++; }
      out.push(s);
      code += " ";
      i = j + 1;
      continue;
    }
    code += c;
    i++;
  }
  for (const m of code.matchAll(/>([^<>{}]+)</g)) if (m[1].trim()) out.push(m[1].trim());
  return out;
}

const clean = (s: string) => PILOT_DISCLAIMERS.reduce((t, d) => t.split(d).join(" "), s).replace(/\bVALUES\b/g, " ");
const banned = (s: string) => clean(s).match(BANNED)?.[0];

describe("pilot copy lint (R7)", () => {
  test("the disclaimers are the exact required strings", () => {
    expect(PILOT_DISCLAIMER).toBe("Points only. No deposits, no prizes; points have no value.");
    expect(PILOT_LIQ_NOTE).toBe("Liquidation only takes the position's margin.");
    expect(PILOT_COPY.closed).toBe("The points pilot is not open yet.");
    expect(PILOT_COPY.holdRegi).toBe("Hold REGI to join the points pilot.");
  });
  test("the lint catches what it should", () => {
    expect(banned("Win up to 500 pts")).toBe("Win");
    expect(banned("Cash out anytime")).toBe("Cash out");
    expect(banned("your payout")).toBe("payout");
    expect(banned("points are worth a lot")).toBe("worth");
    expect(banned(`${PILOT_DISCLAIMER} ${PILOT_LIQ_NOTE}`)).toBeUndefined();
    expect(banned("INSERT INTO t (a) VALUES (?)")).toBeUndefined();
    expect(copyOf('const a = "x"; // the prize\n/* reward */ <p>Close</p>; const b = payout;')).toEqual(["x", "Close"]);
  });
  test("the glob finds the pilot sources", () => {
    for (const f of ["src/components/builders-index/pilot/Ticket.tsx", "src/components/builders-index/pilot/PilotTables.tsx", "src/components/builders-index/pilot/PilotPanel.tsx",
      "src/lib/abi-pilot.ts", "src/lib/abi-pilot-api.ts", "src/lib/abi-pilot-copy.ts", "builders-site/lib/pilot.ts", "builders-site/lib/pilot-auth.ts",
      "builders-site/functions/api/pilot/order.ts", "builders-site/functions/api/index/mark.ts"]) expect(SOURCES).toContain(f);
  });
  test.each(SOURCES)("%s", (f) => {
    const hits = copyOf(readFileSync(resolve(root, f), "utf8")).map((s) => [s, banned(s)]).filter(([, b]) => b);
    expect(hits).toEqual([]);
  });
});

// ───────────────────────────── markup ─────────────────────────────

const ME = "0x1234567890abcdef1234567890abcdef12345678";
const MARK = { mark: 1000, ts: 1_760_097_600, age: 2, ch24: 0.01, ch1: 0.001, maxLev: 3, paused: false, fresh: true };
const VIEW: PilotAccountView = {
  open: true, address: ME, regi: true, account: { balance: 9000, equity: 9998.8, season: 1 },
  positions: [{ id: 7, side: "long", margin: 1000, lev: 2, notional: 2000, entry: 990, liq: liqPrice("long", 990, 2), openedAt: 1_760_097_000, fee: 1.2, pnl: 20.2 }],
  mark: MARK,
};
const noop = () => undefined;
const ticket = (p: Partial<TicketProps> = {}) => renderToStaticMarkup(createElement(Ticket, { view: VIEW, signInLabel: "Sign in", onSignIn: noop, onSignOut: noop, onOrder: noop, ...p }));
const tables = (p: Partial<PilotTablesProps> = {}) =>
  renderToStaticMarkup(createElement(PilotTables, {
    tab: "positions", onTab: noop, address: ME, positions: VIEW.positions, mark: 1000, closing: null, onClose: noop,
    history: [{ id: 3, side: "short", margin: 500, lev: 3, notional: 1500, entry: 1000, liq: 1470, openedAt: 1, closedAt: 1_760_090_000, exit: 1470, pnl: -705, fee: 0.9, returned: 0, net: -500.9, reason: "liquidation" }],
    board: [{ rank: 1, address: "0x1234…5678", equity: 10500 }, { rank: 2, address: "0xabcd…ef01", equity: 9000 }],
    ...p,
  }));
/** Visible text plus the attribute copy a screen reader reads. */
const visible = (html: string) => html.replace(/<[^>]*?(?:aria-label|title)="([^"]*)"[^>]*>/g, " $1 ").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("ticket", () => {
  test("signed-in holder: Long / Short, margin, leverage, liquidation price, fee; disclaimers visible above the button", () => {
    const h = ticket();
    for (const t of ["Long", "Short", "Margin", "Leverage", "Liquidation price", "Fee", "Size", "Balance", "1×", "2×", "3×"]) expect(h).toContain(t);
    expect(h).toContain(`>${openLabel("long", 1)}</button>`);
    const button = h.indexOf('type="submit"');
    expect(h.indexOf(PILOT_DISCLAIMER.replace("'", "&#x27;"))).toBeGreaterThan(-1);
    expect(h.indexOf(PILOT_DISCLAIMER)).toBeLessThan(button);
    expect(h.indexOf(PILOT_LIQ_NOTE.replace("'", "&#x27;"))).toBeLessThan(button);
    expect(h.indexOf(PILOT_LIQ_NOTE.replace("'", "&#x27;"))).toBeGreaterThan(-1);
    expect(h).toContain('aria-label="About the points pilot"'); // the rules sit behind an i bubble
    expect(banned(visible(h))).toBeUndefined();
  });
  test("leverage above the dynamic cap is disabled; paused and stale marks block the button", () => {
    const capped = ticket({ view: { ...VIEW, mark: { ...MARK, maxLev: 2 } } });
    expect(capped).toMatch(/disabled="">3×<\/button>/);
    expect(capped).toContain(PILOT_COPY.capped(2).replace("'", "&#x27;"));
    const paused = ticket({ view: { ...VIEW, mark: { ...MARK, paused: true } } });
    expect(paused).toContain(PILOT_COPY.paused);
    expect(paused).toMatch(/type="submit"[^>]*disabled=""/);
    const stale = ticket({ view: { ...VIEW, mark: { ...MARK, fresh: false } } });
    expect(stale).toContain(PILOT_COPY.priceUpdating);
    expect(stale).toMatch(/type="submit"[^>]*disabled=""/);
  });
  test("kill switch: 'The points pilot is not open yet.' and no order button, signed in or not", () => {
    for (const v of [{ ...VIEW, open: false }, { ...VIEW, open: false, address: null, regi: null, account: null, positions: [] }]) {
      const h = ticket({ view: v });
      expect(h).toContain(PILOT_COPY.closed);
      expect(h).not.toContain('type="submit"');
    }
  });
  test("visitors and non-holders: 'Hold REGI to join the points pilot.'; visitors get the sign-in button", () => {
    const visitor = ticket({ view: { ...VIEW, address: null, regi: null, account: null, positions: [] } });
    expect(visitor).toContain(PILOT_COPY.holdRegi);
    expect(visitor).toContain(">Sign in</button>");
    expect(visitor).toContain('aria-label="About sign-in"');
    const holder = ticket({ view: { ...VIEW, regi: false } });
    expect(holder).toContain(PILOT_COPY.holdRegi);
    expect(holder).not.toContain('type="submit"');
    for (const h of [visitor, holder]) expect(banned(visible(h))).toBeUndefined();
  });
});

describe("positions, history, leaderboard", () => {
  test("positions: entry, mark, PnL, liquidation price and Close", () => {
    const h = tables();
    for (const t of ["Positions (1)", "History", "Leaderboard", "Long 2×", "990.00", "1,000.00", "+20.20", "Liq. price", ">Close</button>"]) expect(h).toContain(t);
    expect(banned(visible(h))).toBeUndefined();
  });
  test("history: net result and liquidations", () => {
    const h = tables({ tab: "history" });
    for (const t of ["Short 3×", fmtWhen(1_760_090_000), fmtSigned(-500.9), "Liquidated"]) expect(h).toContain(t);
    expect(banned(visible(h))).toBeUndefined();
  });
  test("leaderboard: shortened addresses, own row marked; visible signed out", () => {
    const h = tables({ tab: "leaderboard" });
    expect(h).toContain("0x1234…5678");
    expect(h).toContain('class="abi-pt-me"');
    expect(h).not.toContain(ME);
    expect(tables({ tab: "leaderboard", address: null })).toContain("0xabcd…ef01");
    expect(tables({ tab: "positions", address: null })).toContain(PILOT_COPY.signInForPositions);
    expect(banned(visible(h))).toBeUndefined();
  });
});

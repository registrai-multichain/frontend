import { readdirSync, readFileSync } from "node:fs";
import { toFunctionSelector } from "viem";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { PilotTables, type PilotTablesProps } from "@/components/builders-index/pilot/PilotTables";
import { RegiLock, type RegiLockProps } from "@/components/builders-index/pilot/RegiLock";
import { Ticket, type TicketProps } from "@/components/builders-index/pilot/Ticket";
import { borrowPaid, liqPrice, RULES } from "./abi-pilot";
import { accountPollMs, type EconomyView, type PilotAccountView, type RateView } from "./abi-pilot-api";
import { defaultLock, leverageUnlocked, LOCK_FACTORY_ABI, NO_CHAIN, parseRegi, usdOf, VAULT_ABI, type LockChain } from "./abi-pilot-lock";
import { borrowPerDay, fmtBook, fmtPts, fmtPx, fmtSideRate, fmtSigned, fmtWhen, openLabel, PILOT_COPY, PILOT_DISCLAIMER, PILOT_DISCLAIMERS, PILOT_JUMP_NOTE, PILOT_LIQ_NOTE } from "./abi-pilot-copy";

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
    // audit L4; plan 2026-10-12 R8: index-neutral, the same line on every market's ticket
    expect(PILOT_JUMP_NOTE).toBe("Recorded milestones move the index at once and can liquidate leveraged positions.");
    expect(PILOT_COPY.closed).toBe("The points pilot is not open yet.");
    // owner decisions 2026-10-13: $10 of REGI at sign-in and at each order, at the 24 h median; the snapshot only when one is set
    expect(PILOT_COPY.holdRegi(10)).toBe("Hold at least $10 of REGI to join the points pilot.");
    expect(PILOT_COPY.signInTip(10)).toContain("The wallet needs at least $10 of REGI on Arc at sign-in and when it places each order.");
    expect(PILOT_COPY.signInTip(10)).toContain("REGI is priced at the median of the REGI/USDC pool over the last 24 hours.");
    expect(PILOT_COPY.signInTip(10)).toContain("The leaderboard shows only wallets that currently hold the amount.");
    expect(PILOT_COPY.signInTip(10)).not.toContain("snapshot");
    expect(PILOT_COPY.signInTip(10, true)).toContain("when it places each order, and must have held that amount at the pilot snapshot block.");
    expect(PILOT_COPY.misconfigured).toBe("The points pilot is misconfigured; new orders are refused.");
    for (const s of [PILOT_COPY.holdRegi(10), PILOT_COPY.signInTip(10), PILOT_COPY.signInTip(10, true), PILOT_COPY.misconfigured]) expect(banned(s)).toBeUndefined();
    expect(PILOT_COPY.rulesTip).toContain("One direction at a time in each market: close your longs there before opening a short, and the reverse.");
    // plan 2026-10-12 R9: three markets, one balance, one direction per market, the economy per market
    expect(PILOT_COPY.marketsRule).toBe(
      "The pilot trades ABI, AII and AEI. One points balance per wallet covers all three markets. " +
      `You hold one direction at a time in each market, and up to ${RULES.maxOpen} open positions per market. ` +
      "Each market has its own mark, funding rates, house, fee pool, insurance and weekly split.",
    );
    for (const s of [PILOT_COPY.marketsRule, PILOT_COPY.rulesTip, PILOT_COPY.fundingTip, PILOT_COPY.economyTip, PILOT_COPY.leaderboardTip, PILOT_COPY.paused, PILOT_COPY.capped(5, "AII")]) {
      expect(banned(s)).toBeUndefined();
      expect(s).not.toMatch(/\bABI's\b|first ABI mark|ABI moved/); // index-neutral (the markets list names ABI)
    }
    // §9.15 (audit PE-2): the long rate includes the milestone premium, and the funding tip says so
    expect(PILOT_COPY.fundingTip).toContain("Milestone premium: longs also pay the mean hourly milestone step of the last 30 days, to the house; it is part of the long rate.");
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
const MARK = { mark: 1000, ts: 1_760_097_600, age: 2, ch24: 0.01, ch1: 0.001, sigma1h: 0.0004, sigma24h: 0.002, maxLev: 30, levCap: 30, paused: false, basePaused: false, milestonePaused: false, fresh: true };
const rate = (t: number, long: number, short: number, L: number, S: number): RateView => ({ t, long, short, skew: (L - S) / (L + S || 1), trend: 0, premium: 0, r: 0, cut: 0, L, S, houseExposure: S - L });
const FUNDING = { market: "abi" as const, recent: [rate(1_760_094_000, 0.0003, -0.00027, 75000, 25000), rate(1_760_090_400, -0.0002, 0.0002, 0, 0)], current: rate(1_760_094_000, 0.0003, -0.00027, 75000, 25000), next: 1_760_097_600 };
const NOW = { hour: 1_760_094_000, long: 0.0003, short: -0.00027, skew: 0.5, next: 1_760_097_600 };
const POS_LIQ = liqPrice({ side: "long", margin: 1000, notional: 2000, entry: 990 }, 0);
const VIEW: PilotAccountView = {
  market: "abi", open: true, misconfigured: false, admitUsd: 10, lockUsd: 50, price: 1e-5, admitRegi: (10n ** 24n).toString(), lockRegi: (5n * 10n ** 24n).toString(), lockFactory: "0x00000000000000000000000000000000000fac70", regiSnapshot: false, address: ME, regi: { ok: true, snapshot: true, now: true }, account: { balance: 9000, equity: 9998.8, season: 1 },
  positions: [{ id: 7, market: "abi", side: "long", margin: 1000, lev: 2, notional: 2000, entry: 990, liq: POS_LIQ, openedAt: 1_760_097_000, fee: 0.2, funding: 0.6, borrow: 0.02, mark: 1000, pnl: 20.2, lockReq: (5n * 10n ** 24n).toString() }],
  pending: [],
  mark: MARK,
  funding: NOW,
};
const ECONOMY: EconomyView = {
  market: "abi",
  ts: 1_760_097_600,
  rates: { current: { ...FUNDING.current, L: 70000, S: 30000, houseExposure: -40000, cut: 0.42 }, recent: FUNDING.recent },
  borrowApr: 0.1,
  house: {
    exposure: -40000, realized: 37.5, unrealized: -6.25,
    price: { h24: 10, week: -5, all: 30 }, funding: { h24: 2, week: 1.5, all: 9 }, trueup: { h24: 0.5, week: 0.25, all: 1 }, liquidations: { h24: 0, week: 0, all: 0 },
    total: { h24: 12.5, week: -3.25, all: 40 },
  },
  pool: { fee: 10, borrow: 5, cut: 1, house: 40, total: 56 },
  insurance: 2.5,
  treasury: 80, buyback: 40,
  week: { start: 1_759_708_800, pool: 56, insurance: 11.2, treasury: 44.8, buyback: 22.4 },
  lastSplit: { week: 1_759_104_000, ts: 1_759_708_900, pool: 100, insurance: 20, treasury: 80, buyback: 40 },
};
const VISITOR: PilotAccountView = { ...VIEW, address: null, regi: null, account: null, positions: [] };
const noop = () => undefined;
const M = 10n ** 24n; // 1,000,000 REGI: $10 at VIEW's price
const VAULT = "0x00000000000000000000000000000000000000ee";
/** A holder with the $50 lock: 5,000,000 REGI in the wallet and 5,000,000 locked. */
const LOCKED: LockChain = { regi: 5n * M, locked: 5n * M, vault: VAULT, allowance: 0n };
const ticket = (p: Partial<TicketProps> = {}) => renderToStaticMarkup(createElement(Ticket, { view: VIEW, signInLabel: "Sign in", onSignIn: noop, onSignOut: noop, onOrder: noop, lock: LOCKED, ...p }));
const lockBox = (p: Partial<RegiLockProps> = {}) =>
  renderToStaticMarkup(createElement(RegiLock, { view: VIEW, chain: LOCKED, tx: null, walletMatches: true, onLock: noop, onWithdraw: noop, onClaim: noop, ...p }));
const tables = (p: Partial<PilotTablesProps> = {}) =>
  renderToStaticMarkup(createElement(PilotTables, {
    tab: "positions", onTab: noop, market: "abi", address: ME, positions: VIEW.positions, closing: null, onClose: noop, funding: FUNDING,
    history: [{ id: 3, market: "abi", side: "short", margin: 500, lev: 3, notional: 1500, entry: 1000, openedAt: 1, closedAt: 1_760_090_000, exit: 1470, pnl: -705, funding: -1.5, borrow: 0.75, fee: 0.3, returned: 0, net: -500.15, reason: "liquidation" }],
    board: [{ rank: 1, address: "0x1234…5678", equity: 10500 }, { rank: 2, address: "0xabcd…ef01", equity: 9000 }],
    ...p,
  }));
const esc = (s: string) => s.replace(/'/g, "&#x27;");
/** Visible text plus the attribute copy a screen reader reads. */
const visible = (html: string) => html.replace(/<[^>]*?(?:aria-label|title)="([^"]*)"[^>]*>/g, " $1 ").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("ticket", () => {
  test("signed-in holder: Long / Short, margin, leverage 1–30×, liquidation price with costs, fee, borrow, funding per side; both disclaimers above the button", () => {
    const h = ticket();
    for (const t of ["Long", "Short", "Margin", "Leverage", "Liquidation price", "Fee", "Size", "Balance", "Funding long", "Funding short", "Borrow", "pts/day", "in 24 h", "pays 0.0300%/h", "receives 0.0270%/h"]) expect(h).toContain(t);
    for (const l of RULES.levels) expect(h).toContain(`>${l}×</button>`);
    expect(RULES.levels).toEqual([1, 2, 3, 5, 10, 20, 30]);
    // at 100 pts, 1× (the default): borrow 0; the liquidation price a day on moves with this hour's long rate
    expect(h).toContain(`${fmtPts(0)} pts/day`);
    const pos = { side: "long" as const, margin: 100, notional: 100, entry: 1000, openedAt: 0 };
    expect(h).toContain(`${fmtPx(liqPrice(pos, 0))} · ${fmtPx(liqPrice(pos, borrowPaid(pos, 86400) + 0.0003 * 100 * 24))} in 24 h`);
    expect(borrowPerDay(30000, 1000)).toBeCloseTo(29000 * 0.1 / 365, 12);
    expect(h).toContain(`>${openLabel("long", 1, "ABI")}</button>`);
    expect(openLabel("short", 5, "AII")).toBe("Open short AII 5×");
    const button = h.indexOf('type="submit"');
    expect(h.indexOf(PILOT_DISCLAIMER)).toBeGreaterThan(-1);
    expect(h.indexOf(PILOT_DISCLAIMER)).toBeLessThan(button);
    expect(h.indexOf(esc(PILOT_LIQ_NOTE))).toBeGreaterThan(-1);
    expect(h.indexOf(esc(PILOT_LIQ_NOTE))).toBeLessThan(button);
    // audit L4: the milestone-step risk inline, next to the other disclaimers, above the button
    expect(h).toContain(`<p>${esc(PILOT_LIQ_NOTE)}</p><p>${PILOT_JUMP_NOTE}</p>`);
    expect(h.indexOf(PILOT_JUMP_NOTE)).toBeLessThan(button);
    for (const l of ["About the points pilot", "About funding", "About borrow", "About the liquidation price"]) expect(h).toContain(`aria-label="${l}"`);
    expect(banned(visible(h))).toBeUndefined();
  });
  test("leverage above the volatility cap is disabled; paused, base-paused and stale marks block the button; a queued order says so", () => {
    const capped = ticket({ view: { ...VIEW, mark: { ...MARK, maxLev: 5 } } });
    expect(capped).toMatch(/disabled="">10×<\/button>/);
    expect(capped).toMatch(/disabled="">20×<\/button>/);
    expect(capped).toMatch(/disabled="">30×<\/button>/);
    expect(ticket()).not.toMatch(/disabled="">30×<\/button>/);
    expect(capped).not.toMatch(/disabled="">5×<\/button>/);
    expect(capped).toContain(esc(PILOT_COPY.capped(5, "ABI")));
    expect(PILOT_COPY.capped(5, "AII")).toBe("Max 5× at AII's current volatility.");
    // the pilot's own cap (PILOT_MAX_LEV, owner decision: 10×): no level above it is offered, and no volatility note
    const pilotCap = ticket({ view: { ...VIEW, mark: { ...MARK, maxLev: 10, levCap: 10 } } });
    for (const l of [1, 2, 3, 5, 10]) expect(pilotCap).toContain(`>${l}×</button>`);
    for (const l of [20, 30]) expect(pilotCap).not.toContain(`>${l}×</button>`);
    expect(pilotCap).not.toMatch(/disabled="">10×<\/button>/);
    expect(pilotCap).not.toContain(esc(PILOT_COPY.capped(10, "ABI")));
    const both = ticket({ view: { ...VIEW, mark: { ...MARK, maxLev: 5, levCap: 10 } } });
    expect(both).not.toContain(">20×</button>");
    expect(both).toMatch(/disabled="">10×<\/button>/);
    expect(both).toContain(esc(PILOT_COPY.capped(5, "ABI")));
    for (const [mark, text] of [[{ ...MARK, paused: true }, PILOT_COPY.paused], [{ ...MARK, basePaused: true }, PILOT_COPY.basePaused], [{ ...MARK, fresh: false }, PILOT_COPY.priceUpdating]] as const) {
      const h = ticket({ view: { ...VIEW, mark } });
      expect(h).toContain(esc(text));
      expect(h).toMatch(/type="submit"[^>]*disabled=""/);
    }
    expect(ticket({ filling: true, busy: true })).toContain(PILOT_COPY.filling);
    const ms = ticket({ view: { ...VIEW, mark: { ...MARK, milestonePaused: true } } });
    expect(ms).toContain("Paused: index milestone");
    expect(ms).toContain('aria-label="About the milestone pause"');
    expect(ms).toMatch(/type="submit"[^>]*disabled=""/);
    expect(PILOT_COPY.milestoneTip).toBe("Recorded milestones change the index at once; orders pause for a minute so nobody trades on stale prices.");
    // no hedging: VIEW holds a long, so a short is blocked in the ticket before it is sent
    expect(PILOT_COPY.closeFirst("long")).toBe("Close your long first");
  });
  test("every state shows the disclaimer: kill switch, visitor, no REGI, not at the snapshot, REGI unknown", () => {
    const states: [PilotAccountView, string][] = [
      [{ ...VIEW, open: false }, PILOT_COPY.closed],
      [{ ...VISITOR, open: false }, PILOT_COPY.closed],
      [VISITOR, PILOT_COPY.holdRegi(10)],
      [{ ...VIEW, open: false, misconfigured: true }, PILOT_COPY.misconfigured],
      [{ ...VISITOR, open: false, misconfigured: true }, PILOT_COPY.misconfigured],
      [{ ...VIEW, regiSnapshot: true, regi: { ok: false, snapshot: false, now: true } }, PILOT_COPY.notAtSnapshot],
    ];
    for (const [view, line] of states) {
      const h = ticket({ view });
      expect(h).toContain(esc(line));
      expect(h).toContain(PILOT_DISCLAIMER);
      expect(h).toContain(PILOT_JUMP_NOTE);
      expect(h).not.toContain('type="submit"');
      expect(banned(visible(h))).toBeUndefined();
    }
    // owner decision 2026-10-12: the last known REGI state is a note; the order (a fresh read) decides, so the form stays
    for (const [view, line] of [
      [{ ...VIEW, regi: { ok: false, snapshot: null, now: false } }, PILOT_COPY.holdRegi(10)],
      [{ ...VIEW, regi: { ok: null, snapshot: null, now: null } }, PILOT_COPY.regiUnchecked],
    ] as [PilotAccountView, string][]) {
      const h = ticket({ view });
      expect(h).toContain(esc(line));
      expect(h).toContain('type="submit"');
      expect(h).toContain(PILOT_DISCLAIMER);
      expect(banned(visible(h))).toBeUndefined();
    }
    // a possible holder whose check failed is never told to hold REGI
    expect(ticket({ view: { ...VIEW, regi: { ok: null, snapshot: null, now: null } } })).not.toContain(PILOT_COPY.holdRegi(10));
    expect(ticket({ view: VISITOR })).toContain(">Sign in</button>");
    expect(ticket({ view: VISITOR })).toContain('aria-label="About sign-in"');
  });
});

describe("three markets (plan 2026-10-12 R8)", () => {
  const AII_MARK = { ...MARK, mark: 2000, maxLev: 5 };
  test.each([["aii", "AII"], ["aei", "AEI"]] as const)("the ticket on the %s tab trades that market and says so", (market, code) => {
    const h = ticket({ view: { ...VIEW, market, mark: AII_MARK } });
    expect(h).toContain(`Points pilot · ${code}`);
    expect(h).toContain(`aria-label="Points pilot ticket, ${code}"`);
    expect(h).toContain(`>${openLabel("long", 1, code)}</button>`);
    expect(h).toContain(`Open long ${code} 1×`);
    expect(h).toContain(`${code} mark`);
    expect(h).toContain(fmtPx(2000));
    expect(h).toContain(esc(PILOT_COPY.capped(5, code)));
    // the disclaimers, inline above the button, on every market's ticket
    const button = h.indexOf('type="submit"');
    for (const d of [PILOT_DISCLAIMER, esc(PILOT_LIQ_NOTE), PILOT_JUMP_NOTE]) {
      expect(h.indexOf(d)).toBeGreaterThan(-1);
      expect(h.indexOf(d)).toBeLessThan(button);
    }
    expect(banned(visible(h))).toBeUndefined();
  });
  test("one direction per market: a long held in ABI doesn't block a short on the AII ticket; it does on ABI's", () => {
    const aii = ticket({ view: { ...VIEW, market: "aii" } });
    expect(aii).not.toContain(PILOT_COPY.closeFirst("long"));
    const five = Array.from({ length: RULES.maxOpen }, (_, i) => ({ ...VIEW.positions[0], id: 100 + i }));
    expect(ticket({ view: { ...VIEW, positions: five } })).toContain(`Up to ${RULES.maxOpen} open positions`);
    expect(ticket({ view: { ...VIEW, market: "aei", positions: five } })).not.toContain(`Up to ${RULES.maxOpen} open positions`);
  });
  test("positions in several markets each show their market and their own mark; funding and economy name the tab's market", () => {
    const positions = [VIEW.positions[0], { ...VIEW.positions[0], id: 8, market: "aii" as const, side: "short" as const, mark: 2010, entry: 2000, pnl: -10 }];
    const h = tables({ positions, market: "aii" });
    expect(h).toContain(">ABI</td>");
    expect(h).toContain(">AII</td>");
    expect(h).toContain(fmtPx(2010));
    expect(h).toContain(fmtPx(1000));
    expect(tables({ tab: "funding", market: "aii" })).toContain('<span class="abi-pt-mkt">AII</span>');
    expect(tables({ tab: "economy", market: "aei", economy: { ...ECONOMY, market: "aei" } })).toContain('<span class="abi-pt-mkt">AEI</span>');
    expect(tables({ tab: "leaderboard", market: "aii" })).not.toContain("abi-pt-mkt"); // one board
  });
});

describe("positions, history, leaderboard, funding", () => {
  test("positions: entry, mark, PnL, funding, borrow, liquidation price and Close", () => {
    const h = tables();
    for (const t of ["Positions (1)", "History", "Leaderboard", "Funding", "Economy", "Market", ">ABI</td>", "Long 2×", "990.00", "1,000.00", "+20.20", "+0.60", "Borrow", "0.02", "Liq. price", ">Close</button>"]) expect(h).toContain(t);
    expect(banned(visible(h))).toBeUndefined();
  });
  test("history: funding, net result and liquidations", () => {
    const h = tables({ tab: "history" });
    for (const t of ["Short 3×", "<th>Market</th>", ">ABI</td>", fmtWhen(1_760_090_000), fmtSigned(-1.5), "0.75", fmtSigned(-500.15), "Liquidated"]) expect(h).toContain(t);
    expect(banned(visible(h))).toBeUndefined();
  });
  test("leaderboard: shortened addresses, own row marked, the disclaimer under it; visible signed out", () => {
    const h = tables({ tab: "leaderboard" });
    expect(h).toContain("0x1234…5678");
    expect(h).toContain('class="abi-pt-me"');
    expect(h).not.toContain(ME);
    expect(h.indexOf(PILOT_DISCLAIMER)).toBeGreaterThan(h.indexOf("</table>"));
    expect(tables({ tab: "leaderboard", address: null })).toContain("0xabcd…ef01");
    expect(tables({ tab: "positions", address: null })).toContain(PILOT_COPY.signInForPositions);
    expect(banned(visible(h))).toBeUndefined();
  });
  test("funding: the recent hourly rates per side with who pays, the skew, and an i bubble", () => {
    const h = tables({ tab: "funding", address: null });
    expect(fmtBook(75000, 25000)).toBe("75% long · 25% short"); // review S4: not "50% long" (skew 0.5)
    expect(fmtBook(30000, 70000)).toBe("30% long · 70% short");
    expect(fmtBook(0, 0)).toBe("No positions");
    for (const t of ["Book", "75% long · 25% short", "No positions", fmtSideRate(0.0003), fmtSideRate(-0.00027), "receives 0.0200%/h", "pays 0.0200%/h", 'aria-label="About funding"']) expect(h).toContain(t);
    expect(banned(visible(h))).toBeUndefined();
  });
  test("economy (R8): skew, funding per side, the house, the fee pool by source, insurance and the split in points; the disclaimer", () => {
    const h = tables({ tab: "economy", address: null, economy: ECONOMY });
    for (const t of [
      "Book", "70% long · 30% short", "Funding long", "pays 0.0300%/h", "Funding short", "receives 0.0270%/h",
      "House position", "Short 40,000.00 pts", "House, open positions", "−6.25 pts", "House, realized not split", "+37.50 pts",
      "House P&amp;L", "24 h", "Week", "All", "Price", "+10.00", "−5.00", "+30.00", "True-up", "+0.50", "Liquidations", "Total", "+12.50", "−3.25", "+40.00",
      "Fee pool since the last split", "56.00 pts", "Trading fees", "10.00 pts", "Borrow", "5.00 pts", "Funding cut", "1.00 pts", "House",
      "Insurance", "2.50 pts", "Split this week", "11.20 insurance · 44.80 treasury pts", "Buyback (in treasury)", "22.40 pts",
      "Last split", "100.00 pts", "Treasury, all splits", "80.00 pts", "Buyback, all splits", "40.00 pts",
      'aria-label="About the economy"', 'aria-label="About insurance"', 'aria-label="About the book"', 'aria-label="About the house lines"', PILOT_DISCLAIMER,
    ]) expect(h).toContain(t);
    expect(h).not.toMatch(/REGI\b[^<]*\d/); // points only: no REGI amount anywhere
    expect(PILOT_COPY.economyTip).toContain("All in points; nothing is bought during the pilot.");
    expect(banned(visible(h))).toBeUndefined();
    expect(tables({ tab: "economy", economy: null })).toContain("Loading…");
  });
});

describe("account polling (D1 budget)", () => {
  test("15 s while signed in, 2 s only while an order is pending, never signed out", () => {
    expect(accountPollMs(null)).toBeNull();
    expect(accountPollMs({ address: null, pending: [] })).toBeNull();
    expect(accountPollMs({ address: ME, pending: [] })).toBe(15_000);
    expect(accountPollMs({ address: ME, pending: [{ id: 1, market: "abi", kind: "open", status: "pending", side: "long", margin: 10, lev: 1, positionId: null, arrivedMs: 0, fillPx: null, error: null }] })).toBe(2_000);
  });
  test("the Funding tab waits for the edge-cached endpoint", () => {
    expect(tables({ tab: "funding", funding: null })).toContain("Loading…");
  });
});


describe("REGI in dollars and the REGI lock (plan 2026-10-13 R6)", () => {
  const disabledAbove1 = (h: string) => [2, 3, 5, 10, 20, 30].every((l) => new RegExp(`disabled="">${l}×</button>`).test(h));
  test("leverage above 1× is disabled without enough REGI locked, without a factory and while the price is unknown; the ticket says why", () => {
    expect(disabledAbove1(ticket())).toBe(false);
    for (const [p, line] of [
      [{ lock: NO_CHAIN }, PILOT_COPY.lockNeeded(50)],
      [{ lock: { ...LOCKED, locked: 5n * M - 1n } }, PILOT_COPY.lockNeeded(50)],
      [{ view: { ...VIEW, lockFactory: null } }, PILOT_COPY.lockNotLive],
      [{ view: { ...VIEW, price: null, admitRegi: null, lockRegi: null } }, PILOT_COPY.regiPriceUpdating],
    ] as [Partial<TicketProps>, string][]) {
      const h = ticket(p);
      expect(disabledAbove1(h)).toBe(true);
      expect(h).not.toMatch(/disabled="">1×<\/button>/);
      expect(h).toContain(line);
      expect(h).toContain(">Open long ABI 1×</button>");
      expect(banned(visible(h))).toBeUndefined();
    }
    expect(PILOT_COPY.lockNeeded(50)).toBe("Lock at least $50 of REGI to trade with leverage.");
    expect(leverageUnlocked(VIEW, LOCKED)).toBe(true);
    expect(leverageUnlocked({ ...VIEW, lockFactory: null }, LOCKED)).toBe(false);
  });

  test("the admission amount in REGI at the 24 h median and the wallet's REGI; visitors see the amount too", () => {
    const h = ticket();
    expect(visible(h)).toMatch(/To join\s+About the REGI price\s+i\s+1,000,000 REGI ≈ \$10\s+Your REGI\s+5,000,000 REGI/);
    const v = ticket({ view: VISITOR });
    expect(v).toContain(PILOT_COPY.holdRegi(10));
    expect(v).toContain("1,000,000 REGI ≈ $10");
    expect(ticket({ view: { ...VISITOR, admitRegi: null, price: null } })).toContain(PILOT_COPY.regiPriceUpdating);
    // signed in while the price is unknown: said plainly, never "hold REGI"
    const unknown = ticket({ view: { ...VIEW, price: null, admitRegi: null, lockRegi: null, regi: { ok: null, snapshot: null, now: null } } });
    expect(unknown).toContain(PILOT_COPY.regiPriceUpdating);
    expect(unknown).not.toContain(PILOT_COPY.regiUnchecked);
    expect(PILOT_COPY.priceTip).toContain("median of the REGI/USDC pool over the last 24 hours");
  });

  test("the lock box: locked REGI and its dollars, leverage status, Lock / Withdraw / Claim; the owner line next to the lock button, the warning next to Withdraw", () => {
    const h = lockBox();
    const text = visible(h);
    expect(text).toMatch(/Locked\s+5,000,000 REGI ≈ \$50\.00\s+Leverage\s+Unlocked/);
    for (const b of [PILOT_COPY.lockButton, PILOT_COPY.withdrawButton, PILOT_COPY.claimButton]) expect(h).toMatch(new RegExp(`<button type="button" class="[^"]+">${b}</button>`));
    // the owner's line right after the lock button, the withdrawal warning right after Withdraw / Claim
    const lockAt = h.indexOf(`>${PILOT_COPY.lockButton}</button>`), noteAt = h.indexOf(PILOT_COPY.lockNote), withdrawAt = h.indexOf(`>${PILOT_COPY.withdrawButton}</button>`), warnAt = h.indexOf(PILOT_COPY.withdrawWarn);
    expect(lockAt).toBeGreaterThan(-1);
    expect(noteAt).toBeGreaterThan(lockAt);
    expect(withdrawAt).toBeGreaterThan(noteAt);
    expect(warnAt).toBeGreaterThan(withdrawAt);
    expect(PILOT_COPY.lockNote).toBe("Locked REGI stays yours. You can withdraw it at any time; withdrawing closes your leveraged positions.");
    expect(PILOT_COPY.withdrawWarn).toBe("Withdrawing closes your leveraged positions at the next price.");
    expect(h).toContain('aria-label="About the REGI lock"');
    expect(h).toContain('aria-label="About holder distributions"');
    expect(h).toContain('value="250000"'); // exactly the requirement: the default tops up to it + 5%
    expect(banned(text)).toBeUndefined();
    // "Claim rewards" would fail the lint: the button says what it does instead (the lint is not weakened)
    expect(banned("Claim rewards")).toBe("rewards");
    expect(banned(PILOT_COPY.claimButton)).toBeUndefined();
  });

  test("the lock box disables what can't be done: nothing locked, no vault, another wallet, a transaction in flight, more than the wallet holds, no factory", () => {
    const btn = (h: string, label: string) => new RegExp(`disabled="">${label}</button>`).test(h);
    const fresh = lockBox({ chain: { regi: 6n * M, locked: 0n, vault: null, allowance: 0n } });
    expect([btn(fresh, PILOT_COPY.lockButton), btn(fresh, PILOT_COPY.withdrawButton), btn(fresh, PILOT_COPY.claimButton)]).toEqual([false, true, true]);
    expect(fresh).toContain('value="5250000"'); // the requirement + 5%
    expect(visible(fresh)).toMatch(/Leverage\s+Needs 5,000,000 REGI locked/);
    const poor = lockBox({ chain: { regi: 1n * M, locked: 0n, vault: null, allowance: 0n } });
    expect(btn(poor, PILOT_COPY.lockButton)).toBe(true);
    expect(poor).toContain(PILOT_COPY.notEnoughRegi);
    const other = lockBox({ walletMatches: false });
    expect([btn(other, PILOT_COPY.lockButton), btn(other, PILOT_COPY.withdrawButton), btn(other, PILOT_COPY.claimButton)]).toEqual([true, true, true]);
    expect(other).toContain(PILOT_COPY.wrongWallet);
    for (const stage of ["approve", "confirm", "waiting"] as const) {
      const h = lockBox({ tx: { action: "lock", stage } });
      expect([btn(h, PILOT_COPY.lockButton), btn(h, PILOT_COPY.withdrawButton), btn(h, PILOT_COPY.claimButton)]).toEqual([true, true, true]);
      expect(h).toContain({ approve: PILOT_COPY.txApprove, confirm: PILOT_COPY.txConfirm, waiting: PILOT_COPY.txWaiting }[stage]);
    }
    expect(lockBox({ tx: { action: "withdraw", stage: "done" } })).toContain(PILOT_COPY.txWithdrawn);
    expect(lockBox({ tx: { action: "claim", stage: "failed", error: "Cancelled in your wallet." } })).toContain('<p class="abi-pt-err" role="status">Cancelled in your wallet.</p>');
    const off = lockBox({ view: { ...VIEW, lockFactory: null }, chain: NO_CHAIN });
    expect(off).toContain(PILOT_COPY.lockNotLive);
    expect(off).not.toContain("<button type=\"button\" class=\"abi-pt-primary\"");
    expect(visible(off)).toMatch(/Leverage\s+1× only/);
    for (const h of [fresh, poor, other, off]) expect(banned(visible(h))).toBeUndefined();
  });

  test("the ticket shows the lock box only while signed in", () => {
    expect(ticket({ lockBox: lockBox() })).toContain(PILOT_COPY.lockNote);
    expect(ticket({ view: VISITOR, lockBox: lockBox() })).not.toContain(PILOT_COPY.lockNote);
  });

  test("lock arithmetic and the ABIs the page sends", () => {
    expect(defaultLock((5n * M).toString(), 0n)).toBe(5_250_000n * 10n ** 18n);
    expect(defaultLock((5n * M).toString(), 3n * M)).toBe(2_250_000n * 10n ** 18n);
    expect(defaultLock((5n * M).toString(), 6n * M)).toBe(0n);
    expect(defaultLock(null, 0n)).toBe(0n);
    expect(parseRegi("1,234.5")).toBe(1_234_500_000_000_000_000_000n);
    expect([parseRegi("0"), parseRegi("-1"), parseRegi("1e6"), parseRegi("")]).toEqual([null, null, null, null]);
    expect(usdOf(5n * M, 1e-5)).toBe("≈ $50.00");
    expect(usdOf(5n * M, null)).toBeNull();
    const sel = (abi: readonly { name: string }[], name: string) => toFunctionSelector(abi.find((x) => x.name === name) as Parameters<typeof toFunctionSelector>[0]);
    expect(sel(LOCK_FACTORY_ABI, "lock")).toBe(toFunctionSelector("lock(uint256)"));
    expect(sel(LOCK_FACTORY_ABI, "lockedOf")).toBe(toFunctionSelector("lockedOf(address)"));
    expect(sel(LOCK_FACTORY_ABI, "vaultOf")).toBe(toFunctionSelector("vaultOf(address)"));
    expect(sel(VAULT_ABI, "withdraw")).toBe(toFunctionSelector("withdraw(uint256,address)"));
    expect(sel(VAULT_ABI, "claimRewards")).toBe(toFunctionSelector("claimRewards(address)"));
  });

  test("history: a position closed by a withdrawal says so", () => {
    const h = tables({ tab: "history", history: [{ id: 4, market: "abi", side: "long", margin: 100, lev: 2, notional: 200, entry: 1000, openedAt: 1, closedAt: 1_760_090_000, exit: 1010, pnl: 2, funding: 0, borrow: 0, fee: 0.04, returned: 101.9, net: 1.86, reason: "lock withdrawn" }] });
    expect(h).toContain(`>${PILOT_COPY.lockClosed}</td>`);
    expect(banned(visible(h))).toBeUndefined();
  });
});

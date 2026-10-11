/* eslint-disable @typescript-eslint/no-explicit-any -- tests mutate loosely typed JSON */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ABI_LIMITS, canonicalJson, sha256Hex, validateContracts, validateIndex, validateSeen } from "./builders-index";
import real from "./fixtures/builders-index.json";
import { indexFixture } from "./builders-index-fixture";

const bad = (mut: (d: Record<string, any>) => void) => { const d = indexFixture(); mut(d); return validateIndex(d); };

describe("validateIndex", () => {
  test("accepts a good file and keeps only the schema's fields", () => {
    const r = validateIndex(indexFixture());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.data).sort()).toEqual(["base", "events", "head_block", "head_time", "index", "index_24h_ago", "params", "projects", "series", "updated", "data_until", "candles", "tape", "roots_24h", "milestones", "stablecoins", "integrations", "integration_activity", "volume_24h", "live_fx"].sort());
      expect(r.data.series).toHaveLength(200);
    }
  });
  test("index_24h_ago and share_base may be null", () => {
    expect(bad((d) => { d.index_24h_ago = null; }).ok).toBe(true);
  });
  test.each([
    ["not an object", () => validateIndex([])],
    ["non-ISO time", () => bad((d) => { d.updated = "yesterday"; })],
    ["NaN level", () => bad((d) => { d.index = Number.NaN; })],
    ["Infinity in series", () => bad((d) => { d.series[3][1] = Infinity; })],
    ["string number", () => bad((d) => { d.index = "944" as unknown as number; })],
    ["bad sha", () => bad((d) => { d.base.sha256 = "xyz"; })],
    ["bad series entry", () => bad((d) => { d.series[0] = ["2026-10-02T01:00:00Z"]; })],
    ["fractional head_block", () => bad((d) => { d.head_block = 1.5; })],
    ["bad project", () => bad((d) => { d.projects[0].contracts = -1; })],
    ["bad kind", () => bad((d) => { d.events[0].kind = "other"; })],
    ["missing half life", () => bad((d) => { delete d.params.half_life_days; })],
    ["overlong name", () => bad((d) => { d.projects[0].name = "x".repeat(ABI_LIMITS.str + 1); })],
    ["too many projects", () => bad((d) => { d.projects = Array.from({ length: ABI_LIMITS.projects + 1 }, () => d.projects[1]); })],
    ["too many series points", () => bad((d) => { d.series = Array.from({ length: ABI_LIMITS.series + 1 }, () => d.series[0]); })],
    ["too many events", () => bad((d) => { d.events = Array.from({ length: ABI_LIMITS.events + 1 }, () => d.events[0]); })],
  ])("rejects: %s", (_n, run) => {
    expect(run().ok).toBe(false);
  });
  test("non-numeric params are dropped, not stored", () => {
    const r = bad((d) => { d.params.note = "hi"; d.params.big = Number.NaN; });
    expect(r.ok && Object.keys(r.data.params).includes("note")).toBe(false);
  });
});

describe("the live block", () => {
  test("the real producer file passes, with its live block kept", () => {
    const r = validateIndex(real);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.live?.hour_start).toBe(real.live.hour_start);
      expect(Object.keys(r.data.live!.contracts).length).toBeGreaterThan(100);
      expect(JSON.stringify(r.data).length).toBeLessThan(ABI_LIMITS.bytes);
    }
  });
  const mutate = (f: (l: any) => void) => { const d = JSON.parse(JSON.stringify(real)); f(d.live); return validateIndex(d); };
  test.each([
    ["no hour_start", (l: any) => { delete l.hour_start; }],
    ["NaN K", (l: any) => { l.K = Number.NaN; }],
    ["negative P", (l: any) => { l.P["base:arc"] = -1; }],
    ["bad contract address", (l: any) => { l.contracts["0xNOPE"] = "domain:x"; }],
    ["uppercase address", (l: any) => { l.contracts["0x" + "A".repeat(40)] = "domain:x"; }],
    ["bad deployer", (l: any) => { l.deployers["domain:argus.world"] = ["nope"]; }],
    ["huge base window", (l: any) => { l.base_window = 10 ** 9; }],
    ["base window over the RPC range limit", (l: any) => { l.base_window = 5001; }],
    ["zero seen prefix", (l: any) => { l.seen_prefix = 0; }],
  ])("rejects: %s", (_n, f) => {
    expect(mutate(f).ok).toBe(false);
  });
  test("too many contracts is refused", () => {
    expect(mutate((l) => { for (let i = 0; i < ABI_LIMITS.contracts + 1; i++) l.contracts["0x" + i.toString(16).padStart(40, "0")] = "domain:x"; }).ok).toBe(false);
  });
  test("a file without a live block is still valid", () => {
    expect(bad(() => undefined).ok).toBe(true);
  });
});

describe("validateSeen", () => {
  const good = { hour_start: 1791558000, seen: { "domain:argus.world": "0123456789abcdef0123", "domain:empty": "" } };
  test("accepts concatenated 10-hex prefixes", () => {
    expect(validateSeen(good)).toEqual({ ok: true, data: good });
  });
  test.each([
    ["not an object", []],
    ["no hour_start", { seen: {} }],
    ["uppercase hex", { hour_start: 1, seen: { a: "ABCDEF0123" } }],
    ["non-hex", { hour_start: 1, seen: { a: "zzzzzzzzzz" } }],
    ["length not a multiple of 10", { hour_start: 1, seen: { a: "0123456789a" } }],
    ["non-string value", { hour_start: 1, seen: { a: 5 } }],
    ["seen not an object", { hour_start: 1, seen: [] }],
  ])("rejects: %s", (_n, v) => {
    expect(validateSeen(v).ok).toBe(false);
  });
  test("too many sources", () => {
    const seen = Object.fromEntries(Array.from({ length: ABI_LIMITS.seenSources + 1 }, (_, i) => [`s${i}`, ""]));
    expect(validateSeen({ hour_start: 1, seen }).ok).toBe(false);
  });
});

describe("terminal keys: candles, tape, roots_24h, per-project and per-event stats", () => {
  const real2 = () => JSON.parse(JSON.stringify(real));
  const run = (f: (d: any) => void) => { const d = real2(); f(d); return validateIndex(d); };
  test("the real file keeps all of them", () => {
    const r = validateIndex(real);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.candles.length).toBe(real.candles.length);
      expect(r.data.tape.length).toBe(real.tape.length);
      expect(Object.keys(r.data.roots_24h).length).toBe(Object.keys(real.roots_24h).length);
      expect(r.data.projects[1]).toMatchObject({ pts_1h: expect.any(Number), pts_24h: expect.any(Number), pay_24h: expect.any(Number), usdc_24h: expect.any(Number) });
      expect(r.data.events.find((e) => e.kind === "activity")!.usdc).toBeGreaterThan(0);
    }
  });
  test("a file without them still validates, with zero defaults", () => {
    const r = validateIndex(indexFixture());
    expect(r.ok && r.data.candles).toEqual([]);
    expect(r.ok && r.data.projects[0]).toMatchObject({ pts_1h: 0, pts_24h: 0, pay_24h: 0, usdc_24h: 0 });
  });
  test.each([
    ["candle with a missing field", (d: any) => { d.candles[0] = d.candles[0].slice(0, 7); }],
    ["candle with NaN", (d: any) => { d.candles[0][2] = Number.NaN; }],
    ["candle with a non-positive price", (d: any) => { d.candles[0][3] = 0; }],
    ["candle with fractional payments", (d: any) => { d.candles[0][5] = 1.5; }],
    ["candle with negative USDC", (d: any) => { d.candles[0][6] = -1; }],
    ["candles not an array", (d: any) => { d.candles = {}; }],
    ["tape with a bad flag", (d: any) => { d.tape[0][4] = 2; }],
    ["tape with a non-ISO time", (d: any) => { d.tape[0][0] = "soon"; }],
    ["tape with negative USDC", (d: any) => { d.tape[0][2] = -0.1; }],
    ["tape with a long source", (d: any) => { d.tape[0][1] = "x".repeat(ABI_LIMITS.str + 1); }],
    ["project with a string stat", (d: any) => { d.projects[1].pts_24h = "12"; }],
    ["project with fractional payments", (d: any) => { d.projects[1].pay_24h = 2.5; }],
    ["event with negative usdc", (d: any) => { d.events[0].usdc = -3; }],
    ["roots_24h with a negative root", (d: any) => { d.roots_24h["base:arc"] = -1; }],
    ["roots_24h as an array", (d: any) => { d.roots_24h = []; }],
  ])("rejects: %s", (_n, f) => {
    expect(run(f).ok).toBe(false);
  });
  test("row counts are bounded", () => {
    expect(run((d) => { d.candles = Array.from({ length: ABI_LIMITS.candles + 1 }, () => d.candles[0]); }).ok).toBe(false);
    expect(run((d) => { d.tape = Array.from({ length: ABI_LIMITS.tape + 1 }, () => d.tape[0]); }).ok).toBe(false);
    expect(run((d) => { d.tape = Array.from({ length: ABI_LIMITS.tape }, () => d.tape[0]); }).ok).toBe(true);
  });
});

describe("milestones, stablecoins, volume_24h, live_fx (spec §12, §13)", () => {
  const REF_FILE = "/Users/tobiasd/Desktop/arc/research/arc-builders-index/terminal/data/index.json";
  const EURC = "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1";
  const ccys = (n: number) => Array.from({ length: n }, (_, i) => "C" + String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
  const ecbRow = () => Object.fromEntries(["EUR", "JPY", "GBP", "MXN", "AUD", "CHF", "SEK", "TRY", "ZAR", "CAD", "BRL", "KRW", "CZK", "DKK", "HUF", "PLN", "RON", "ISK", "NOK", "CNY", "HKD", "IDR", "ILS", "INR", "MYR", "NZD", "PHP", "SGD", "THB"].map((c, i) => [c, 0.5 + i / 100]));
  const full = () => {
    const d: Record<string, any> = indexFixture();
    d.milestones = [
      { id: "20261010-063000-arc-upgrade", t: 1791613800, target: "base:arc", tier: "arc-upgrade", mult: 1.25, title: "Arc v1.2 network upgrade activated", evidence: ["https://docs.arc.io/arc/upgrades", "0x" + "AB".repeat(32)], recorded_by: "someone" },
      { id: "20261010-064500-project-release", t: 1791614700, target: "domain:argus.world", tier: "project-release", mult: 1.1, title: "Argus v2 contracts", evidence: ["0x07A688A001F416CC433C68FF56AA26BC5131CC6E"] },
    ];
    d.stablecoins = [{ symbol: "EURC", currency: "EUR", issuer: "Circle", address: EURC, decimals: 6, added: 1791619200, evidence: ["https://x.io"] }, { symbol: "wARS", currency: "ARS", issuer: "Ripio", address: "0x" + "1".repeat(40), decimals: 18, added: 1791619200 }];
    d.volume_24h = { USDC: { members_usd: 28317.33, members_payments: 7913, base_usd_est: 0.0, base_transfers_est: 0 }, EURC: { members_usd: 12.5, members_payments: 2, base_usd_est: 3000, base_transfers_est: 30.0 } };
    d.live_fx = { "2026-10-08": ecbRow(), "2026-10-09": ecbRow() };
    return d;
  };
  const run = (f: (d: Record<string, any>) => void) => { const d = full(); f(d); return validateIndex(d); };

  test("kept as published; evidence normalised; unknown fields dropped; ECB table cut to the registry's currencies", () => {
    const r = validateIndex(full());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.milestones).toEqual([
      { id: "20261010-063000-arc-upgrade", t: 1791613800, target: "base:arc", tier: "arc-upgrade", mult: 1.25, title: "Arc v1.2 network upgrade activated", evidence: ["https://docs.arc.io/arc/upgrades", "0x" + "ab".repeat(32)] },
      { id: "20261010-064500-project-release", t: 1791614700, target: "domain:argus.world", tier: "project-release", mult: 1.1, title: "Argus v2 contracts", evidence: ["0x07a688a001f416cc433c68ff56aa26bc5131cc6e"] },
    ]);
    expect(r.data.stablecoins[0]).toEqual({ symbol: "EURC", currency: "EUR", issuer: "Circle", address: EURC, decimals: 6, added: 1791619200 });
    expect(r.data.volume_24h.EURC).toEqual({ members_usd: 12.5, members_payments: 2, base_usd_est: 3000, base_transfers_est: 30 });
    expect(r.data.live_fx["2026-10-08"]).toEqual({ EUR: 0.5 }); // ARS is not an ECB currency: nothing to keep for it
  });
  test("a file without them validates with empty defaults", () => {
    const r = validateIndex(indexFixture());
    expect(r.ok && { m: r.data.milestones, s: r.data.stablecoins, v: r.data.volume_24h, f: r.data.live_fx }).toEqual({ m: [], s: [], v: {}, f: {} });
  });
  test("live.stablecoins is kept and feeds the currencies kept from live_fx", () => {
    const d = JSON.parse(JSON.stringify(real));
    d.live.stablecoins = { [EURC]: { symbol: "EURC", currency: "EUR", decimals: 6, added: 1791619200, extra: 1 }, ["0x" + "2".repeat(40)]: { symbol: "JPYC", currency: "JPY", decimals: 18, added: 1791619200 } };
    d.live_fx = { "2026-10-09": ecbRow() };
    const r = validateIndex(d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.live!.stablecoins![EURC]).toEqual({ symbol: "EURC", currency: "EUR", decimals: 6, added: 1791619200 });
    expect(Object.keys(r.data.live_fx["2026-10-09"]).sort()).toEqual(["EUR", "JPY"]);
  });
  test("integrations (§14): valid rows kept, malformed rows dropped without failing the push, absent = []", () => {
    const ok = { company: "MoonPay", category: "on/off-ramp", status: "live", first_announced: "2025-10-28", link: "https://www.moonpay.com/newsroom", member: "domain:moonpay.com", milestone_id: "20261010-120000-integration" };
    const r = run((d) => {
      d.integrations = [ok, { ...ok, company: "Kraken", status: "announced", link: null, member: null, milestone_id: null, extra: 1 },
        { ...ok, company: "Bad status", status: "rumoured" }, { ...ok, company: "Bad date", first_announced: "Oct 2025" },
        { ...ok, company: "Bad link", link: "javascript:alert(1)" }, { ...ok, company: "x".repeat(81) }, { ...ok, company: "Bad\nline" }, "junk", null];
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.integrations).toEqual([ok, { ...ok, company: "Kraken", status: "announced", link: null, member: null, milestone_id: null }]);
    const big = run((d) => { d.integrations = Array.from({ length: ABI_LIMITS.integrations + 5 }, (_, i) => ({ ...ok, company: `C${i}` })); });
    expect(big.ok && big.data.integrations.length).toBe(ABI_LIMITS.integrations);
    for (const v of ["nope", undefined]) {
      const n = run((d) => { d.integrations = v; });
      expect(n.ok && n.data.integrations).toEqual([]);
    }
  });
  test("§15: live.open_senders deduped and sorted; projects[].kind kept or derived", () => {
    const d = JSON.parse(JSON.stringify(real));
    const a = "0x" + "7".repeat(40), b = "0x" + "1".repeat(40);
    d.live.open_senders = [a, b, a];
    const i = d.projects.findIndex((p: { base_layer: boolean }) => !p.base_layer);
    d.projects[i].kind = "integration";
    const r = validateIndex(d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.live!.open_senders).toEqual([b, a]);
    expect(r.data.projects[i].kind).toBe("integration");
    expect(r.data.projects.filter((p) => p.base_layer).every((p) => p.kind === "base")).toBe(true);
    expect(validateIndex(real).ok && (validateIndex(real) as { data: { live: object } }).data.live).not.toHaveProperty("open_senders");
  });
  test.each([
    ["open_senders not an array", (d: any) => { d.live.open_senders = "0x" + "7".repeat(40); }],
    ["open_senders uppercase", (d: any) => { d.live.open_senders = ["0x" + "A".repeat(40)]; }],
    ["open_senders too many", (d: any) => { d.live.open_senders = Array.from({ length: ABI_LIMITS.openSenders + 1 }, (_, i) => "0x" + i.toString(16).padStart(40, "0")); }],
    ["unknown project kind", (d: any) => { d.projects[0].kind = "partner"; }],
  ])("§15 rejected: %s", (_n, f) => {
    const d = JSON.parse(JSON.stringify(real)); f(d);
    const r = validateIndex(d);
    expect(r.ok && !!r.data.live).toBe(false);
  });
  test("integration_activity (§14): wallets and contracts shapes kept; malformed dropped; absent = {}", () => {
    const relay = { source: "wallets", wallets: 15, out_usd: 28.3e6, out_transfers: 2682, recipients: 727, in_usd: 28.5e6, in_transfers: 900, senders: 40 };
    const uni = { source: "contracts", payments: 1200, usd_in: 4.2e6, points: 310.5, payers_hourly_sum: 800 };
    const r = run((d) => {
      d.integration_activity = { Relay: { ...relay, extra: 1 }, Uniswap: uni, Neg: { ...uni, usd_in: -1 }, Str: { ...uni, payments: "5" }, Missing: { source: "wallets", wallets: 1 },
        Other: { ...uni, source: "guess" }, "Bad\nname": uni, Junk: 5 };
    });
    expect(r.ok && r.data.integration_activity).toEqual({ Relay: relay, Uniswap: uni });
    for (const v of [undefined, [], "x"]) {
      const n = run((d) => { d.integration_activity = v; });
      expect(n.ok && n.data.integration_activity).toEqual({});
    }
  });
  const moonpay = () => ({ id: "20261010-120000-integration", t: 1791633600, target: "base:arc", tier: "integration", mult: 1.0508, title: "MoonPay live on Arc", evidence: ["https://www.moonpay.com/newsroom"], company: "MoonPay", revenue_usd: 108e6, revenue_kind: "estimate" });
  test("integration milestones (§14) keep company and revenue", () => {
    const r = run((d) => { d.milestones.push(moonpay()); });
    expect(r.ok && r.data.milestones[2]).toEqual(moonpay());
  });
  test.each([
    ["integration above ×1.10", (m: any) => { m.mult = 1.11; }],
    ["integration on a member", (m: any) => { m.target = "domain:argus.world"; }],
    ["company too long", (m: any) => { m.company = "x".repeat(61); }],
    ["company with a newline", (m: any) => { m.company = "Moon\nPay"; }],
    ["revenue zero", (m: any) => { m.revenue_usd = 0; }],
    ["revenue as a string", (m: any) => { m.revenue_usd = "108000000"; }],
    ["revenue without kind", (m: any) => { delete m.revenue_kind; }],
    ["kind without revenue", (m: any) => { delete m.revenue_usd; }],
    ["unknown revenue kind", (m: any) => { m.revenue_kind = "guess"; }],
  ])("integration rejected: %s", (_n, f) => {
    expect(run((d) => { const m = moonpay(); f(m); d.milestones.push(m); }).ok).toBe(false);
  });
  test.each([
    ["unknown tier", (d: any) => { d.milestones[0].tier = "partnership"; }],
    ["base tier on a member", (d: any) => { d.milestones[0].target = "domain:argus.world"; }],
    ["member tier on the base layer", (d: any) => { d.milestones[1].target = "base:arc"; }],
    ["multiplier 1", (d: any) => { d.milestones[0].mult = 1; }],
    ["multiplier above 2", (d: any) => { d.milestones[0].mult = 3; }],
    ["string multiplier", (d: any) => { d.milestones[0].mult = "1.25"; }],
    ["fractional time", (d: any) => { d.milestones[0].t = 1.5; }],
    ["bad id", (d: any) => { d.milestones[0].id = "<b>x</b>"; }],
    ["no evidence", (d: any) => { d.milestones[0].evidence = []; }],
    ["too much evidence", (d: any) => { d.milestones[0].evidence = Array.from({ length: ABI_LIMITS.evidencePer + 1 }, () => "https://docs.arc.io/"); }],
    ["javascript: evidence", (d: any) => { d.milestones[0].evidence = ["javascript:alert(1)"]; }],
    ["http evidence", (d: any) => { d.milestones[0].evidence = ["http://docs.arc.io/"]; }],
    ["credentials in evidence", (d: any) => { d.milestones[0].evidence = ["https://user:pw@docs.arc.io/"]; }],
    ["short hex evidence", (d: any) => { d.milestones[0].evidence = ["0x1234"]; }],
    ["title too long", (d: any) => { d.milestones[0].title = "x".repeat(ABI_LIMITS.milestoneTitle + 1); }],
    ["title with a line break", (d: any) => { d.milestones[0].title = "a\nb"; }],
    ["too many milestones", (d: any) => { d.milestones = Array.from({ length: ABI_LIMITS.milestones + 1 }, () => d.milestones[0]); }],
    ["milestones not an array", (d: any) => { d.milestones = {}; }],
    ["coin with a checksum-case address", (d: any) => { d.stablecoins[0].address = "0xBEF5f6d51cb62b58e6a8f77868681825c6fe21c1"; }],
    ["coin with 40 decimals", (d: any) => { d.stablecoins[0].decimals = 40; }],
    ["coin with a bad currency", (d: any) => { d.stablecoins[0].currency = "euro"; }],
    ["coin with a bad symbol", (d: any) => { d.stablecoins[0].symbol = "EUR C"; }],
    ["too many coins", (d: any) => { d.stablecoins = Array.from({ length: ABI_LIMITS.stablecoins + 1 }, () => d.stablecoins[0]); }],
    ["negative volume", (d: any) => { d.volume_24h.EURC.members_usd = -1; }],
    ["volume with a bad key", (d: any) => { d.volume_24h["<x>"] = {}; }],
    ["too many volume coins", (d: any) => { for (let i = 0; i < ABI_LIMITS.volumeCoins; i++) d.volume_24h["X" + i] = { members_usd: 1 }; }],
    ["too many fx dates", (d: any) => { for (let i = 10; i < 21; i++) d.live_fx[`2026-09-${i}`] = { EUR: 1.1 }; }],
    ["fx with a bad date", (d: any) => { d.live_fx["9 Oct"] = { EUR: 1.1 }; }],
    ["fx with a zero rate", (d: any) => { d.live_fx["2026-10-08"].EUR = 0; }],
    ["fx with a string rate", (d: any) => { d.live_fx["2026-10-08"].EUR = "1.1"; }],
    ["live.stablecoins with a bad address", (d: any) => { d.live = JSON.parse(JSON.stringify(real.live)); d.live.stablecoins = { "0xabc": { symbol: "EURC", currency: "EUR", decimals: 6, added: 1 } }; }],
    ["live.stablecoins without added", (d: any) => { d.live = JSON.parse(JSON.stringify(real.live)); d.live.stablecoins = { [EURC]: { symbol: "EURC", currency: "EUR", decimals: 6 } }; }],
  ])("rejects: %s", (_n, f) => {
    expect(run(f).ok).toBe(false);
  });
  test("at most 20 registry currencies per fx date", () => {
    const withN = (n: number) => run((d) => {
      d.stablecoins = ccys(n).map((c, i) => ({ symbol: "S" + i, currency: c, issuer: "x", address: "0x" + i.toString(16).padStart(40, "0"), decimals: 6, added: 1 }));
      d.live_fx = { "2026-10-08": Object.fromEntries(ccys(n).map((c) => [c, 1])) };
    });
    expect(withN(ABI_LIMITS.fxCurrencies).ok).toBe(true);
    expect(withN(ABI_LIMITS.fxCurrencies + 1).ok).toBe(false);
  });
  test.skipIf(!existsSync(REF_FILE))("the reference producer file (stablecoins, volume_24h, live_fx, live.stablecoins) passes", () => {
    const ref = JSON.parse(readFileSync(REF_FILE, "utf8"));
    const r = validateIndex(ref);
    expect(r.ok ? "ok" : r.error).toBe("ok");
    if (!r.ok) return;
    expect(r.data.stablecoins.map((c) => c.symbol)).toEqual(ref.stablecoins.map((c: { symbol: string }) => c.symbol));
    expect(Object.keys(r.data.live!.stablecoins!)).toEqual(Object.keys(ref.live.stablecoins));
    expect(r.data.volume_24h).toEqual(ref.volume_24h);
    expect(r.data.milestones).toEqual(ref.milestones);
    const kept = new Set(ref.stablecoins.map((c: { currency: string }) => c.currency));
    for (const [day, row] of Object.entries(r.data.live_fx)) for (const c of kept) if (ref.live_fx[day][c as string] !== undefined) expect(row[c as string]).toBe(ref.live_fx[day][c as string]);
  });
});

const SAMPLES = "/Users/tobiasd/Desktop/arc/research/arc-builders-index/samples";
describe.skipIf(!existsSync(SAMPLES))("§17 producer samples (AII, AEI)", () => {
  test.each(["aii", "aei"])("%s: index and seen validate and share the open hour", (id) => {
    const ix = validateIndex(JSON.parse(readFileSync(`${SAMPLES}/${id}-index.json`, "utf8")));
    const seen = validateSeen(JSON.parse(readFileSync(`${SAMPLES}/${id}-seen.json`, "utf8")));
    expect(ix.ok ? "ok" : ix.error).toBe("ok");
    expect(seen.ok ? "ok" : seen.error).toBe("ok");
    if (!ix.ok || !seen.ok) return;
    expect(seen.data.hour_start).toBe(ix.data.live!.hour_start);
    expect(ix.data.projects.some((p) => p.kind === "integration")).toBe(true);
    if (id === "aii") expect(ix.data.live!.base_k).toBe(0);
  });
});

describe('"close the gaps": the separate contract map', () => {
  const doc = () => ({
    hour_start: 1791666000,
    open_senders: ["0x1111111111111111111111111111111111111111", "0x7777777777777777777777777777777777777777"],
    contracts: { "0x7777777777777777777777777777777777777777": "integration:uniswap", "0x07a688a001f416cc433c68ff56aa26bc5131cc6e": "domain:argus.world", "0x1111111111111111111111111111111111111111": "integration:relay" },
  });
  test("sha256 of the canonical JSON equals Python's json.dumps(sort_keys=True, separators=(',', ':'))", async () => {
    // python3: hashlib.sha256(json.dumps(o, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    const { contracts, open_senders } = doc();
    expect(await sha256Hex(canonicalJson({ contracts, open_senders }))).toBe("5339ede5ce5319bbb6855ff0cc2eba3d72808bcd4e43f816855e1a5d146ea263");
  });
  test("a valid map passes; open senders must be sorted, unique and in the map", () => {
    expect(validateContracts(doc()).ok).toBe(true);
    for (const f of [
      (d: any) => { d.open_senders.reverse(); },
      (d: any) => { d.open_senders.push(d.open_senders[1]); },
      (d: any) => { d.open_senders.push("0x9999999999999999999999999999999999999999"); },
      (d: any) => { d.contracts["0xABCDEF0000000000000000000000000000000000"] = "x"; },
      (d: any) => { d.hour_start = 1.5; },
      (d: any) => { d.contracts = Object.fromEntries(Array.from({ length: ABI_LIMITS.contractsFile + 1 }, (_, i) => ["0x" + i.toString(16).padStart(40, "0"), "x"])); d.open_senders = []; },
    ]) { const d = doc(); f(d); expect(validateContracts(d).ok).toBe(false); }
  });
  test("an index may pin the map instead of carrying it: sha and count required, inline map dropped", () => {
    const d = JSON.parse(JSON.stringify(real));
    delete d.live.contracts; delete d.live.open_senders;
    d.live.contracts_sha256 = "a".repeat(64); d.live.contracts_count = 11604;
    const r = validateIndex(d);
    expect(r.ok && [r.data.live!.contracts, r.data.live!.contracts_sha256, r.data.live!.contracts_count]).toEqual([{}, "a".repeat(64), 11604]);
    for (const bad of [{ contracts_sha256: "xyz" }, { contracts_count: undefined }, { contracts_sha256: undefined }]) {
      const b = JSON.parse(JSON.stringify(d)); Object.assign(b.live, bad);
      if (bad.contracts_sha256 === undefined && "contracts_sha256" in bad) delete b.live.contracts_sha256;
      if ("contracts_count" in bad && bad.contracts_count === undefined) delete b.live.contracts_count;
      const v = validateIndex(b);
      expect(v.ok && !!v.data.live).toBe(false);
    }
  });
});

test("audit L11: an integration link written as '<url> — note (date)' keeps only the URL", () => {
  const d = JSON.parse(JSON.stringify(real));
  d.integrations = [{ company: "Kraken", category: "exchange", status: "live", first_announced: "2025-10-28", link: "https://blog.kraken.com/news/arc — Kraken blog: USDC on Arc (2026-09-16)", member: null, milestone_id: null }];
  const r = validateIndex(d);
  expect(r.ok && r.data.integrations[0].link).toBe("https://blog.kraken.com/news/arc");
});

test("audit F1 params in live: kept when non-negative numbers, the block refused otherwise", () => {
  const d = JSON.parse(JSON.stringify(real));
  Object.assign(d.live, { min_pay: 0, new_payer_min: 10, new_payer_max_h: 25, entry_step: 0.001 / 24 });
  const r = validateIndex(d);
  expect(r.ok && [r.data.live!.min_pay, r.data.live!.new_payer_min, r.data.live!.new_payer_max_h, r.data.live!.entry_step]).toEqual([0, 10, 25, 0.001 / 24]);
  const b = JSON.parse(JSON.stringify(d)); b.live.new_payer_min = -1;
  const v = validateIndex(b);
  expect(v.ok && !!v.data.live).toBe(false);
});

test("§18: live.contracts_add accepted as lowercase address -> source, capped", () => {
  const d = JSON.parse(JSON.stringify(real));
  d.live.contracts_add = { ["0x" + "7".repeat(40)]: "integration:uniswap" };
  const r = validateIndex(d);
  expect(r.ok && r.data.live!.contracts_add).toEqual({ ["0x" + "7".repeat(40)]: "integration:uniswap" });
  for (const bad of [{ ["0x" + "A".repeat(40)]: "x" }, { ["0x" + "7".repeat(40)]: 5 }, Object.fromEntries(Array.from({ length: ABI_LIMITS.contractsAdd + 1 }, (_, i) => ["0x" + i.toString(16).padStart(40, "0"), "x"]))]) {
    const b = JSON.parse(JSON.stringify(d)); b.live.contracts_add = bad;
    const v = validateIndex(b);
    expect(v.ok && !!v.data.live).toBe(false);
  }
});

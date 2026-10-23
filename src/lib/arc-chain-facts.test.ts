import { describe, expect, test } from "vitest";
import raw from "../data/arc-chain-facts.json";
import { validateChainFacts } from "./arc-chain-facts";

const good = {
  reviewed: "2026-10-23",
  facts: [{ id: "mainnet", text: "Arc mainnet launched on 16 September 2026.", source: "https://www.arc.io/x", date: "2026-09-16" }],
  network: { rpc_url: "https://rpc.mainnet.arc.io", rpc_source: "https://docs.arc.io/a", explorer_url: "https://explorer.arc.io", explorer_source: "https://docs.arc.io/b" },
  stablecoins: [{ symbol: "USDC", name: "USD Coin", issuer: "Circle", address: "0x3600000000000000000000000000000000000000" as string | null, decimals: 6, source: "https://docs.arc.io/c" },
    { symbol: "XYZ", name: "X", issuer: "Y", address: null as string | null, decimals: 6, source: "https://www.arc.io/x" }],
};

describe("chain facts", () => {
  test("a good file passes", () => expect(validateChainFacts(good).ok).toBe(true));
  test("rejects http sources, bad dates, long sentences, duplicate ids and symbols, bad addresses and decimals", () => {
    const bad = structuredClone(good);
    bad.facts.push({ id: "mainnet", text: "x".repeat(201), source: "http://a.b/", date: "16 Sep" });
    bad.stablecoins.push({ symbol: "USDC", name: "", issuer: "", address: "0x12", decimals: 99, source: "ftp://x" });
    const r = validateChainFacts(bad);
    expect(r.ok).toBe(false);
    const errs = (r as { errors: string[] }).errors.join("\n");
    for (const m of ["duplicate id", "200 characters", "https", "YYYY-MM-DD", "duplicate symbol", "address", "decimals"]) expect(errs).toContain(m);
  });
  test("the published file is valid, has the five required facts, USDC and EURC with addresses", () => {
    const r = validateChainFacts(raw);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const f = (r as { facts: { facts: { id: string }[]; stablecoins: { symbol: string; address: string | null }[] } }).facts;
    expect(f.facts.map((x) => x.id)).toEqual(expect.arrayContaining(["mainnet", "gas", "evm", "validators", "token"]));
    for (const s of ["USDC", "EURC"]) expect(f.stablecoins.find((t) => t.symbol === s)?.address).toMatch(/^0x[0-9a-f]{40}$/);
  });
  test("review: the ARC token fact follows Circle's wording (a genesis mint that week, not the chain's genesis)", () => {
    const t = (raw as { facts: { id: string; text: string }[] }).facts.find((f) => f.id === "token")!.text;
    expect(t).toContain("genesis mint");
    expect(t).not.toMatch(/at genesis/);
  });
  test("the comparison facts are present and sourced", () => {
    const r = validateChainFacts(raw);
    const ids = ((r as { facts: { comparison?: { id: string }[] } }).facts.comparison ?? []).map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(["fee-currency-arc", "fee-currency-ethereum", "fee-currency-solana", "solana-base-fee", "finality-arc", "finality-ethereum", "finality-solana"]));
  });
});


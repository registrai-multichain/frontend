import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { findPayment, markFailed, markSettled, reserve, salesStats } from "../lib/x402-ledger";
import { PRODUCTS, formatUsd, readX402Config } from "../lib/x402-config";
import { MemoryD1 } from "./memory-d1";

const db = () => new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
const P = { scheme: "eip3009" as const, payer: "0xabc", nonce: "0x01", product: "events", amount: 10000 };

describe("x402 config", () => {
  test("unconfigured without a valid payTo; standard path only with a settler key; testnet switch", () => {
    expect(readX402Config({} as never)).toBeNull();
    expect(readX402Config({ X402_PAY_TO: "nope" } as never)).toBeNull();
    const c = readX402Config({ X402_PAY_TO: "0x000000000000000000000000000000000000dEaD" } as never)!;
    expect(c).toMatchObject({ network: "arc", caip2: "eip155:5042", facilitator: "https://gateway-api.circle.com", settlerKey: null });
    expect(readX402Config({ X402_PAY_TO: "0x000000000000000000000000000000000000dEaD", X402_NETWORK: "arcTestnet" } as never)!.caip2).toBe("eip155:5042002");
    expect(formatUsd(PRODUCTS.events.standard)).toBe("$0.01");
    expect(PRODUCTS.members_day).toMatchObject({ gateway: 30000n, standard: 50000n });
  });
});

describe("x402 ledger", () => {
  test("a nonce is reserved once; a duplicate (even concurrent) is refused", async () => {
    const d = db();
    const [a, b] = await Promise.all([reserve(d, P), reserve(d, P)]);
    expect([a, b].sort()).toEqual(["duplicate", "ok"]);
  });
  test("settle and fail transitions; stats aggregate settled sales only, no payer", async () => {
    const d = db();
    await reserve(d, P); await markSettled(d, "eip3009", "0xabc", "0x01", "0xtx");
    expect(await findPayment(d, "eip3009", "0xabc", "0x01")).toMatchObject({ status: "settled", tx_hash: "0xtx", product: "events" });
    await reserve(d, { ...P, nonce: "0x02" }); await markFailed(d, "eip3009", "0xabc", "0x02", "failed");
    const s = await salesStats(d);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ product: "events", sales: 1, usdc: 0.01 });
    expect(JSON.stringify(s)).not.toContain("0xabc");
  });
});

test("the settler key is accepted with or without 0x, quotes or surrounding whitespace", () => {
  const PAY = "0x000000000000000000000000000000000000dEaD", K = "ab".repeat(32);
  for (const v of [K, `0x${K}`, `"0x${K}"`, `'${K}'`, `  0x${K}\n`]) expect(readX402Config({ X402_PAY_TO: PAY, X402_SETTLER_KEY: v } as never)!.settlerKey, v).toBe(`0x${K}`);
  expect(readX402Config({ X402_PAY_TO: PAY, X402_SETTLER_KEY: "nothex" } as never)!.settlerKey).toBeNull();
});

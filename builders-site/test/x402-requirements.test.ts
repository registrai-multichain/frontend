import { describe, expect, test, vi } from "vitest";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { gatewayExtra, paymentRequired, respond402 } from "../lib/x402-requirements";
import { readX402Config } from "../lib/x402-config";

const PAY = "0x000000000000000000000000000000000000dEaD";
const KEY = "0x" + "11".repeat(32);
const GW = { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" };
const DOMAIN = { name: "USDC", version: "2" };
const URL = "https://builder.registrai.cc/api/v1/paid/events";

describe("402 requirements", () => {
  test("both accepts when the settler key is set: gateway first, then EIP-3009, exact micro-USDC amounts", () => {
    const cfg = readX402Config({ X402_PAY_TO: PAY, X402_SETTLER_KEY: KEY } as never)!;
    const pr = paymentRequired("events", URL, cfg, GW, DOMAIN);
    expect(pr.x402Version).toBe(2);
    expect(pr.resource).toMatchObject({ url: URL, mimeType: "application/json" });
    expect(pr.accepts.map((a) => [a.scheme, a.network, a.amount, a.payTo, a.asset])).toEqual([
      ["exact", "eip155:5042", "2000", PAY, "0x3600000000000000000000000000000000000000"],
      ["exact", "eip155:5042", "10000", PAY, "0x3600000000000000000000000000000000000000"],
    ]);
    expect(pr.accepts[0].extra).toEqual(GW);
    expect(pr.accepts[1].extra).toEqual(DOMAIN);
    expect(pr.accepts.every((a) => a.maxTimeoutSeconds === 300)).toBe(true);
  });
  test("no settler key: Circle only; no Circle kind: EIP-3009 only", () => {
    const noKey = readX402Config({ X402_PAY_TO: PAY } as never)!;
    expect(paymentRequired("events", URL, noKey, GW, DOMAIN).accepts).toHaveLength(1);
    const withKey = readX402Config({ X402_PAY_TO: PAY, X402_SETTLER_KEY: KEY } as never)!;
    const pr = paymentRequired("contract", URL, withKey, null, DOMAIN);
    expect(pr.accepts.map((a) => a.amount)).toEqual(["10000"]);
  });
  test("respond402: status, CORS, no-store, and the PAYMENT-REQUIRED header decodes to the body", async () => {
    const cfg = readX402Config({ X402_PAY_TO: PAY, X402_SETTLER_KEY: KEY } as never)!;
    const r = respond402(paymentRequired("events", URL, cfg, GW, DOMAIN), "Payment required");
    expect(r.status).toBe(402);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = await r.json();
    expect(decodePaymentRequiredHeader(r.headers.get("PAYMENT-REQUIRED")!)).toEqual(body);
    expect(body.error).toBe("Payment required");
  });
  test("gatewayExtra picks the Arc GatewayWalletBatched kind; a facilitator error gives null, not a throw", async () => {
    const cfg = readX402Config({ X402_PAY_TO: PAY } as never)!;
    const supported = async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:1", extra: { name: "GatewayWalletBatched" } }, { x402Version: 2, scheme: "exact", network: "eip155:5042", extra: GW }], extensions: [], signers: {} });
    expect(await gatewayExtra(cfg, supported, true)).toEqual(GW);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await gatewayExtra(cfg, async () => { throw new Error("down"); }, true)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

import { describe, expect, test } from "vitest";
import { encodeAbiParameters, type Hex } from "viem";
import { formatSupply, regiSupply } from "../../src/lib/regi-supply";
import { handleRegiSupply, withLastGood, type FetchRpc } from "../lib/supply";

const E18 = 10n ** 18n;
const u = (v: bigint) => encodeAbiParameters([{ type: "uint256" }], [v]);

describe("regiSupply", () => {
  test("circulating = total - burned (0x…dEaD) - protocol wallets; total net of the burn", () => {
    const s = regiSupply({ total: 1_000_000_000n * E18, burned: 35_654_637n * E18, protocol: 1_000n * E18 });
    expect(s.circulating).toBe((1_000_000_000n - 35_654_637n - 1_000n) * E18);
    expect(s.totalNetOfBurn).toBe((1_000_000_000n - 35_654_637n) * E18);
  });
  test("formatSupply: plain decimal REGI, trailing zeros trimmed", () => {
    expect(formatSupply(964_345_362n * E18 + 379_610_946_976_357_510n)).toBe("964345362.37961094697635751");
    expect(formatSupply(5n * E18)).toBe("5");
    expect(formatSupply(1n)).toBe("0.000000000000000001");
  });
});

/** A fake JSON-RPC: answers a batch of eth_calls by the call's `data` prefix and holder. */
function rpc(values: { total: bigint; balances: Record<string, bigint> }, fail = false) {
  const calls: unknown[] = [];
  const fetchRpc = async (body: { id: number; params: [{ data: Hex }] }[]) => {
    calls.push(body);
    if (fail) throw new Error("429");
    return body.map((c) => {
      const data = c.params[0].data;
      if (data.startsWith("0x18160ddd")) return { jsonrpc: "2.0", id: c.id, result: u(values.total) };
      const holder = `0x${data.slice(-40)}`.toLowerCase();
      return { jsonrpc: "2.0", id: c.id, result: u(values.balances[holder] ?? 0n) };
    });
  };
  return { fetchRpc: fetchRpc as unknown as FetchRpc, calls };
}

const DEAD = "0x000000000000000000000000000000000000dead";

describe("GET /api/regi/<kind>", () => {
  const values = { total: 1_000_000_000n * E18, balances: { [DEAD]: 35_654_637n * E18 + 620_389_053_023_642_490n } };

  test("circulating-supply: the plain number CoinGecko reads", async () => {
    const r = await handleRegiSupply("circulating-supply", rpc(values).fetchRpc);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/plain/);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(await r.text()).toBe("964345362.37961094697635751");
  });

  test("total-supply: net of the burn", async () => {
    const r = await handleRegiSupply("total-supply", rpc(values).fetchRpc);
    expect(await r.text()).toBe("964345362.37961094697635751");
  });

  test("supply: the breakdown as JSON, with the burn address and the protocol wallets named", async () => {
    const r = await handleRegiSupply("supply", rpc(values).fetchRpc);
    const j = (await r.json()) as Record<string, unknown>;
    expect(j).toMatchObject({ token: expect.stringMatching(/^0x93d5/i), burnAddress: expect.stringMatching(/dead$/i), total: "1000000000", burned: "35654637.62038905302364249", protocol: "0", circulating: "964345362.37961094697635751" });
    expect((j.protocolWallets as unknown[]).length).toBeGreaterThan(0);
  });

  test("one rate-limited answer is retried once", async () => {
    const ok = rpc(values).fetchRpc;
    let n = 0;
    const flaky: FetchRpc = async (body) => (n++ === 0 ? Promise.reject(new Error("429")) : ok(body));
    const r = await handleRegiSupply("circulating-supply", flaky, 0);
    expect(r.status).toBe(200);
    expect(n).toBe(2);
  });

  test("up to two rate-limited answers are retried (3 tries)", async () => {
    const ok = rpc(values).fetchRpc;
    let n = 0;
    const flaky: FetchRpc = async (body) => (n++ < 2 ? Promise.reject(new Error("429")) : ok(body));
    const r = await handleRegiSupply("circulating-supply", flaky, 0);
    expect(r.status).toBe(200);
    expect(n).toBe(3);
  });

  test("an RPC failure is a 503, never a wrong number", async () => {
    const r = await handleRegiSupply("circulating-supply", rpc(values, true).fetchRpc, 0);
    expect(r.status).toBe(503);
  });

  test("an unknown kind is a 404", async () => {
    expect((await handleRegiSupply("price", rpc(values).fetchRpc)).status).toBe(404);
  });
});

/** A Cache API stand-in (the Workers cache): keyed by URL. */
function memoryCache() {
  const m = new Map<string, Response>();
  return {
    m,
    match: async (req: Request) => m.get(req.url)?.clone(),
    put: async (req: Request, res: Response) => void m.set(req.url, res.clone()),
  };
}

describe("withLastGood: the shared public RPC fails often, supply moves slowly", () => {
  const URL_ = "https://dashboard.registrai.cc/api/regi/circulating-supply";
  const ok = () => new Response("964000000", { status: 200, headers: { "content-type": "text/plain" } });
  const down = () => new Response("Arc RPC unavailable", { status: 503 });

  test("a good answer is served and kept", async () => {
    const c = memoryCache();
    const r = await withLastGood(c, new Request(URL_), async () => ok());
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("964000000");
    expect(r.headers.get("x-registrai-stale")).toBeNull();
  });

  test("when the RPC fails, the last good answer is served, marked stale", async () => {
    const c = memoryCache();
    await withLastGood(c, new Request(URL_), async () => ok());
    const r = await withLastGood(c, new Request(URL_), async () => down());
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("964000000");
    expect(r.headers.get("x-registrai-stale")).toBe("1");
  });

  test("with nothing kept yet, the failure passes through", async () => {
    const r = await withLastGood(memoryCache(), new Request(URL_), async () => down());
    expect(r.status).toBe(503);
  });

  test("a 404 is never replaced by a kept answer", async () => {
    const c = memoryCache();
    const r = await withLastGood(c, new Request(URL_ + "x"), async () => new Response("not found", { status: 404 }));
    expect(r.status).toBe(404);
  });
});

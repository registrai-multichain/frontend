import { describe, expect, test } from "vitest";
import { APP_CONTRACTS_CAP, APP_CONTRACTS_KEY, buildAppContracts, readAppContracts } from "../lib/app-contracts";
import { handlePushContracts } from "../lib/builders-index";
import { renderApp } from "../lib/apps-pages";
import { MemoryKV } from "./memory-kv";
import type { AppDetail } from "../lib/apps-data";

const TOKEN = "t".repeat(40);
const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

describe("each app's contracts, from the contract map", () => {
  test("grouped by app, sorted, capped, with the full count", () => {
    const map: Record<string, string> = { [a(3)]: "domain:x.y", [a(1)]: "domain:x.y", [a(2)]: "integration:uniswap" };
    for (let i = 10; i < 10 + APP_CONTRACTS_CAP + 5; i++) map[a(i)] = "integration:big";
    const out = buildAppContracts(map);
    expect(out["domain:x.y"]).toEqual({ total: 2, sample: [a(1), a(3)] });
    expect(out["integration:big"].total).toBe(APP_CONTRACTS_CAP + 5);
    expect(out["integration:big"].sample).toHaveLength(APP_CONTRACTS_CAP);
  });

  test("the AEI contract push stores the per-app lists; other indices and a failed write leave the publish alone", async () => {
    const kv = new MemoryKV();
    const body = JSON.stringify({ hour_start: 1792195200, contracts: { [a(1)]: "domain:x.y" }, open_senders: [] });
    const req = () => new Request("https://builder.registrai.cc/api/index/aei/contracts", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body });
    expect((await handlePushContracts(req(), { INVITES: kv, ABI_PUSH_TOKEN: TOKEN } as never, "aei")).status).toBe(200);
    expect(await readAppContracts({ INVITES: kv } as never, "domain:x.y")).toEqual({ total: 1, sample: [a(1)] });
    const kv2 = new MemoryKV();
    expect((await handlePushContracts(req(), { INVITES: kv2, ABI_PUSH_TOKEN: TOKEN } as never, "abi")).status).toBe(200);
    expect(await kv2.get(APP_CONTRACTS_KEY)).toBeNull();
  });

  test("the app page lists the contracts with explorer links, and says how many more there are", () => {
    const row = { id: "integration:big", name: "Big", kind: "integration", verified: false, points: 1, share: 1, first_hour: "2026-10-11T19:00:00Z",
      last_24h: { points_earned: 0, payments: 0, usdc: 0 }, contracts: 30, indices: ["aii", "aei"], hourly: [], facts_url: null, data_until: "2026-10-14T21:00:00Z",
      contracts_sample: [a(1), a(2)] } as unknown as AppDetail;
    const h = renderApp({ ...row, contracts: 3 } as AppDetail);
    expect(h).toMatch(new RegExp(`href="https://[^"]+/address/${a(1)}"`));
    expect(h).toContain("and 1 more");
  });
});

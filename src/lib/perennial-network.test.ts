import { describe, expect, test } from "vitest";
import mainnet from "./deployments/arc-mainnet.json";
import {
  networkStatusLine,
  resolvePerennialDeployment,
  selectPerennialNetwork,
  type DeploymentSource,
} from "./perennial-network";

describe("selectPerennialNetwork", () => {
  test("defaults to testnet", () => {
    expect(selectPerennialNetwork(undefined)).toBe("testnet");
    expect(selectPerennialNetwork("")).toBe("testnet");
    expect(selectPerennialNetwork("garbage")).toBe("testnet");
  });
  test("accepts mainnet in any case", () => {
    expect(selectPerennialNetwork("mainnet")).toBe("mainnet");
    expect(selectPerennialNetwork(" MainNet ")).toBe("mainnet");
  });
});

describe("resolvePerennialDeployment", () => {
  test("the shipped mainnet record is all-null and resolves as not deployed", () => {
    const d = resolvePerennialDeployment("mainnet", mainnet as DeploymentSource);
    expect(d.chain.id).toBe(5042);
    expect(d.chain.rpcUrls).toEqual(["https://rpc.mainnet.arc.io"]);
    expect(d.chain.nativeCurrency.decimals).toBe(18);
    expect(d.chain.usdc.decimals).toBe(6);
    expect(d.deployed).toBe(false);
    expect(d.missing).toEqual(["NanoLedger", "BuilderRegistry", "MarketsPerennial"]);
    expect(d.operator).toBeNull();
    expect(d.deployBlock).toBeNull();
    expect(networkStatusLine(d)).toBe("Arc mainnet · not deployed yet");
  });

  test("one missing address is enough to be not deployed", () => {
    const a = "0x71Ea02b2E75e6C65A41DF9E3c78E14F9ae2232D9";
    const d = resolvePerennialDeployment("mainnet", {
      contracts: { NanoLedger: a, BuilderRegistry: a, MarketsPerennial: null },
    });
    expect(d.deployed).toBe(false);
    expect(d.missing).toEqual(["MarketsPerennial"]);
  });

  test("malformed addresses count as missing", () => {
    const d = resolvePerennialDeployment("testnet", {
      contracts: { NanoLedger: "0x123", BuilderRegistry: "", BuilderFund: undefined, MarketsPerennial: "nope" },
    });
    expect(d.missing).toEqual(["NanoLedger", "BuilderRegistry", "MarketsPerennial"]);
  });

  test("a full testnet record is deployed and uses the official testnet RPC", () => {
    const a = "0x71Ea02b2E75e6C65A41DF9E3c78E14F9ae2232D9";
    const d = resolvePerennialDeployment("testnet", {
      contracts: { NanoLedger: a, BuilderRegistry: a, MarketsPerennial: a },
      operator: "0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263",
      deployBlock: 62539246,
    });
    expect(d.deployed).toBe(true);
    expect(d.chain.id).toBe(5042002);
    expect(d.chain.rpcUrls).toEqual(["https://rpc.testnet.arc.io"]);
    expect(d.contracts.USDC).toBe("0x3600000000000000000000000000000000000000");
    expect(d.deployBlock).toBe(62539246n);
    expect(networkStatusLine(d)).toBe("Arc testnet · test USDC");
    // No BuilderFund / SeasonPool yet: markets live, the economy parts not deployed.
    expect(d.fundDeployed).toBe(false);
  });

  test("the builder economy needs both the fund and the season pool (and the markets)", () => {
    const a = "0x71Ea02b2E75e6C65A41DF9E3c78E14F9ae2232D9";
    const full = { NanoLedger: a, BuilderRegistry: a, MarketsPerennial: a };
    expect(resolvePerennialDeployment("testnet", { contracts: { ...full, BuilderFund: a, SeasonPool: a } }).fundDeployed).toBe(true);
    expect(resolvePerennialDeployment("testnet", { contracts: { ...full, BuilderFund: a } }).fundDeployed).toBe(false);
    expect(resolvePerennialDeployment("testnet", { contracts: { ...full, SeasonPool: a } }).fundDeployed).toBe(false);
    expect(resolvePerennialDeployment("testnet", { contracts: { BuilderFund: a, SeasonPool: a } }).fundDeployed).toBe(false);
    // the fund is optional: its absence never makes the markets "not deployed"
    expect(resolvePerennialDeployment("testnet", { contracts: full }).missing).toEqual([]);
  });

  test("the shipped mainnet record carries the fund and pool as null", () => {
    const d = resolvePerennialDeployment("mainnet", mainnet as DeploymentSource);
    expect(d.contracts.BuilderFund).toBeNull();
    expect(d.contracts.SeasonPool).toBeNull();
    expect(d.fundDeployed).toBe(false);
    expect(Object.keys(mainnet.contracts)).not.toContain("ProgressPool");
  });
});

import { milestoneFeedFromMarkets } from "./perennial-chain";

describe("milestoneFeedFromMarkets", () => {
  const op = "0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263";
  const m = (builderId: bigint, agent: string, feedId: string, createdAt: bigint) =>
    ({ builderId, agent: agent as `0x${string}`, feedId: feedId as `0x${string}`, createdAt });
  test("the newest operator market for the builder names its feed", () => {
    const feeds = [
      m(3n, op, "0xaa", 10n),
      m(3n, op.toLowerCase(), "0xbb", 20n),
      m(3n, "0x84C799941C6B69AbB296EC46a02E4e0772Ad2E5e", "0xcc", 30n),
      m(4n, op, "0xdd", 40n),
    ];
    expect(milestoneFeedFromMarkets(feeds, 3, op)).toBe("0xbb");
  });
  test("no operator market (or no operator) means no milestone feed", () => {
    expect(milestoneFeedFromMarkets([m(1n, "0x84C799941C6B69AbB296EC46a02E4e0772Ad2E5e", "0x5f", 1n)], 1, op)).toBeUndefined();
    expect(milestoneFeedFromMarkets([m(1n, op, "0x5f", 1n)], 1, null)).toBeUndefined();
  });
});

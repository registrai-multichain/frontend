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
    expect(d.missing).toEqual(["NanoLedger", "BuilderRegistry", "ProgressPool", "MarketsPerennial"]);
    expect(d.operator).toBeNull();
    expect(d.deployBlock).toBeNull();
    expect(networkStatusLine(d)).toBe("Arc mainnet · not deployed yet");
  });

  test("one missing address is enough to be not deployed", () => {
    const a = "0x71Ea02b2E75e6C65A41DF9E3c78E14F9ae2232D9";
    const d = resolvePerennialDeployment("mainnet", {
      contracts: { NanoLedger: a, BuilderRegistry: a, ProgressPool: a, MarketsPerennial: null },
    });
    expect(d.deployed).toBe(false);
    expect(d.missing).toEqual(["MarketsPerennial"]);
  });

  test("malformed addresses count as missing", () => {
    const d = resolvePerennialDeployment("testnet", {
      contracts: { NanoLedger: "0x123", BuilderRegistry: "", ProgressPool: undefined, MarketsPerennial: "nope" },
    });
    expect(d.missing).toEqual(["NanoLedger", "BuilderRegistry", "ProgressPool", "MarketsPerennial"]);
  });

  test("a full testnet record is deployed and uses the official testnet RPC", () => {
    const a = "0x71Ea02b2E75e6C65A41DF9E3c78E14F9ae2232D9";
    const d = resolvePerennialDeployment("testnet", {
      contracts: { NanoLedger: a, BuilderRegistry: a, ProgressPool: a, MarketsPerennial: a },
      operator: "0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263",
      deployBlock: 62539246,
    });
    expect(d.deployed).toBe(true);
    expect(d.chain.id).toBe(5042002);
    expect(d.chain.rpcUrls).toEqual(["https://rpc.testnet.arc.io"]);
    expect(d.contracts.USDC).toBe("0x3600000000000000000000000000000000000000");
    expect(d.deployBlock).toBe(62539246n);
    expect(networkStatusLine(d)).toBe("Arc testnet · test USDC");
  });
});

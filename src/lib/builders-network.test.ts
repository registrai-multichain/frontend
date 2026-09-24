import { describe, expect, test } from "vitest";
import mainnet from "./deployments/arc-mainnet.json";
import testnet from "./deployments/arc-testnet-perennial.json";
import {
  BUILDERS,
  BUILDERS_SOURCES,
  buildersStatusLine,
  resolveBuildersDeployment,
  selectBuildersNetwork,
} from "./builders-network";
import { mainnetPerennialSource, resolvePerennialDeployment } from "./perennial-network";

const A = "0x71Ea02b2E75e6C65A41DF9E3c78E14F9ae2232D9";
const B = "0x10F8D6D5905E2C4dc565a1894c102B25E9d21DF4";

describe("selectBuildersNetwork", () => {
  test("mainnet exactly when mainnet's BuilderRegistry is set", () => {
    expect(selectBuildersNetwork({ BuilderRegistry: A })).toBe("mainnet");
    expect(selectBuildersNetwork({ BuilderRegistry: null })).toBe("testnet");
    expect(selectBuildersNetwork({})).toBe("testnet");
    expect(selectBuildersNetwork(undefined)).toBe("testnet");
    expect(selectBuildersNetwork({ BuilderRegistry: "0xnope" })).toBe("testnet");
  });

  test("the badge or caretakers alone do not select mainnet", () => {
    expect(selectBuildersNetwork({ CaretakerRegistry: A, VerifiedBuilderBadge: A })).toBe("testnet");
  });

  test("does not depend on any market contract", () => {
    // Phase 1: only the builder block is filled, every market contract is null.
    const record = { ...mainnet, builders: { ...mainnet.builders, BuilderRegistry: A } };
    expect(record.contracts.MarketsPerennial).toBeNull();
    expect(selectBuildersNetwork(record.builders)).toBe("mainnet");
  });
});

describe("resolveBuildersDeployment", () => {
  test("the shipped records: mainnet unset, so testnet with the known registries", () => {
    expect(BUILDERS_SOURCES.mainnet.BuilderRegistry).toBeNull();
    expect(BUILDERS.network).toBe("testnet");
    expect(BUILDERS.chainId).toBe(5042002);
    expect(BUILDERS.rpc).toBe("https://rpc.testnet.arc.io");
    expect(BUILDERS.contracts).toEqual({
      BuilderRegistry: "0x10F8D6D5905E2C4dc565a1894c102B25E9d21DF4",
      CaretakerRegistry: "0x02CfdE88a97A56A7dbDC05F6c7BD3Dbc34393876",
      VerifiedBuilderBadge: "0x05de78E9Ff17ccE47D7F4E9170fdfC130Abe278c",
    });
    expect(BUILDERS.operator).toBe("0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263");
    expect(BUILDERS.deployBlock).toBe(BigInt(testnet.builders.deployBlock));
    expect(BUILDERS.badgeNetwork).toBe("arc-testnet");
    expect(BUILDERS.deployed && BUILDERS.badgesOn).toBe(true);
  });

  test("mainnet: Circle's RPC, the mainnet explorer, badge art key 'arc'", () => {
    const d = resolveBuildersDeployment("mainnet", { BuilderRegistry: A, CaretakerRegistry: B, VerifiedBuilderBadge: A, operator: B, deployBlock: 12 });
    expect(d.chainId).toBe(5042);
    expect(d.rpc).toBe("https://rpc.mainnet.arc.io");
    expect(d.explorer.url).not.toContain("arc-scan.org");
    expect(d.badgeNetwork).toBe("arc");
    expect(d.deployBlock).toBe(12n);
    expect(d.deployed).toBe(true);
    expect(buildersStatusLine(d)).toBe("Arc mainnet · builder registry");
  });

  test("no registry: not deployed, badges off without a badge contract", () => {
    const d = resolveBuildersDeployment("mainnet", {});
    expect(d.deployed).toBe(false);
    expect(d.badgesOn).toBe(false);
    expect(d.operator).toBeNull();
    expect(buildersStatusLine(d)).toBe("Arc mainnet · not deployed yet");
  });
});

describe("phase 2 reuses the phase-1 registries", () => {
  test("mainnet market record falls back to the builders block", () => {
    const src = mainnetPerennialSource({
      contracts: { NanoLedger: A, BuilderFund: A, SeasonPool: A, MarketsPerennial: A, BuilderRegistry: null, CaretakerRegistry: null, VerifiedBuilderBadge: null },
      operator: null,
      deployBlock: 5,
      builders: { BuilderRegistry: B, CaretakerRegistry: B, VerifiedBuilderBadge: B, operator: A },
    });
    const d = resolvePerennialDeployment("mainnet", src);
    expect(d.contracts.BuilderRegistry).toBe(B);
    expect(d.contracts.CaretakerRegistry).toBe(B);
    expect(d.contracts.VerifiedBuilderBadge).toBe(B);
    expect(d.operator).toBe(A);
    expect(d.deployed).toBe(true);
  });

  test("phase 1 alone (registries only) never makes the markets deployed", () => {
    const src = mainnetPerennialSource({ ...mainnet, builders: { BuilderRegistry: B, CaretakerRegistry: B, VerifiedBuilderBadge: B } });
    const d = resolvePerennialDeployment("mainnet", src);
    expect(d.contracts.BuilderRegistry).toBe(B);
    expect(d.deployed).toBe(false);
  });
});

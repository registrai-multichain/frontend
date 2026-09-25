import { describe, expect, test } from "vitest";
import mainnet from "./deployments/arc-mainnet.json";
import {
  BUILDERS,
  BUILDERS_SOURCES,
  buildersStatusLine,
  resolveBuildersDeployment,
  selectBuildersNetwork,
} from "./builders-network";
import { mainnetPerennialSource, resolvePerennialDeployment } from "./perennial-network";

const A = "0x71Ea02b2E75e6C65A41DF9E3c78E14F9ae2232D9";
const B = "0xB52FC2AB9b2457D8c56d3b4A624543aD61c70D9C";

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
  test("the shipped records: mainnet phase 1 is set, so the builders network is Arc mainnet", () => {
    expect(BUILDERS_SOURCES.mainnet.BuilderRegistry).toBe("0xBB6F4B18776Fd20Bb53a1205375273373DD1E5bA");
    expect(BUILDERS.network).toBe("mainnet");
    expect(BUILDERS.chainId).toBe(5042);
    expect(BUILDERS.rpc).toBe("https://rpc.mainnet.arc.io");
    expect(BUILDERS.contracts).toEqual({
      BuilderRegistry: "0xBB6F4B18776Fd20Bb53a1205375273373DD1E5bA",
      CaretakerRegistry: "0x64725935d90F0aa6f3c8642Bb9cACF44CAA46224",
      VerifiedBuilderBadge: "0xF229d2Ed13Cc35d46fa7676a579495E5C80CFEB2",
    });
    expect(BUILDERS.operator).toBe("0xe528487069a24DA29c0360e61378db07ECAE88c9");
    expect(BUILDERS.deployBlock).toBe(22642042n);
    expect(BUILDERS.badgeNetwork).toBe("arc");
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

import { describe, expect, test } from "vitest";
import { getContractAddress, type Address, type Hex } from "viem";
import vectors from "./__fixtures__/verified-builder-vectors.json";
import { buildVerifiedBuilderVectors } from "./verified-builder-vectors";
import {
  builderStatus,
  canonicalClaimMessage,
  countCreateDeployments,
  createDeployAddress,
  milestoneFeedFor,
  normalizeSource,
  operatorFeeds,
  proofConfigFromEnv,
  proofUrl,
  sourceFromProfileURI,
  validateProof,
  type Claim,
  type DeployCountClient,
} from "./verified-builders";

const B0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const B1 = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

describe("shared fixture", () => {
  test("is exactly what the generator produces (regenerate with scripts/gen-verified-builder-vectors.ts)", async () => {
    expect(JSON.parse(JSON.stringify(await buildVerifiedBuilderVectors()))).toEqual(vectors);
  });

  test("dev keys are anvil's", () => {
    expect(vectors.keys.map((k) => k.address.toLowerCase())).toEqual([B0, B1]);
  });
});

describe("canonicalClaimMessage", () => {
  test("github claim: exact bytes, no trailing newline", () => {
    expect(canonicalClaimMessage(vectors.messages[0].claim)).toBe(
      "Registrai builder claim v1\n" +
        `builder: ${B0}\n` +
        "source: github:registrai-multichain/oracle-primitives\n" +
        "deployers: none\n" +
        "country: PL\n" +
        "chain: 5042002\n" +
        "issued: 2026-09-24",
    );
  });

  test("deployers are lowercased, sorted ascending and comma+space separated; builder lowercased", () => {
    const claim: Claim = {
      builder: "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      source: "domain:app.example.org",
      deployers: ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"],
      country: "DE",
      chain: 5042,
      issued: "2026-09-24",
    };
    const msg = canonicalClaimMessage(claim);
    expect(msg.split("\n")[1]).toBe(`builder: ${B0}`);
    expect(msg.split("\n")[3]).toBe(`deployers: ${B1}, ${B0}`);
    expect(msg.split("\n")[5]).toBe("chain: 5042");
    expect(msg.endsWith("\n")).toBe(false);
  });

  test("every fixture message matches", () => {
    for (const m of vectors.messages) expect(canonicalClaimMessage(m.claim)).toBe(m.message);
  });
});

describe("normalizeSource", () => {
  test.each([
    ["https://github.com/Registrai-Multichain/Oracle-Primitives", "github:registrai-multichain/oracle-primitives"],
    ["https://github.com/owner/repo.git", "github:owner/repo"],
    ["http://www.github.com/owner/repo/tree/main/src?x=1#readme", "github:owner/repo"],
    ["github.com/owner/repo", "github:owner/repo"],
    ["Owner/Repo", "github:owner/repo"],
    ["github:Owner/Repo", "github:owner/repo"],
    ["https://App.Example.org:8443/path?q=1", "domain:app.example.org"],
    ["app.example.org/some/page", "domain:app.example.org"],
    ["domain:App.Example.ORG", "domain:app.example.org"],
    ["http://localhost:8080/x", "domain:localhost"],
  ])("%s -> %s", (input, out) => {
    expect(normalizeSource(input)).toBe(out);
  });

  test.each(["", "example", "https://github.com/owner", "owner/repo/extra", "owner//repo", "-bad/repo", "domain:app.example.org:443", "ftp://example.org", "https://user@example.org", "10.0.0.1"])(
    "rejects %j",
    (input) => {
      expect(normalizeSource(input)).toBeNull();
    },
  );

  test("fixture sources", () => {
    for (const s of vectors.sources) expect(normalizeSource(s.input)).toBe(s.expected);
  });

  test("profile links: only canonical registrai: sources count", () => {
    expect(sourceFromProfileURI("registrai:github:o/r")).toBe("github:o/r");
    expect(sourceFromProfileURI("registrai:github:O/R")).toBeNull();
    expect(sourceFromProfileURI("https://github.com/o/r")).toBeNull();
  });
});

describe("proofUrl", () => {
  test("defaults", () => {
    expect(proofUrl("github:owner/repo")).toBe("https://raw.githubusercontent.com/owner/repo/HEAD/.registrai.json");
    expect(proofUrl("domain:app.example.org")).toBe("https://app.example.org/.well-known/registrai.json");
  });

  test("PROOF_GITHUB_BASE / PROOF_DOMAIN_SCHEME overrides; http only for local hosts", () => {
    const cfg = proofConfigFromEnv({ PROOF_GITHUB_BASE: "http://127.0.0.1:9000", PROOF_DOMAIN_SCHEME: "http" });
    expect(proofUrl("github:o/r", cfg)).toBe("http://127.0.0.1:9000/o/r/HEAD/.registrai.json");
    expect(proofUrl("domain:127.0.0.1", cfg)).toBe("http://127.0.0.1/.well-known/registrai.json");
    expect(() => proofUrl("domain:app.example.org", cfg)).toThrow();
    expect(() => proofUrl("github:O/R")).toThrow();
  });

  test("fixture urls", () => {
    for (const u of vectors.proofUrls) {
      if (u.url === null) expect(() => proofUrl(u.source, u.config)).toThrow();
      else expect(proofUrl(u.source, u.config)).toBe(u.url);
    }
  });
});

describe("validateProof", () => {
  // Expectations come from the case NAME, written by hand, not from the
  // implementation that generated the fixture.
  const expected = (name: string) =>
    name.startsWith("valid")
      ? { valid: true, rule: null }
      : name.startsWith("malformed")
        ? { valid: false, rule: 0 }
        : { valid: false, rule: Number(/^rule (\d):/.exec(name)![1]) };

  test.each(vectors.proofs.map((p) => [p.name, p] as const))("%s", async (_name, p) => {
    const r = await validateProof(p.file, p.context);
    const got = r.valid ? { valid: true, rule: null } : { valid: false, rule: r.rule };
    expect(got).toEqual(expected(p.name));
    expect(got).toEqual(p.expect);
  });

  test("the spec's named failures are all covered", () => {
    const names = vectors.proofs.map((p) => p.name).join("\n");
    for (const needle of ["forged", "wrong wallet", "source mismatch", "deployer did not sign", "github claim with deployers"]) {
      expect(names).toContain(needle);
    }
  });

  test("a valid proof returns the claim", async () => {
    const p = vectors.proofs[0];
    const r = await validateProof(p.file, p.context);
    expect(r.valid && r.claim.source).toBe("github:registrai-multichain/oracle-primitives");
  });
});

describe("builderStatus", () => {
  const base = { active: true, profileURI: "registrai:github:o/r", proofValid: true, caretakerIsOperator: false };
  test("transitions", () => {
    expect(builderStatus(base)).toBe("pending");
    expect(builderStatus({ ...base, caretakerIsOperator: true })).toBe("verified");
    // verified -> proof removed -> lapsed (even though the caretaker is still ours)
    expect(builderStatus({ ...base, caretakerIsOperator: true, proofValid: false })).toBe("lapsed");
    expect(builderStatus({ ...base, proofValid: false })).toBe("lapsed");
    expect(builderStatus({ ...base, profileURI: "https://github.com/o/r", caretakerIsOperator: true })).toBe("unverified");
    expect(builderStatus({ ...base, active: false, caretakerIsOperator: true })).toBe("unverified");
  });
  test("fixture", () => {
    for (const s of vectors.status) expect(builderStatus(s.input)).toBe(s.expected);
  });
});

describe("createDeployAddress", () => {
  test("anvil's well-known first deployments", () => {
    expect(createDeployAddress(B0, 0)).toBe("0x5FbDB2315678afecb367f032d93F642f64180aa3");
    expect(createDeployAddress(B0, 1)).toBe("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
    expect(createDeployAddress(B0, 2)).toBe("0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0");
  });
  test("matches viem getContractAddress across RLP boundaries", () => {
    for (const v of vectors.createAddresses) {
      expect(v.address).toBe(getContractAddress({ from: v.deployer as Address, nonce: BigInt(v.nonce), opcode: "CREATE" }));
      expect(createDeployAddress(v.deployer, v.nonce)).toBe(v.address);
    }
  });
});

describe("countCreateDeployments", () => {
  function fakeChain(nonces: Record<string, number>, withCode: Set<string>) {
    const calls = { getCode: 0 };
    const client: DeployCountClient = {
      getTransactionCount: async ({ address }) => nonces[address.toLowerCase()] ?? 0,
      getCode: async ({ address }) => {
        calls.getCode++;
        return (withCode.has(address.toLowerCase()) ? "0x6080" : "0x") as Hex;
      },
    };
    return { client, calls };
  }

  test("counts CREATE addresses with code, then only scans new nonces", async () => {
    const code = new Set([createDeployAddress(B0, 0), createDeployAddress(B0, 2)].map((a) => a.toLowerCase()));
    const nonces: Record<string, number> = { [B0]: 3 };
    const chain = fakeChain(nonces, code);
    const first = await countCreateDeployments(chain.client, [B0]);
    expect(first.total).toBe(2);
    expect(first.cache[B0]).toEqual({ checkedNonce: 3, count: 2 });
    expect(chain.calls.getCode).toBe(3);

    nonces[B0] = 5;
    code.add(createDeployAddress(B0, 4).toLowerCase());
    const second = await countCreateDeployments(chain.client, [B0], first.cache);
    expect(second.total).toBe(3);
    expect(second.cache[B0]).toEqual({ checkedNonce: 5, count: 3 });
    expect(chain.calls.getCode).toBe(5); // nonces 3 and 4 only
    expect(first.cache[B0]).toEqual({ checkedNonce: 3, count: 2 }); // input cache untouched
  });

  test("sums over deployers; a repeated deployer counts once", async () => {
    const code = new Set([createDeployAddress(B0, 0), createDeployAddress(B1, 0)].map((a) => a.toLowerCase()));
    const chain = fakeChain({ [B0]: 1, [B1]: 1 }, code);
    const r = await countCreateDeployments(chain.client, [B0, B1, B0.toUpperCase().replace("0X", "0x")]);
    expect(r.total).toBe(2);
  });
});

describe("milestone feeds", () => {
  const op = "0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263";
  const logs = [
    { feedId: "0x01", creator: op, description: "registrai-multichain/oracle-primitives-ships-release" },
    { feedId: "0x02", creator: op, description: "registrai-milestone:github:o/r" },
    { feedId: "0x03", creator: B0, description: "registrai-milestone:github:x/y" },
    { feedId: "0x04", creator: op.toLowerCase(), description: "registrai-milestone:github:o/r" },
  ];
  test("only the operator's feeds; the latest per description wins", () => {
    const feeds = operatorFeeds(logs, op);
    expect(feeds["registrai-milestone:github:o/r"]).toBe("0x04");
    expect(feeds["registrai-milestone:github:x/y"]).toBeUndefined();
  });
  test("new description first, legacy <repo>-ships-release as fallback", () => {
    const feeds = operatorFeeds(logs, op);
    expect(milestoneFeedFor(feeds, "github:o/r")).toBe("0x04");
    expect(milestoneFeedFor(feeds, null, ["registrai-multichain/oracle-primitives"])).toBe("0x01");
    expect(milestoneFeedFor(feeds, "github:x/y")).toBeNull();
  });
});

describe("PROOF_DOMAIN_PORT (test-only)", () => {
  test("applies only to http on a local host", () => {
    expect(proofUrl("domain:127.0.0.1", { domainScheme: "http", domainPort: 8123 })).toBe("http://127.0.0.1:8123/.well-known/registrai.json");
    expect(proofUrl("domain:example.com", { domainPort: 8123 })).toBe("https://example.com/.well-known/registrai.json");
  });
});

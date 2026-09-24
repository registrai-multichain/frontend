import { describe, expect, test } from "vitest";
import { zeroAddress, type Address } from "viem";
import vectors from "./__fixtures__/verified-builder-vectors.json";
import {
  legacyRepoFromURI,
  perennialBuilderSnapshot,
  readBuilderRecords,
  verifiedOwners,
  type RegistryReader,
} from "./verified-builders-chain";

const B0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const B1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const OP = "0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263" as Address;
const REG = "0x10F8D6D5905E2C4dc565a1894c102B25E9d21DF4" as Address;
const CARE = "0x02CfdE88a97A56A7dbDC05F6c7BD3Dbc34393876" as Address;
const CHAIN = 5042002;

const proof = (name: string) => vectors.proofs.find((p) => p.name === name)!.file;
const GH_VALID = proof("valid github claim");
const DOM_VALID = proof("valid domain claim: builder is also a deployer, second deployer signed");

type Row = { owner: Address; profileURI: string; active: boolean; caretaker: Address };

function fakeRegistry(rows: Row[]): RegistryReader {
  return {
    readContract: async ({ functionName, args }) => {
      const id = args ? Number(args[0] as bigint) : 0;
      if (functionName === "nextId") return BigInt(rows.length + 1);
      if (functionName === "builders") {
        const r = rows[id - 1];
        return [r.owner, r.profileURI, "0x", 0n, r.active] as const;
      }
      if (functionName === "caretakerOf") return rows[id - 1].caretaker;
      throw new Error(`unexpected ${functionName}`);
    },
  };
}

describe("readBuilderRecords", () => {
  test("folds profile link, proof and caretaker into a status", async () => {
    const rows: Row[] = [
      // 1: legacy github link — unverified, never fetched
      { owner: B1, profileURI: "https://github.com/registrai-multichain/oracle-primitives", active: true, caretaker: OP },
      // 2: claimed, proof valid, caretaker not yet ours — pending
      { owner: B0, profileURI: "registrai:github:registrai-multichain/oracle-primitives", active: true, caretaker: zeroAddress },
      // 3: claimed, proof valid, caretaker ours — verified
      { owner: B0, profileURI: "registrai:domain:app.example.org", active: true, caretaker: OP },
      // 4: claimed but the proof names a different owner — lapsed
      { owner: B1, profileURI: "registrai:domain:app.example.org", active: true, caretaker: OP },
      // 5: claimed, proof removed — lapsed
      { owner: B0, profileURI: "registrai:github:gone/repo", active: true, caretaker: OP },
      // 6: non-canonical registrai: link — lapsed, nothing fetched
      { owner: B0, profileURI: "registrai:github:Gone/Repo", active: true, caretaker: OP },
    ];
    const fetched: string[] = [];
    const files: Record<string, unknown> = {
      "https://raw.githubusercontent.com/registrai-multichain/oracle-primitives/HEAD/.registrai.json": GH_VALID,
      "https://app.example.org/.well-known/registrai.json": DOM_VALID,
    };
    const records = await readBuilderRecords(fakeRegistry(rows), {
      builderRegistry: REG,
      caretakerRegistry: CARE,
      operator: OP,
      chainId: CHAIN,
      fetchJson: async (url) => {
        fetched.push(url);
        return files[url] ?? null;
      },
    });
    expect(records.map((r) => r.status)).toEqual(["unverified", "pending", "verified", "lapsed", "lapsed", "lapsed"]);
    expect(records[2].country).toBe("DE");
    expect(records[3].proofError).toMatch(/^rule 4/);
    expect(records[4].proofError).toMatch(/missing/);
    expect(records[5].proofError).toMatch(/canonical/);
    expect(fetched.some((u) => u.includes("Gone"))).toBe(false);
    expect(fetched).toHaveLength(4);
  });

  test("the proof must be for this deployment's chain", async () => {
    const rows: Row[] = [{ owner: B0, profileURI: "registrai:github:registrai-multichain/oracle-primitives", active: true, caretaker: OP }];
    const [r] = await readBuilderRecords(fakeRegistry(rows), {
      builderRegistry: REG, caretakerRegistry: CARE, operator: OP, chainId: 5042, fetchJson: async () => GH_VALID,
    });
    expect(r.status).toBe("lapsed");
    expect(r.proofError).toMatch(/^rule 1/);
  });

  test("PROOF_GITHUB_BASE override is honoured", async () => {
    const rows: Row[] = [{ owner: B0, profileURI: "registrai:github:registrai-multichain/oracle-primitives", active: true, caretaker: OP }];
    const seen: string[] = [];
    await readBuilderRecords(fakeRegistry(rows), {
      builderRegistry: REG, caretakerRegistry: CARE, operator: OP, chainId: CHAIN,
      proofConfig: { githubBase: "http://127.0.0.1:9000" },
      fetchJson: async (u) => (seen.push(u), GH_VALID),
    });
    expect(seen).toEqual(["http://127.0.0.1:9000/registrai-multichain/oracle-primitives/HEAD/.registrai.json"]);
  });
});

describe("perennialBuilderSnapshot", () => {
  const base = { active: true, caretaker: OP, proofUrl: null, country: null };
  const records = [
    { ...base, builderId: 1, owner: B1, profileURI: "https://github.com/registrai-multichain/oracle-primitives", source: null, status: "unverified" as const },
    { ...base, builderId: 2, owner: B0, profileURI: "registrai:github:o/r", source: "github:o/r", status: "verified" as const, country: "PL", proofUrl: "u" },
    { ...base, builderId: 3, owner: B0, profileURI: "registrai:github:x/y", source: "github:x/y", status: "lapsed" as const, country: "PL" },
    { ...base, builderId: 4, owner: B0, profileURI: "ipfs://whatever", source: null, status: "unverified" as const },
  ];
  const feeds = {
    "registrai-multichain/oracle-primitives-ships-release": "0xlegacy",
    "registrai-milestone:github:o/r": "0xnew",
  };

  test("milestone feeds from FeedCreated; builders.json only for legacy entries", () => {
    const snap = perennialBuilderSnapshot(records, feeds, [
      { builderId: 4, address: B0, repo: "a/b", milestoneFeedId: "0xkeeper" },
      { builderId: 3, address: B0, repo: "x/y", milestoneFeedId: "0xshouldnotapply" },
    ]);
    expect(snap.map((s) => s.milestoneFeedId)).toEqual(["0xlegacy", "0xnew", null, "0xkeeper"]);
  });

  test("country only for verified builders; only verified owners reach the atlas", () => {
    const snap = perennialBuilderSnapshot(records, feeds);
    expect(snap.map((s) => s.country)).toEqual([null, "PL", null, null]);
    expect([...verifiedOwners(snap)]).toEqual([B0.toLowerCase()]);
    expect(snap[1]).toEqual({
      builderId: 2, owner: B0.toLowerCase(), source: "github:o/r", status: "verified", country: "PL", proofUrl: "u", milestoneFeedId: "0xnew",
    });
  });

  test("legacy repo from a GitHub profile link", () => {
    expect(legacyRepoFromURI("https://github.com/Registrai-Multichain/oracle-primitives")).toBe("Registrai-Multichain/oracle-primitives");
    expect(legacyRepoFromURI("github.com/o/r.git")).toBe("o/r");
    expect(legacyRepoFromURI("registrai:github:o/r")).toBeNull();
  });
});

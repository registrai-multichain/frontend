import { describe, expect, test } from "vitest";
import { zeroAddress, type Address } from "viem";
import vectors from "./__fixtures__/verified-builder-vectors.json";
import {
  foldBuilderRecord,
  leadSource,
  legacyRepoFromURI,
  perennialBuilderSnapshot,
  readBuilderRecords,
  verifiedOwners,
  type BuilderRecord,
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

const DOM_B1 = proof("valid domain claim: other builder, one deployer signed");
const GH_SRC = "github:registrai-multichain/oracle-primitives";
const DOM_SRC = "domain:app.example.org";
const GH_URL = "https://raw.githubusercontent.com/registrai-multichain/oracle-primitives/HEAD/.registrai.json";
const DOM_URL = "https://app.example.org/.well-known/registrai.json";

type P = { source: string; active?: boolean };
type Row = { owner: Address; profileURI?: string; active: boolean; caretaker: Address; projects: P[] };

/** A registry with builders 1..n, project ids numbered across builders in order. */
function fakeRegistry(rows: Row[], opts: { noProjects?: boolean } = {}): RegistryReader {
  const projects: { builderId: number; p: P }[] = [];
  const byBuilder = rows.map((r, i) => r.projects.map((p) => projects.push({ builderId: i + 1, p })));
  return {
    readContract: async ({ functionName, args }) => {
      const id = args ? Number(args[0] as bigint) : 0;
      if (functionName === "nextId") return BigInt(rows.length + 1);
      if (functionName === "builders") {
        const r = rows[id - 1];
        return [r.owner, r.profileURI ?? "", "0x", 1000n + BigInt(id), r.active] as const;
      }
      if (functionName === "caretakerOf") return rows[id - 1].caretaker;
      if (functionName === "projectsOf") {
        if (opts.noProjects) throw new Error("execution reverted");
        return byBuilder[id - 1].map((n) => BigInt(n));
      }
      if (functionName === "projects") {
        const x = projects[id - 1];
        return [BigInt(x.builderId), x.p.source, x.p.active ?? true, 500n + BigInt(id)] as const;
      }
      throw new Error(`unexpected ${functionName}`);
    },
  };
}

describe("readBuilderRecords", () => {
  test("folds projects, their proofs and the caretaker into statuses", async () => {
    const rows: Row[] = [
      // 1: no project — unverified, nothing fetched (the profile is never parsed)
      { owner: B1, profileURI: "registrai:github:registrai-multichain/oracle-primitives", active: true, caretaker: OP, projects: [] },
      // 2: one valid project, caretaker not yet ours — pending
      { owner: B0, active: true, caretaker: zeroAddress, projects: [{ source: GH_SRC }] },
      // 3: a lapsed and a valid project, caretaker ours — verified (country from the valid one)
      { owner: B0, profileURI: "Acme Labs", active: true, caretaker: OP, projects: [{ source: "github:gone/repo" }, { source: DOM_SRC }] },
      // 4: the proof names a different owner (rule 4) — lapsed
      { owner: B1, active: true, caretaker: OP, projects: [{ source: GH_SRC }] },
      // 5: non-canonical source — lapsed, nothing fetched
      { owner: B0, active: true, caretaker: OP, projects: [{ source: "github:Gone/Repo" }] },
      // 6: only a removed project — unverified, nothing fetched
      { owner: B0, active: true, caretaker: OP, projects: [{ source: GH_SRC, active: false }] },
      // 7: deactivated builder — inactive, nothing fetched
      { owner: B0, active: false, caretaker: OP, projects: [{ source: GH_SRC }] },
    ];
    const fetched: string[] = [];
    const files: Record<string, unknown> = { [GH_URL]: GH_VALID, [DOM_URL]: DOM_VALID };
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
    expect(records.map((r) => r.status)).toEqual(["unverified", "pending", "verified", "lapsed", "lapsed", "unverified", "inactive"]);
    expect(records[2].projects.map((p) => [p.projectId, p.status, p.country])).toEqual([
      [2, "lapsed", null],
      [3, "verified", "DE"],
    ]);
    expect(records[2].country).toBe("DE");
    expect(records[2].source).toBe(DOM_SRC); // lead = first verified project
    expect(records[2].profileURI).toBe("Acme Labs");
    expect(records[2].projects[0].proofError).toMatch(/missing/);
    expect(records[3].projects[0].proofError).toMatch(/^rule 4/);
    expect(records[4].projects[0]).toMatchObject({ canonical: false, status: "lapsed" });
    expect(records[4].projects[0].proofError).toMatch(/canonical/);
    expect(records[5].projects[0].status).toBe("inactive");
    expect(records[5].activeProjectCount).toBe(0);
    expect(records[6].projects[0].status).toBe("inactive");
    expect(records[0].source).toBeNull();
    expect(fetched.some((u) => u.includes("Gone"))).toBe(false);
    expect(fetched).toHaveLength(4);
  });

  test("the proof must be for this deployment's chain", async () => {
    const rows: Row[] = [{ owner: B0, active: true, caretaker: OP, projects: [{ source: GH_SRC }] }];
    const [r] = await readBuilderRecords(fakeRegistry(rows), {
      builderRegistry: REG, caretakerRegistry: CARE, operator: OP, chainId: 5042, fetchJson: async () => GH_VALID,
    });
    expect(r.status).toBe("lapsed");
    expect(r.projects[0].proofError).toMatch(/^rule 1/);
  });

  test("after an owner change every old proof reads lapsed (it names the old wallet)", async () => {
    const rows: Row[] = [{ owner: B1, active: true, caretaker: OP, projects: [{ source: GH_SRC }, { source: DOM_SRC }] }];
    const files: Record<string, unknown> = { [GH_URL]: GH_VALID, [DOM_URL]: DOM_VALID };
    const [r] = await readBuilderRecords(fakeRegistry(rows), {
      builderRegistry: REG, caretakerRegistry: CARE, operator: OP, chainId: CHAIN, fetchJson: async (u) => files[u] ?? null,
    });
    expect(r.status).toBe("lapsed");
    expect(r.projects.every((p) => p.proofError?.startsWith("rule 4"))).toBe(true);
    // re-signed with the new wallet: verified again
    const [r2] = await readBuilderRecords(fakeRegistry([{ ...rows[0], projects: [{ source: DOM_SRC }] }]), {
      builderRegistry: REG, caretakerRegistry: CARE, operator: OP, chainId: CHAIN, fetchJson: async () => DOM_B1,
    });
    expect(r2.status).toBe("verified");
    expect(r2.country).toBe("US");
  });

  test("PROOF_GITHUB_BASE override is honoured", async () => {
    const rows: Row[] = [{ owner: B0, active: true, caretaker: OP, projects: [{ source: GH_SRC }] }];
    const seen: string[] = [];
    await readBuilderRecords(fakeRegistry(rows), {
      builderRegistry: REG, caretakerRegistry: CARE, operator: OP, chainId: CHAIN,
      proofConfig: { githubBase: "http://127.0.0.1:9000" },
      fetchJson: async (u) => (seen.push(u), GH_VALID),
    });
    expect(seen).toEqual(["http://127.0.0.1:9000/registrai-multichain/oracle-primitives/HEAD/.registrai.json"]);
  });

  test("a registry without projects (pre-projects contract) is a clear error", async () => {
    const rows: Row[] = [{ owner: B0, active: true, caretaker: OP, projects: [] }];
    await expect(
      readBuilderRecords(fakeRegistry(rows, { noProjects: true }), {
        builderRegistry: REG, caretakerRegistry: CARE, operator: OP, chainId: CHAIN, fetchJson: async () => null,
      }),
    ).rejects.toThrow(/predates builder projects/);
  });
});

describe("foldBuilderRecord / leadSource", () => {
  test("lead: first verified, else first active, never a non-canonical source", () => {
    expect(leadSource([{ source: "github:a/b", active: true, status: "lapsed" }, { source: "github:c/d", active: true, status: "verified" }])).toBe("github:c/d");
    expect(leadSource([{ source: "github:a/b", active: false, status: "inactive" }, { source: "github:c/d", active: true, status: "lapsed" }])).toBe("github:c/d");
    expect(leadSource([{ source: "junk", active: true, status: "lapsed", canonical: false }])).toBeNull();
  });
  test("country: most common among verified projects", () => {
    const ok = (country: string) => ({ proofUrl: "u", ok: true as const, claim: { builder: B0, source: "", deployers: [], country, chain: CHAIN, issued: "" } });
    const r = foldBuilderRecord({
      builderId: 1, owner: B0, profileURI: "", createdAt: 1, active: true, caretaker: OP, operator: OP,
      projects: [
        { projectId: 1, source: "github:a/b", active: true, addedAt: 1, proof: ok("DE") },
        { projectId: 2, source: "github:c/d", active: true, addedAt: 2, proof: ok("PL") },
        { projectId: 3, source: "domain:e.org", active: true, addedAt: 3, proof: ok("PL") },
      ],
    });
    expect(r.country).toBe("PL");
    expect(r.status).toBe("verified");
  });
});

function rec(builderId: number, owner: Address, projects: { source: string; status: "verified" | "lapsed" | "inactive"; canonical?: boolean }[], over: Partial<BuilderRecord> = {}): BuilderRecord {
  const ps = projects.map((p, i) => ({
    projectId: builderId * 10 + i, source: p.source, canonical: p.canonical ?? true, active: p.status !== "inactive", addedAt: 1,
    status: p.status, country: p.status === "verified" ? "PL" : null, proofUrl: `https://p/${builderId}/${i}`,
  }));
  return {
    builderId, owner, active: true, profileURI: "", projects: ps, activeProjectCount: ps.filter((p) => p.active).length,
    source: leadSource(ps), caretaker: OP, status: "unverified", country: null, createdAt: 1, ...over,
  };
}

describe("perennialBuilderSnapshot", () => {
  const records = [
    rec(1, B1, [], { profileURI: "https://github.com/registrai-multichain/oracle-primitives" }),
    rec(2, B0, [{ source: "github:x/y", status: "lapsed" }, { source: "github:o/r", status: "verified" }, { source: "domain:d.org", status: "verified" }], { status: "verified", country: "PL" }),
    rec(3, B0, [{ source: "github:x/y", status: "lapsed" }], { status: "lapsed", country: "PL" }),
    rec(4, B0, [], { profileURI: "ipfs://whatever" }),
  ];
  const feeds = {
    "registrai-multichain/oracle-primitives-ships-release": "0xlegacy",
    "registrai-milestone:github:o/r": "0xnew",
    "registrai-milestone:domain:d.org": "0xdom",
    "registrai-milestone:github:x/y": "0xlapsedfeed",
  };

  test("milestone feeds per project; the builder's is its lead project's; builders.json only for legacy entries", () => {
    const snap = perennialBuilderSnapshot(records, feeds, [
      { builderId: 4, address: B0, repo: "a/b", milestoneFeedId: "0xkeeper" },
      { builderId: 3, address: B0, repo: "x/y", milestoneFeedId: "0xshouldnotapply" },
    ]);
    expect(snap.map((s) => s.milestoneFeedId)).toEqual(["0xlegacy", "0xnew", "0xlapsedfeed", "0xkeeper"]);
    expect(snap[1].projects.map((p) => [p.source, p.status, p.milestoneFeedId])).toEqual([
      ["github:x/y", "lapsed", "0xlapsedfeed"],
      ["github:o/r", "verified", "0xnew"],
      ["domain:d.org", "verified", "0xdom"],
    ]);
  });

  test("country only for verified builders; only verified owners reach the atlas", () => {
    const snap = perennialBuilderSnapshot(records, feeds);
    expect(snap.map((s) => s.country)).toEqual([null, "PL", null, null]);
    expect([...verifiedOwners(snap)]).toEqual([B0.toLowerCase()]);
    expect(snap[1]).toMatchObject({
      builderId: 2, owner: B0.toLowerCase(), source: "github:o/r", status: "verified", country: "PL", proofUrl: "https://p/2/1", milestoneFeedId: "0xnew",
    });
  });

  test("non-canonical sources are left out of the snapshot's projects", () => {
    const snap = perennialBuilderSnapshot([rec(5, B0, [{ source: "Junk", status: "lapsed", canonical: false }], { status: "lapsed" })], feeds);
    expect(snap[0].projects).toEqual([]);
    expect(snap[0].source).toBeNull();
  });

  test("legacy repo from a GitHub profile link", () => {
    expect(legacyRepoFromURI("https://github.com/Registrai-Multichain/oracle-primitives")).toBe("Registrai-Multichain/oracle-primitives");
    expect(legacyRepoFromURI("github.com/o/r.git")).toBe("o/r");
    expect(legacyRepoFromURI("registrai:github:o/r")).toBeNull();
  });
});

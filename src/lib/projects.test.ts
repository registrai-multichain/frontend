import { describe, expect, test } from "vitest";
import { METRIC_IDS, projectPath, publicProfile, validateProfile, type ProjectProfile } from "./projects";

const arctools: ProjectProfile = {
  source: "domain:arctools.fun",
  name: "ArcTools",
  website: "https://arctools.fun",
  x: "@ArcToolsBackup",
  xChecked: true,
  github: "github:arctoolsrepo/arctools",
  deployers: [{ address: "0x408c3d3fd36fdf84888f343417787d8710e76fe8", note: "key exposed per HANDOVER.md", sourceUrl: "https://example/tx" }],
  contracts: [{ address: "0x43cdbf8edb8fe41dde4ba519f49499d1ed78e74a", label: "swap router", note: "created blk 20625109" }],
  token: { address: "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52", note: "launchpad factory" },
  metrics: ["users", "holders", "x-posts"],
  redFlags: ["deployer key exposed"],
  declaredBy: "0xb7ecf980a4732b75e57e2ec80903dee3964f2573",
  declaredAt: "2026-09-27T12:00:00.000Z",
};

describe("projects contract", () => {
  test("paths encode the source (it contains ':' and '/')", () => {
    expect(projectPath("github:acme/tool")).toBe("/api/admin/projects/github%3Aacme%2Ftool");
    expect(projectPath("domain:arctools.fun", false)).toBe("/api/projects/domain%3Aarctools.fun");
  });

  test("the public profile drops red flags and every note, and keeps the rest", () => {
    const p = publicProfile(arctools);
    expect(p).not.toHaveProperty("redFlags");
    expect(JSON.stringify(p)).not.toContain("HANDOVER");
    expect(JSON.stringify(p)).not.toContain("note");
    expect(p.deployers[0]).toEqual({ address: arctools.deployers[0].address, sourceUrl: "https://example/tx" });
    expect(p.contracts[0]).toEqual({ address: arctools.contracts[0].address, label: "swap router" });
    expect(p.metrics).toEqual(["users", "holders", "x-posts"]);
  });

  test("the nine metrics are the agreed set", () => {
    expect(METRIC_IDS).toEqual(["deploys", "txs", "users", "holders", "price", "mcap", "volume", "x-posts", "x-followers"]);
  });
});

describe("validateProfile", () => {
  const ok = {
    source: "domain:arctools.fun",
    name: "ArcTools",
    website: "arctools.fun",
    x: "https://x.com/ArcToolsBackup",
    xChecked: true,
    deployers: [{ address: "0x408C3D3FD36FDF84888F343417787D8710E76FE8", note: "7 CREATEs", sourceUrl: "https://github.com/ArcToolsRepo/arctools" }],
    contracts: [{ address: "0x43CdbF8edb8fE41ddE4ba519F49499D1ED78E74A", label: "swap router" }],
    token: { address: "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52" },
    metrics: ["users", "holders", "x-posts"],
    redFlags: ["deployer key exposed"],
  };

  test("a good profile is normalised: lowercase addresses, @handle, https website, sorted unique metrics", () => {
    const r = validateProfile({ ...ok, metrics: ["x-posts", "users", "holders", "users"] }, "domain:arctools.fun");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.website).toBe("https://arctools.fun");
    expect(r.value.x).toBe("@ArcToolsBackup");
    expect(r.value.deployers[0].address).toBe("0x408c3d3fd36fdf84888f343417787d8710e76fe8");
    expect(r.value.contracts[0].address).toBe("0x43cdbf8edb8fe41dde4ba519f49499d1ed78e74a");
    expect(r.value.metrics).toEqual(["users", "holders", "x-posts"]);
  });

  test("the profile's source must match the path's", () => {
    expect(validateProfile(ok, "domain:other.fun")).toMatchObject({ ok: false });
    expect(validateProfile({ ...ok, source: "not a source" }, "not a source")).toMatchObject({ ok: false });
  });

  test("each metric needs what it measures", () => {
    expect(validateProfile({ ...ok, deployers: [], metrics: ["deploys"] }, ok.source)).toMatchObject({ ok: false, error: expect.stringMatching(/deployer/) });
    expect(validateProfile({ ...ok, contracts: [], metrics: ["users"] }, ok.source)).toMatchObject({ ok: false, error: expect.stringMatching(/contract/) });
    expect(validateProfile({ ...ok, token: undefined, metrics: ["price"] }, ok.source)).toMatchObject({ ok: false, error: expect.stringMatching(/token/) });
    expect(validateProfile({ ...ok, x: undefined, metrics: ["x-followers"] }, ok.source)).toMatchObject({ ok: false, error: expect.stringMatching(/X/) });
  });

  test("bad addresses, unknown metrics, non-https links and oversize lists are refused", () => {
    expect(validateProfile({ ...ok, deployers: [{ address: "0x123" }] }, ok.source)).toMatchObject({ ok: false });
    expect(validateProfile({ ...ok, metrics: ["tvl"] }, ok.source)).toMatchObject({ ok: false });
    expect(validateProfile({ ...ok, contracts: [{ address: ok.contracts[0].address, label: "x", sourceUrl: "javascript:alert(1)" }] }, ok.source)).toMatchObject({ ok: false });
    expect(validateProfile({ ...ok, contracts: Array.from({ length: 21 }, () => ok.contracts[0]) }, ok.source)).toMatchObject({ ok: false });
    expect(validateProfile({ ...ok, contracts: [{ address: ok.contracts[0].address, label: "" }] }, ok.source)).toMatchObject({ ok: false });
  });

  test("an address declared twice in one list is refused", () => {
    expect(validateProfile({ ...ok, deployers: [ok.deployers[0], { address: ok.deployers[0].address.toLowerCase() }] }, ok.source)).toMatchObject({ ok: false });
  });

  test("server-set fields from the body are ignored", () => {
    const r = validateProfile({ ...ok, declaredBy: "0xevil", declaredAt: "1999" }, ok.source);
    expect(r.ok && r.value).not.toHaveProperty("declaredBy");
  });
});

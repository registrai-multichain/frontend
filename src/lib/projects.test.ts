import { describe, expect, test } from "vitest";
import { METRIC_IDS, projectPath, publicProfile, type ProjectProfile } from "./projects";

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

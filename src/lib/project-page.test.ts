import { describe, expect, test } from "vitest";
import { evidenceLabel, factsPath, groupFacts, pageState, parseSourceParam } from "./project-page";
import type { Fact } from "./facts";

const f = (id: string, topic: Fact["topic"], observedAt: string, extra: Partial<Fact> = {}): Fact =>
  ({ id, topic, text: id, evidence: ["https://a.io"], observedAt, updatedAt: observedAt, ...extra });

describe("project page view-model", () => {
  test("parseSourceParam accepts canonical domain and github sources only", () => {
    expect(parseSourceParam("domain:kairo.market")).toBe("domain:kairo.market");
    expect(parseSourceParam(encodeURIComponent("github:owner/repo"))).toBe("github:owner/repo");
    expect(parseSourceParam("domain:Kairo.Market")).toBeNull();
    expect(parseSourceParam("javascript:alert(1)")).toBeNull();
    expect(parseSourceParam(null)).toBeNull();
    expect(factsPath("github:owner/repo")).toBe("/api/facts/github%3Aowner%2Frepo");
  });
  test("groupFacts orders topics, drops empty ones, splits superseded, newest first", () => {
    const g = groupFacts([
      f("t1", "token", "2026-09-01T00:00:00Z"),
      f("c1", "control", "2026-09-01T00:00:00Z", { supersededBy: "c2" }),
      f("c2", "control", "2026-09-20T00:00:00Z"),
      f("c3", "control", "2026-09-10T00:00:00Z"),
    ]);
    expect(g.map((x) => x.topic)).toEqual(["control", "token"]);
    expect(g[0].current.map((x) => x.id)).toEqual(["c2", "c3"]);
    expect(g[0].superseded.map((x) => x.id)).toEqual(["c1"]);
  });
  test("evidenceLabel shortens addresses, hashes and urls", () => {
    expect(evidenceLabel("0xdaf97c69eb8fb68ca9f4269eb8c458b3a5a31122")).toBe("0xdaf9…1122");
    expect(evidenceLabel("0xe95f4d088a96b698bcc9996a5a00e917a5cd2b1610fb8c62545050710ad7fcd0")).toBe("tx 0xe95f…d0");
    expect(evidenceLabel("https://kairo.market/docs/contracts")).toBe("kairo.market/docs/contracts");
  });
  test("pageState: both missing, one missing, loading", () => {
    expect(pageState(null, null)).toEqual({ kind: "loading" });
    expect(pageState({ status: 404, body: {} }, { status: 404, body: {} })).toEqual({ kind: "missing" });
    const facts = { source: "domain:x.io", facts: [], changelog: [], lastReviewedAt: "", reviewedBy: "", rev: 1 };
    expect(pageState({ status: 404, body: {} }, { status: 200, body: { facts } })).toEqual({ kind: "ready", profile: null, facts });
    const s = pageState({ status: 200, body: { profile: { name: "X" }, feeds: [] } }, { status: 404, body: {} });
    expect(s.kind === "ready" && s.profile?.name).toBe("X");
    expect(s.kind === "ready" && s.facts).toBeNull();
  });
});

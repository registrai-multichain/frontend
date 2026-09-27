import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { validateDraft } from "./drafts";

const DIR = resolve(__dirname, "../../../docs/superpowers/investigations/drafts");

const good = {
  source: "domain:arctools.fun",
  invite: { name: "ArcTools", x: "@ArcToolsBackup" },
  recommendation: "nominate",
  summary: "17 contracts from 2 team wallets.",
  investigation: "docs/superpowers/investigations/domain-arctools-fun.md",
  investigatedAt: "2026-09-27",
  investigatedBy: "arc-80",
  profile: { source: "domain:arctools.fun", name: "ArcTools", website: "https://arctools.fun", deployers: [], contracts: [], metrics: [] },
};

describe("validateDraft", () => {
  test("a good draft is accepted, its profile normalised", () => {
    const r = validateDraft({ ...good, profile: { ...good.profile, website: "arctools.fun" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.profile.website).toBe("https://arctools.fun");
  });

  test("the recommendation, summary, investigation path and source are checked", () => {
    expect(validateDraft({ ...good, recommendation: "maybe" })).toMatchObject({ ok: false });
    expect(validateDraft({ ...good, summary: "a".repeat(301) })).toMatchObject({ ok: false });
    expect(validateDraft({ ...good, investigation: "/etc/passwd" })).toMatchObject({ ok: false });
    expect(validateDraft({ ...good, investigation: "docs/superpowers/investigations/../../x.md" })).toMatchObject({ ok: false });
    expect(validateDraft({ ...good, source: "domain:other.fun" })).toMatchObject({ ok: false, error: expect.stringMatching(/match/) });
  });

  test("the invite needs a name; its X is normalised", () => {
    expect(validateDraft({ ...good, invite: { name: "" } })).toMatchObject({ ok: false });
    const r = validateDraft({ ...good, invite: { name: "ArcTools", x: "x.com/ArcToolsBackup" } });
    expect(r.ok && r.value.invite.x).toBe("@ArcToolsBackup");
  });

  test("every draft arc-80 prepared passes", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const r = validateDraft(JSON.parse(readFileSync(resolve(DIR, f), "utf8")));
      expect(r, f).toMatchObject({ ok: true });
    }
  });
});

import { describe, expect, test } from "vitest";
import { SUGGEST_LIMITS, suggestionInvite, suggestionMessage, validateSuggestion } from "./suggestions";

const base = { name: "Acme Tool", website: "https://acme.dev", x: "@acmetool" };

describe("validateSuggestion", () => {
  test("a project with a website and an X account is accepted; its key is the website's domain", () => {
    const r = validateSuggestion(base);
    expect(r).toEqual({
      ok: true,
      value: { source: "domain:acme.dev", name: "Acme Tool", website: "https://acme.dev", x: "@acmetool" },
    });
  });

  test("a GitHub repo, when given, becomes the key (markets need one)", () => {
    const r = validateSuggestion({ ...base, github: "https://github.com/Acme/Tool" });
    expect(r.ok && r.value.source).toBe("github:acme/tool");
    expect(r.ok && r.value.github).toBe("github:acme/tool");
  });

  test("the website is required", () => {
    expect(validateSuggestion({ ...base, website: "" })).toMatchObject({ ok: false, field: "website" });
    expect(validateSuggestion({ ...base, website: "not a site" })).toMatchObject({ ok: false, field: "website" });
    expect(validateSuggestion({ ...base, website: "ftp://acme.dev" })).toMatchObject({ ok: false, field: "website" });
  });

  test("social proof is required: an X account or another public link", () => {
    expect(validateSuggestion({ name: "Acme", website: "acme.dev" })).toMatchObject({ ok: false, field: "x" });
    const r = validateSuggestion({ name: "Acme", website: "acme.dev", social: "https://warpcast.com/acme" });
    expect(r).toMatchObject({ ok: true, value: { social: "https://warpcast.com/acme" } });
  });

  test("an X account is normalised to @handle; a bad one is refused", () => {
    expect(validateSuggestion({ ...base, x: "https://x.com/AcmeTool" })).toMatchObject({ ok: true, value: { x: "@AcmeTool" } });
    expect(validateSuggestion({ ...base, x: "twitter.com/acme_tool/" })).toMatchObject({ ok: true, value: { x: "@acme_tool" } });
    expect(validateSuggestion({ ...base, x: "@way_too_long_handle_here" })).toMatchObject({ ok: false, field: "x" });
  });

  test("the other social link must be an https URL", () => {
    expect(validateSuggestion({ ...base, social: "javascript:alert(1)" })).toMatchObject({ ok: false, field: "social" });
    expect(validateSuggestion({ ...base, social: "http://t.me/acme" })).toMatchObject({ ok: false, field: "social" });
  });

  test("a GitHub field that is not a repo is refused", () => {
    expect(validateSuggestion({ ...base, github: "acme.dev" })).toMatchObject({ ok: false, field: "github" });
  });

  test("the name is required and every field is length-capped", () => {
    expect(validateSuggestion({ ...base, name: "  " })).toMatchObject({ ok: false, field: "name" });
    expect(validateSuggestion({ ...base, name: "a".repeat(SUGGEST_LIMITS.name + 1) })).toMatchObject({ ok: false, field: "name" });
    expect(validateSuggestion({ ...base, why: "a".repeat(SUGGEST_LIMITS.why + 1) })).toMatchObject({ ok: false, field: "why" });
  });

  test("the suggester's own X handle is optional", () => {
    expect(validateSuggestion({ ...base, by: "@alice" })).toMatchObject({ ok: true, value: { by: "@alice" } });
    expect(validateSuggestion({ ...base, by: "not a handle!" })).toMatchObject({ ok: false, field: "by" });
  });

  test("anything but a JSON object is refused", () => {
    expect(validateSuggestion(null)).toMatchObject({ ok: false });
    expect(validateSuggestion([base])).toMatchObject({ ok: false });
    expect(validateSuggestion({ ...base, name: 42 })).toMatchObject({ ok: false, field: "name" });
  });
});

describe("suggestionInvite", () => {
  const rec = {
    source: "github:acme/tool",
    name: "Acme Tool",
    website: "https://acme.dev",
    github: "github:acme/tool",
    x: "@acmetool",
    social: "https://t.me/acme",
    why: "ships every week",
    by: ["@alice", "@bob"],
    count: 3,
  };

  test("an invite carries the project's key, name and X; the evidence goes in the private note", () => {
    const b = suggestionInvite(rec);
    expect(b).toMatchObject({ source: "github:acme/tool", name: "Acme Tool", x: "@acmetool" });
    expect(b.note).toContain("Suggested by 3 (@alice, @bob)");
    expect(b.note).toContain("https://acme.dev");
    expect(b.note).toContain("https://t.me/acme");
    expect(b.note).toContain("ships every week");
  });

  test("the note fits the invite's 500-character limit", () => {
    const b = suggestionInvite({ ...rec, why: "a".repeat(280), social: `https://t.me/${"b".repeat(180)}` });
    expect(b.note.length).toBeLessThanOrEqual(500);
  });

  test("without an X account the invite has none", () => {
    expect(suggestionInvite({ ...rec, x: undefined })).not.toHaveProperty("x");
  });
});

describe("suggestionMessage", () => {
  const v = { source: "github:acme/tool", name: "Acme Tool", website: "https://acme.dev", github: "github:acme/tool", x: "@acmetool" };

  test("is a readable message naming the project, its links and the time, on its own lines", () => {
    const m = suggestionMessage(v, "2026-09-27T12:00:00.000Z");
    expect(m).toBe(
      [
        "Registrai: suggest a project",
        "Project: Acme Tool",
        "Key: github:acme/tool",
        "Website: https://acme.dev",
        "X: @acmetool",
        "Other link: -",
        "GitHub: github:acme/tool",
        "Issued: 2026-09-27T12:00:00.000Z",
      ].join("\n"),
    );
  });

  test("any change to the suggestion or the time changes the message", () => {
    const a = suggestionMessage(v, "2026-09-27T12:00:00.000Z");
    expect(suggestionMessage({ ...v, x: "@other" }, "2026-09-27T12:00:00.000Z")).not.toBe(a);
    expect(suggestionMessage(v, "2026-09-27T12:00:01.000Z")).not.toBe(a);
  });

  test("a newline in the name cannot forge an extra line", () => {
    const m = suggestionMessage({ ...v, name: "Acme\nIssued: 1999" }, "2026-09-27T12:00:00.000Z");
    expect(m.split("\n").filter((l) => l.startsWith("Issued:"))).toHaveLength(1);
  });
});

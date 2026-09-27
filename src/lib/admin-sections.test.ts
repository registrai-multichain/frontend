import { describe, expect, test } from "vitest";
import { ADMIN_SECTIONS, adminNav, adminSections, sectionFromHash } from "./admin-sections";
import { adminView } from "./builders-admin";

const ALL = { registry: true, nominations: true, wonder: true };
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("adminSections: the rail follows adminView, as the page gated its sections before", () => {
  test("an admin sees every deployed section, in rail order", () => {
    expect(ids(adminSections(adminView("admin"), ALL))).toEqual([
      "invites", "register-requests", "suggestions", "onboarding", "badges", "recovery", "projects", "nominations", "wonder",
    ]);
  });
  test("an onboarder has no badges, recovery, projects or wonder; nominations stay (directOnboard)", () => {
    expect(ids(adminSections(adminView("onboarder"), ALL))).toEqual(["invites", "register-requests", "suggestions", "onboarding", "nominations"]);
  });
  test("what is not deployed is left out", () => {
    expect(ids(adminSections(adminView("admin"), { registry: false, nominations: false, wonder: false }))).toEqual([
      "invites", "register-requests", "suggestions", "onboarding", "badges", "recovery",
    ]);
  });
  test("every section has a heading and a one-line lede", () => {
    for (const s of ADMIN_SECTIONS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.lede).not.toMatch(/\n/);
    }
  });
});

describe("sectionFromHash", () => {
  const admin = adminSections(adminView("admin"), ALL);
  const onboarder = adminSections(adminView("onboarder"), ALL);
  test("no hash or an unknown one: Invites", () => {
    expect(sectionFromHash("", admin)).toBe("invites");
    expect(sectionFromHash("#", admin)).toBe("invites");
    expect(sectionFromHash("#nope", admin)).toBe("invites");
  });
  test("a known hash picks its section", () => {
    expect(sectionFromHash("#badges", admin)).toBe("badges");
    expect(sectionFromHash("#register-requests", admin)).toBe("register-requests");
    expect(sectionFromHash("#Suggestions", admin)).toBe("suggestions");
    expect(sectionFromHash("#wonder", admin)).toBe("wonder");
  });
  test("a section the session does not have falls back to Invites", () => {
    expect(sectionFromHash("#badges", onboarder)).toBe("invites");
    expect(sectionFromHash("#nominations", onboarder)).toBe("nominations");
  });
});

describe("adminNav", () => {
  const sections = adminSections(adminView("admin"), ALL);
  test("hash links on /admin, /admin/#… links from /admin/proposals, then Market proposals", () => {
    const here = adminNav(sections, "");
    expect(here[0]).toEqual({ key: "invites", label: "Invites", href: "#invites", count: null });
    expect(here.at(-1)).toEqual({ key: "proposals", label: "Market proposals", href: "/admin/proposals/", count: null });
    const there = adminNav(sections, "/admin/", { proposals: 0 });
    // The hashes /admin/proposals always linked to keep working.
    expect(there.slice(0, 3).map((i) => i.href)).toEqual(["/admin/#invites", "/admin/#register-requests", "/admin/#suggestions"]);
    expect(there.at(-1)?.count).toBe(0);
  });
  test("counts land on their section", () => {
    const nav = adminNav(sections, "", { suggestions: 3, onboarding: null });
    expect(nav.find((i) => i.key === "suggestions")?.count).toBe(3);
    expect(nav.find((i) => i.key === "onboarding")?.count).toBeNull();
  });
});

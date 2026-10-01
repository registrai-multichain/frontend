import { describe, expect, test } from "vitest";
import { ADMIN_SECTIONS, adminNav, adminSections, sectionFromHash, sectionLede, signedOutSections } from "./admin-sections";
import { adminView } from "./builders-admin";

const ALL = { registry: true, nominations: true, wonder: true };
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("adminSections: the rail follows adminView, as the page gated its sections before", () => {
  test("an admin sees every deployed section, in rail order", () => {
    expect(ids(adminSections(adminView("admin"), ALL))).toEqual([
      "invites", "register-requests", "suggestions", "onboarding", "badges", "recovery", "projects", "nominations", "facts", "wonder",
    ]);
  });
  test("an onboarder has no badges, recovery, projects or wonder; nominations stay (directOnboard)", () => {
    expect(ids(adminSections(adminView("onboarder"), ALL))).toEqual(["invites", "register-requests", "suggestions", "onboarding", "nominations", "facts"]);
  });
  test("what is not deployed is left out", () => {
    expect(ids(adminSections(adminView("admin"), { registry: false, nominations: false, wonder: false }))).toEqual([
      "invites", "register-requests", "suggestions", "onboarding", "badges", "recovery", "facts",
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
    expect(here[0]).toEqual({ key: "invites", label: "Invites", href: "#invites", count: null, busy: false, current: "location" });
    expect(here.at(-1)).toEqual({ key: "proposals", label: "Market proposals", href: "/admin/proposals/", count: null, busy: false, current: "page" });
    const there = adminNav(sections, "/admin/", { proposals: 0 });
    // The hashes /admin/proposals always linked to keep working.
    expect(there.slice(0, 3).map((i) => i.href)).toEqual(["/admin/#invites", "/admin/#register-requests", "/admin/#suggestions"]);
    expect(there.at(-1)?.count).toBe(0);
    // From /admin/proposals the sections are other pages.
    expect(there[0].current).toBe("page");
  });
  test("a section with work in progress is marked busy", () => {
    const nav = adminNav(sections, "", {}, new Set(["onboarding"]));
    expect(nav.filter((i) => i.busy).map((i) => i.key)).toEqual(["onboarding"]);
  });
  test("counts land on their section", () => {
    const nav = adminNav(sections, "", { suggestions: 3, onboarding: null });
    expect(nav.find((i) => i.key === "suggestions")?.count).toBe(3);
    expect(nav.find((i) => i.key === "onboarding")?.count).toBeNull();
  });
});

describe("before sign-in and by role", () => {
  test("signed out, the rail has only the sections every role has", () => {
    const out = ids(signedOutSections(ALL, adminView("onboarder")));
    expect(out).toEqual(["invites", "register-requests", "suggestions", "onboarding", "nominations", "facts"]);
    for (const id of ["badges", "recovery", "projects", "wonder"]) expect(out).not.toContain(id);
    // Every one of them is also an admin's and an onboarder's.
    const admin = ids(adminSections(adminView("admin"), ALL));
    const onboarder = ids(adminSections(adminView("onboarder"), ALL));
    for (const id of out) expect(admin.includes(id) && onboarder.includes(id)).toBe(true);
  });
  test("an onboarder reads neutral ledes where it cannot act", () => {
    const invites = ADMIN_SECTIONS.find((s) => s.id === "invites")!;
    const suggestions = ADMIN_SECTIONS.find((s) => s.id === "suggestions")!;
    expect(sectionLede(invites, adminView("admin"))).toMatch(/^Invite a project/);
    expect(sectionLede(invites, adminView("onboarder"))).not.toMatch(/invite a project/i);
    expect(sectionLede(suggestions, adminView("admin"))).toMatch(/invite it or dismiss it/);
    expect(sectionLede(suggestions, adminView("onboarder"))).not.toMatch(/invite|dismiss/i);
    const onboarding = ADMIN_SECTIONS.find((s) => s.id === "onboarding")!;
    expect(sectionLede(onboarding, adminView("onboarder"))).toBe(onboarding.lede);
    // An onboarder reads the public view of facts (the API leaves embargoed ones out), and the lede says so.
    const facts = ADMIN_SECTIONS.find((s) => s.id === "facts")!;
    expect(sectionLede(facts, adminView("onboarder"))).toMatch(/public view/i);
    expect(sectionLede(facts, adminView("onboarder"))).toMatch(/embargo/i);
  });
});

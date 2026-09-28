import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/components/proposals/fonts", () => ({ newsreader: { variable: "font-newsreader" } }));

const { AdminShell } = await import("./AdminShell");

const NAV = [
  { key: "invites", label: "Invites", href: "#invites", current: "location" as const },
  { key: "suggestions", label: "Project suggestions", href: "#suggestions", count: 3, current: "location" as const },
  { key: "onboarding", label: "Onboarding", href: "#onboarding", busy: true, current: "location" as const },
  { key: "proposals", label: "Market proposals", href: "/admin/proposals/", count: null },
];

function render(active: string | null, who: { address: string; role: "admin" | "onboarder" } | null) {
  const html = renderToStaticMarkup(
    <AdminShell nav={NAV} active={active} who={who}>
      <p>body</p>
    </AdminShell>,
  );
  const doc = html;
  const links = [...doc.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map((m) => ({ attrs: m[1], text: m[2].replace(/<[^>]+>/g, "") }));
  return { html, links };
}

describe("AdminShell", () => {
  test("the rail is a nav labelled Admin, with every link in order", () => {
    const { html, links } = render("invites", null);
    expect(html).toMatch(/<nav [^>]*aria-label="Admin"/);
    expect(html).toContain("Registrai admin");
    expect(links.map((l) => l.attrs.match(/href="([^"]+)"/)?.[1])).toEqual(["#invites", "#suggestions", "#onboarding", "/admin/proposals/"]);
    expect(html).toContain("<main");
    expect(html).toContain("<p>body</p>");
  });
  test("only the active item is marked current: a section as a location, another page as a page", () => {
    const { links } = render("suggestions", null);
    const current = links.filter((l) => l.attrs.includes("aria-current"));
    expect(current).toHaveLength(1);
    expect(current[0].text).toContain("Project suggestions");
    expect(current[0].attrs).toContain('aria-current="location"');
    const page = render("proposals", null).links.filter((l) => l.attrs.includes("aria-current"));
    expect(page).toHaveLength(1);
    expect(page[0].attrs).toContain('aria-current="page"');
    // No active section (the sign-in screen): nothing is current.
    expect(render(null, null).links.some((l) => l.attrs.includes("aria-current"))).toBe(false);
  });
  test("a count shows as a badge, on active and inactive links alike; none without a count", () => {
    const active = render("suggestions", null).links.find((l) => l.text.startsWith("Project suggestions"))!;
    expect(active.text).toMatch(/Project suggestions\s*3$/);
    const inactive = render("invites", null).links.find((l) => l.text.startsWith("Project suggestions"))!;
    expect(inactive.text).toMatch(/Project suggestions\s*3$/);
    expect(render("invites", null).links.find((l) => l.text.startsWith("Market proposals"))!.text.trim()).toBe("Market proposals");
  });
  test("a busy section shows a working dot and label, active or not", () => {
    const item = (active: string) => render(active, null).links.find((l) => l.text.startsWith("Onboarding"))!;
    expect(item("invites").text).toMatch(/Onboarding\s*working$/);
    expect(item("onboarding").text).toMatch(/Onboarding\s*working$/);
    expect(render("invites", null).links.find((l) => l.text.startsWith("Invites"))!.text).not.toContain("working");
  });
  test("the foot says who is signed in, with the role", () => {
    const admin = render("invites", { address: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955", role: "admin" }).html;
    expect(admin).toMatch(/Signed in as <br\/?>\s*<span[^>]*>0x14dc…9955<\/span> · admin/);
    const onboarder = render("invites", { address: "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f", role: "onboarder" }).html;
    expect(onboarder).toContain("· onboarder");
    expect(render("invites", null).html).toContain("Not signed in");
  });
});

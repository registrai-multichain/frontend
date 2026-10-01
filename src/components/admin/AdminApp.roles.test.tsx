/**
 * /admin for both session roles: which sections the rail and the page carry, and which
 * actions each section offers (adminView gating, unchanged by the restyle). The signed-in
 * dashboard is rendered on the server with its reads filled from SWR's fallback, so no
 * request is made; the wallet is a disconnected stub.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig, unstable_serialize } from "swr";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/components/proposals/fonts", () => ({ newsreader: { variable: "font-newsreader" } }));
vi.mock("@/components/WalletProvider", () => ({
  useWallet: () => ({
    address: undefined,
    walletChainId: undefined,
    walletClient: undefined,
    isConnecting: false,
    error: undefined,
    connect: async () => undefined,
    disconnect: () => undefined,
    switchChain: async () => undefined,
  }),
}));

const { Dashboard } = await import("./AdminApp");
const { BUILDERS } = await import("@/lib/builders-network");
const { NOMINATIONS } = await import("@/lib/nominations");

const REG = BUILDERS.contracts.BuilderRegistry;
const NOW = "2026-09-27T12:00:00.000Z";
const profile = (source: string, name: string) => ({ source, name, website: `https://${name.toLowerCase()}.example`, deployers: [], contracts: [], metrics: [] });
const draft = (source: string, name: string) => ({
  source,
  invite: { name },
  recommendation: "nominate",
  summary: `${name} ships on Arc.`,
  investigation: `docs/superpowers/investigations/${name.toLowerCase()}.md`,
  investigatedAt: "2026-09-26",
  investigatedBy: "arc-80",
  profile: profile(source, name),
});

const FALLBACK = {
  "admin-invites": [
    { source: "domain:beta.example", name: "Beta", x: "@beta", code: "c0de", createdAt: NOW, createdBy: "0xabc", opens: 0, claimLink: "https://builder.registrai.cc/verify/?invite=c0de" },
  ],
  // One claimed builder awaiting onboarding: the onboarding queue has a row and a Safe batch.
  [unstable_serialize(["admin-chain", BUILDERS.chainId, REG])]: [
    {
      id: 7,
      owner: "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
      status: "pending",
      profileURI: "",
      projects: [{ id: 9, source: "domain:epsilon.example", active: true, status: "verified", country: null, proofUrl: null }],
      country: null,
      badge: null,
      createdAt: 0,
    },
  ],
  // The register request's proof re-checked as valid: a registerFor to put in the Safe batch.
  [unstable_serialize(["admin-register-proofs", "domain:delta.example|0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc"])]: new Map([["domain:delta.example", true]]),
  "admin-suggestions": [
    { source: "domain:gamma.example", name: "Gamma", website: "https://gamma.example", by: [], wallets: ["0x70997970c51812dc3a010c7d01b50e0d17dc79c8"], count: 1, firstAt: NOW, lastAt: NOW },
  ],
  "admin-register-requests": [{ source: "domain:delta.example", builder: "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc", requestedAt: NOW }],
  // Alpha: not invited (its step is "invite"). Beta: invited and saved ("save", "nominate").
  "admin-drafts": [draft("domain:alpha.example", "Alpha"), draft("domain:beta.example", "Beta")],
  "admin-projects-saved": new Map([["domain:beta.example", profile("domain:beta.example", "Beta")]]),
  ...(NOMINATIONS ? { [unstable_serialize(["admin-nominations", NOMINATIONS])]: new Map() } : {}),
};

function render(role: "admin" | "onboarder") {
  return renderToStaticMarkup(
    <SWRConfig value={{ fallback: FALLBACK, provider: () => new Map() }}>
      <Dashboard admin="0x14dC79964da2C08b23698B3D3cc7Ca32193d9955" role={role} revocationCheckpoint={null} onSignedOut={() => undefined} />
    </SWRConfig>,
  );
}
const buttons = (html: string, label: string) => html.split(new RegExp(`>${label}</button>`)).length - 1;
/** The mounted sections (in mount order, which keeps the old page's order; sorted to compare). */
const sections = (html: string) => [...html.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]).sort();
const rail = (html: string) => [...html.matchAll(/<a [^>]*href="(#[^"]+|\/admin\/proposals\/)"/g)].map((m) => m[1]);

describe("/admin by role", () => {
  const admin = render("admin");
  const onboarder = render("onboarder");

  test("the rail and the mounted sections follow the role", () => {
    const all = ["invites", "register-requests", "suggestions", "onboarding", "badges", "recovery", "projects"];
    const nom = NOMINATIONS ? ["nominations", "facts"] : ["facts"];
    expect(sections(admin)).toEqual([...all, ...nom].sort());
    expect(rail(admin)).toEqual([...[...all, ...nom].map((s) => `#${s}`), "/admin/proposals/"]);
    expect(sections(onboarder)).toEqual(["invites", "register-requests", "suggestions", "onboarding", ...nom].sort());
    expect(rail(onboarder)).toEqual(["#invites", "#register-requests", "#suggestions", "#onboarding", ...nom.map((s) => `#${s}`), "/admin/proposals/"]);
  });

  test("every section is mounted; only the active one (Invites, no hash) is shown", () => {
    expect(admin).toMatch(/data-section="invites"(?![^>]*hidden)/);
    for (const s of ["suggestions", "badges", "recovery"]) expect(admin).toMatch(new RegExp(`hidden=""[^>]*data-section="${s}"`));
    expect(admin).toMatch(/Signed in as <br\/?>.*· admin/);
    expect(onboarder).toMatch(/Signed in as <br\/?>.*· onboarder/);
    expect(onboarder).toContain("Onboarder session.");
  });

  test("register requests: the admin downloads the Safe batch, an onboarder is told an admin does", () => {
    const req = (html: string) => html.slice(html.indexOf('data-section="register-requests"'), html.indexOf('data-section="onboarding"'));
    expect(req(admin)).toMatch(/>Download Safe batch \(1 tx\)<\/button>/);
    expect(req(admin)).toContain("registerFor(");
    expect(req(admin)).not.toContain("an admin downloads the batch");
    expect(req(onboarder)).not.toContain("Download Safe batch");
    expect(req(onboarder)).toContain("The Safe registers these (1 tx): an admin downloads the batch.");
  });

  test("onboarding queue: the Safe batch is the admin's; both see the builder", () => {
    const q = (html: string) => html.slice(html.indexOf('data-section="onboarding"'), html.indexOf("</main>"));
    for (const html of [admin, onboarder]) expect(q(html)).toContain("builder #7");
    expect(q(admin)).toContain("Or: the Safe batch");
    expect(q(admin)).toMatch(/>Download Safe batch \(\d+ tx\)<\/button>/);
    expect(q(onboarder)).not.toContain("Or: the Safe batch");
    expect(q(onboarder)).not.toContain("Download Safe batch");
  });

  test("ledes: an onboarder, who cannot invite, reads the neutral wording", () => {
    expect(admin).toContain("Invite a project, send its claim link");
    expect(onboarder).not.toContain("Invite a project, send its claim link");
    expect(onboarder).toContain("Invited projects, their claim links");
    expect(admin).toContain("invite it or dismiss it");
    expect(onboarder).not.toContain("invite it or dismiss it");
  });

  test("invites: the form and edit/delete are the admin's; both copy the link and the DM", () => {
    expect(admin).toContain("Create invite");
    expect(onboarder).not.toContain("Create invite");
    for (const [html, n] of [[admin, 1], [onboarder, 0]] as const) {
      expect(buttons(html, "edit")).toBe(n);
      expect(buttons(html, "delete")).toBe(n);
      expect(buttons(html, "link")).toBe(1);
      expect(buttons(html, "DM")).toBe(1);
    }
  });

  test("suggestions keep their signed-by wallets; invite and dismiss are the admin's", () => {
    for (const html of [admin, onboarder]) expect(html).toMatch(/signed by.*0x7099…79c8/);
    expect(buttons(admin, "invite")).toBe(1);
    expect(buttons(onboarder, "invite")).toBe(0);
    // dismiss: the suggestion's and the register request's
    expect(buttons(admin, "dismiss")).toBe(2);
    expect(buttons(onboarder, "dismiss")).toBe(0);
  });

  test.runIf(Boolean(NOMINATIONS))("nominations: the drafts' actions follow draftStep and the role", () => {
    // Alpha (not invited): Invite. Beta (invited, saved): Save profile again, Nominate, Safe file.
    expect(buttons(admin, "Invite")).toBe(1);
    expect(buttons(admin, "Save profile again")).toBe(1);
    expect(buttons(admin, "Safe file")).toBe(1);
    expect(buttons(admin, "drop")).toBe(2);
    expect(buttons(admin, "details")).toBe(2);
    // Beta's Nominate and the manual form's
    expect(buttons(admin, "Nominate")).toBe(2);
    expect(buttons(admin, "Un-nominate")).toBe(1);
    expect(buttons(admin, "Safe file: nominate")).toBe(1);

    expect(buttons(onboarder, "Invite")).toBe(0);
    expect(buttons(onboarder, "Save profile again")).toBe(0);
    expect(buttons(onboarder, "Safe file")).toBe(0);
    expect(buttons(onboarder, "drop")).toBe(0);
    expect(buttons(onboarder, "details")).toBe(2);
    expect(buttons(onboarder, "Nominate")).toBe(2);
    expect(buttons(onboarder, "Un-nominate")).toBe(1);
    expect(buttons(onboarder, "Safe file: nominate")).toBe(0);
  });

  test("the Onboarding chip keeps its name", () => {
    // InviteChainStatus "nominated" reads "Onboarding" (renamed from "Nominated" on purpose).
    const src = readFileSync(new URL("./AdminApp.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/data-kind="nominated"[^>]*>\s*Onboarding\{/);
  });
});

import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";

const E: ArcEntity[] = [
  { slug: "aave", name: "Aave", category: "lending", status: "announced", summary: "Lending.", status_evidence: [{ url: "https://www.arc.io/pressroom/a" }], sources: [{ url: "https://aave.com/" }], last_reviewed: "2026-10-20" },
];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() } }));
vi.mock("../lib/apps-data", async (orig) => ({ ...(await orig<typeof import("../lib/apps-data")>()), loadApp: async () => "unknown" }));

const OPEN = { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET: "s", DATA_DB: {} };
const route = async (path: string, env: Record<string, unknown> = {}) => {
  const { onRequest } = await import("../functions/ecosystem/[[path]]");
  const u = new URL(`https://builder.registrai.cc${path}`);
  const parts = u.pathname.replace(/^\/ecosystem\/?/, "").split("/").filter(Boolean);
  return onRequest({ request: new Request(u), env: { INVITES: { get: async () => null }, ...env }, params: { path: parts }, waitUntil: () => undefined } as never);
};

describe("correction form", () => {
  test("open: the form posts to the API with every field, Turnstile and the disclosure", async () => {
    const r = await route("/ecosystem/aave/correct/", OPEN);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const h = await r.text();
    expect(h).toContain('<form method="post" action="/api/ecosystem/corrections">');
    for (const n of ['name="slug" value="aave"', 'name="field"', 'name="text"', 'name="source_url"', 'name="email"', 'name="name"']) expect(h, n).toContain(n);
    expect(h).toContain('<option value="removal">Remove this listing</option>');
    expect(h).toContain('class="cf-turnstile" data-sitekey="site-key"');
    expect(h).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
    expect(h).toContain("We use your email only to reply about this correction. Approved corrections are published without your name or email.");
    expect(h).toContain('<meta name="robots" content="noindex">');
  });
  test("?sent=1 → Received; ?error=rate → its fixed message; unknown codes are ignored", async () => {
    const sent = await (await route("/ecosystem/aave/correct/?sent=1", OPEN)).text();
    expect(sent).toContain("<h1>Received</h1>");
    expect(sent).toContain("We review corrections within 7 days.");
    expect(sent).toContain('href="/ecosystem/aave/"');
    expect(await (await route("/ecosystem/aave/correct/?error=rate", OPEN)).text()).toContain("Too many corrections from you today.");
    const odd = await (await route("/ecosystem/aave/correct/?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E", OPEN)).text();
    expect(odd).not.toContain("<script>alert");
    expect(odd).not.toContain('role="alert"');
  });
  test("closed (no keys): mailto fallback, no form; the project page keeps both mailto links", async () => {
    const h = await (await route("/ecosystem/aave/correct/")).text();
    expect(h).not.toContain("<form");
    expect(h).toContain("mailto:contact@registrai.cc");
    const p = await (await route("/ecosystem/aave/")).text();
    expect(p).toContain(">Report an error</a>");
    expect(p).toContain(">Ask for removal</a>");
  });
  test("open: the project page links the form instead of the mailto links", async () => {
    const p = await (await route("/ecosystem/aave/", OPEN)).text();
    expect(p).toContain('<a href="/ecosystem/aave/correct/">Suggest a correction</a>');
    expect(p).not.toContain("Ask for removal");
  });
  test("unknown slug → 404; /correct without slash → 301", async () => {
    expect((await route("/ecosystem/nobody/correct/", OPEN)).status).toBe(404);
    expect((await route("/ecosystem/aave/correct", OPEN)).status).toBe(301);
  });
});

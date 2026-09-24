import { describe, expect, test } from "vitest";
import { handleProof } from "../lib/proof";
import {
  PROOF_MAX_BYTES,
  createProofReader,
  parseProofApiBody,
  proofApiSource,
  proofCacheKey,
  proofHostAllowed,
  readProofServerSide,
} from "../../src/lib/proof-fetch";

const ORIGIN = "https://builder.registrai.cc";
const NOW = 1_780_000_000_000;
const PROOF = JSON.stringify({ version: 1, claim: {}, signatures: {} });

type Call = { url: string; init?: RequestInit };

/** A fake fetch: `routes` maps a URL without its query to a response factory. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes[url.split("?")[0]];
    if (!route) throw new TypeError("fetch failed");
    return route();
  }) as typeof fetch;
  return { f, calls };
}

/** A Map-backed stand-in for the Workers edge cache. */
class MemoryCache {
  readonly store = new Map<string, Response>();
  async match(req: Request) {
    return this.store.get(req.url)?.clone();
  }
  async put(req: Request, res: Response) {
    this.store.set(req.url, res.clone());
  }
}

const api = (source: string, extra = "") => new Request(`${ORIGIN}/api/proof?source=${encodeURIComponent(source)}${extra}`);

describe("source grammar", () => {
  test("hosts: the source grammar's, never localhost or an IP literal", () => {
    expect(proofHostAllowed("app.example.org")).toBe(true);
    expect(proofHostAllowed("raw.githubusercontent.com")).toBe(true);
    for (const h of ["localhost", "127.0.0.1", "10.0.0.1", "foo.localhost", "[::1]", "example", "-bad.example.org", "a_b.example.org"]) {
      expect(proofHostAllowed(h)).toBe(false);
    }
  });

  test("the request's source is normalised; a local or invalid one is refused", () => {
    expect(proofApiSource(`${ORIGIN}/api/proof?source=https://github.com/Owner/Repo`)).toBe("github:owner/repo");
    expect(proofApiSource(`${ORIGIN}/api/proof?source=domain:App.Example.org`)).toBe("domain:app.example.org");
    expect(proofApiSource(`${ORIGIN}/api/proof?source=domain:localhost`)).toBeNull();
    expect(proofApiSource(`${ORIGIN}/api/proof?source=domain:127.0.0.1`)).toBeNull();
    expect(proofApiSource(`${ORIGIN}/api/proof?source=10.0.0.1`)).toBeNull();
    expect(proofApiSource(`${ORIGIN}/api/proof`)).toBeNull();
  });

  test("400 for a source it does not read, without any fetch", async () => {
    const { f, calls } = fakeFetch({});
    const res = await handleProof(api("domain:localhost"), { fetchImpl: f, cache: null });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ service: "registrai-proof", ok: false, error: "unreachable" });
    expect(calls).toHaveLength(0);
  });
});

describe("reading", () => {
  test("github: raw.githubusercontent.com with the cache-buster; the text comes back as is", async () => {
    const { f, calls } = fakeFetch({ "https://raw.githubusercontent.com/o/r/HEAD/.registrai.json": () => new Response(PROOF) });
    const res = await handleProof(api("github:o/r"), { fetchImpl: f, cache: null, now: NOW });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await res.json()).toEqual({
      service: "registrai-proof",
      source: "github:o/r",
      ok: true,
      text: PROOF,
      url: "https://raw.githubusercontent.com/o/r/HEAD/.registrai.json",
    });
    expect(calls[0].url).toBe(`https://raw.githubusercontent.com/o/r/HEAD/.registrai.json?registrai=${NOW}`);
    expect(calls[0].init?.redirect).toBe("manual");
  });

  test("error mapping: 404 / 410 missing; 5xx, 429, 403, network errors unreachable; bad JSON invalid-json", async () => {
    const at = (status: number, body = "x") => fakeFetch({ "https://app.example.org/.well-known/registrai.json": () => new Response(body, { status }) }).f;
    const read = (f: typeof fetch) => readProofServerSide("domain:app.example.org", { fetchImpl: f });
    expect(await read(at(404))).toMatchObject({ ok: false, error: "missing" });
    expect(await read(at(410))).toMatchObject({ ok: false, error: "missing" });
    expect(await read(at(500))).toMatchObject({ ok: false, error: "unreachable", detail: "HTTP 500" });
    expect(await read(at(429))).toMatchObject({ ok: false, error: "unreachable", detail: "HTTP 429" });
    expect(await read(at(403))).toMatchObject({ ok: false, error: "unreachable" });
    expect(await read(at(200, "{not json"))).toMatchObject({ ok: false, error: "invalid-json" });
    expect(await read(fakeFetch({}).f)).toMatchObject({ ok: false, error: "unreachable", detail: "network error" });
    // floats survive: the text is passed through, never re-serialised
    expect(await read(at(200, '{"version": 1.0}'))).toMatchObject({ ok: true, text: '{"version": 1.0}' });
  });

  test("size: a declared or a streamed body over 20 KB is too-large", async () => {
    const big = "x".repeat(PROOF_MAX_BYTES + 1);
    const declared = fakeFetch({
      "https://app.example.org/.well-known/registrai.json": () => new Response("{}", { headers: { "content-length": String(PROOF_MAX_BYTES + 1) } }),
    });
    expect(await readProofServerSide("domain:app.example.org", { fetchImpl: declared.f })).toMatchObject({ ok: false, error: "too-large" });
    const streamed = fakeFetch({
      "https://app.example.org/.well-known/registrai.json": () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode(big.slice(0, 15_000)));
              c.enqueue(new TextEncoder().encode(big.slice(15_000)));
              c.close();
            },
          }),
        ),
    });
    expect(await readProofServerSide("domain:app.example.org", { fetchImpl: streamed.f })).toMatchObject({ ok: false, error: "too-large" });
    const exact = fakeFetch({ "https://app.example.org/.well-known/registrai.json": () => new Response(`"${"y".repeat(PROOF_MAX_BYTES - 2)}"`) });
    expect(await readProofServerSide("domain:app.example.org", { fetchImpl: exact.f })).toMatchObject({ ok: true });
  });

  test("timeout: a server that never answers is unreachable (timed out)", async () => {
    const hang = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
    expect(await readProofServerSide("domain:app.example.org", { fetchImpl: hang, timeoutMs: 20 })).toMatchObject({
      ok: false,
      error: "unreachable",
      detail: "timed out",
    });
  });
});

describe("redirects", () => {
  const redirect = (to: string, status = 301) => () => new Response(null, { status, headers: { location: to } });
  const start = "https://app.example.org/.well-known/registrai.json";

  test("https to a grammar host is followed (relative too), up to 3 hops", async () => {
    const { f, calls } = fakeFetch({
      [start]: redirect("https://www.example.org/.well-known/registrai.json"),
      "https://www.example.org/.well-known/registrai.json": redirect("/r2", 302),
      "https://www.example.org/r2": redirect("https://cdn.example.net/p.json", 308),
      "https://cdn.example.net/p.json": () => new Response(PROOF),
    });
    expect(await readProofServerSide("domain:app.example.org", { fetchImpl: f })).toMatchObject({ ok: true, text: PROOF, url: start });
    expect(calls.map((c) => c.url.split("?")[0])).toEqual([start, "https://www.example.org/.well-known/registrai.json", "https://www.example.org/r2", "https://cdn.example.net/p.json"]);
  });

  test("a 4th hop is refused", async () => {
    const { f } = fakeFetch({
      [start]: redirect("https://a.example.org/1"),
      "https://a.example.org/1": redirect("https://a.example.org/2"),
      "https://a.example.org/2": redirect("https://a.example.org/3"),
      "https://a.example.org/3": redirect("https://a.example.org/4"),
      "https://a.example.org/4": () => new Response(PROOF),
    });
    expect(await readProofServerSide("domain:app.example.org", { fetchImpl: f })).toMatchObject({ ok: false, error: "unreachable", detail: "more than 3 redirects" });
  });

  test("never to http, an IP literal, localhost, another port or user-info; never without a Location", async () => {
    for (const to of [
      "http://app.example.org/.well-known/registrai.json",
      "https://169.254.169.254/latest/meta-data",
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://internal.localhost/x",
      "https://app.example.org:8443/x",
      "https://user@app.example.org/x",
      "ftp://app.example.org/x",
    ]) {
      const { f, calls } = fakeFetch({ [start]: redirect(to), [to.split("?")[0]]: () => new Response(PROOF) });
      const r = await readProofServerSide("domain:app.example.org", { fetchImpl: f });
      expect(r, to).toMatchObject({ ok: false, error: "unreachable" });
      expect(calls, to).toHaveLength(1);
    }
    const { f } = fakeFetch({ [start]: () => new Response(null, { status: 302 }) });
    expect(await readProofServerSide("domain:app.example.org", { fetchImpl: f })).toMatchObject({ ok: false, error: "unreachable" });
  });
});

describe("edge cache", () => {
  test("keyed by the canonical source alone: other query parameters and spellings share one entry", async () => {
    const { f, calls } = fakeFetch({ "https://raw.githubusercontent.com/o/r/HEAD/.registrai.json": () => new Response(PROOF) });
    const cache = new MemoryCache() as unknown as Cache;
    const a = await handleProof(api("github:o/r"), { fetchImpl: f, cache });
    const b = await handleProof(api("github:o/r", "&bust=1&x=2"), { fetchImpl: f, cache });
    const c = await handleProof(new Request(`${ORIGIN}/api/proof?x=9&source=https%3A%2F%2Fgithub.com%2FO%2FR`), { fetchImpl: f, cache });
    expect(calls).toHaveLength(1);
    expect(await b.json()).toEqual(await a.json());
    expect(((await c.json()) as { source: string }).source).toBe("github:o/r");
    expect([...(cache as unknown as MemoryCache).store.keys()]).toEqual([`${ORIGIN}/api/proof?source=github%3Ao%2Fr`]);
  });

  test("proofCacheKey", () => {
    expect(proofCacheKey(`${ORIGIN}/api/proof?source=x&y=1`, "domain:a.example.org")).toBe(`${ORIGIN}/api/proof?source=domain%3Aa.example.org`);
  });
});

describe("browser reader", () => {
  const apiBody = (source: string, extra: Record<string, unknown>) =>
    new Response(JSON.stringify({ service: "registrai-proof", source, ...extra }), { headers: { "content-type": "application/json" } });

  test("uses /api/proof when it is there", async () => {
    const { f, calls } = fakeFetch({ "/api/proof": () => apiBody("domain:app.example.org", { ok: true, text: PROOF, url: "u" }) });
    const read = createProofReader({ fetchImpl: f });
    expect(await read("domain:app.example.org")).toEqual({ ok: true, text: PROOF, url: "u", via: "api" });
    expect(calls[0].url).toBe("/api/proof?source=domain%3Aapp.example.org");
  });

  test("an API error is an answer (no direct fetch behind it)", async () => {
    const { f, calls } = fakeFetch({ "/api/proof": () => apiBody("domain:app.example.org", { ok: false, error: "unreachable", detail: "HTTP 503" }) });
    expect(await createProofReader({ fetchImpl: f })("domain:app.example.org")).toMatchObject({ ok: false, error: "unreachable", via: "api" });
    expect(calls).toHaveLength(1);
  });

  test("no API (a static 404 page): a direct fetch, and the API is not asked again", async () => {
    const { f, calls } = fakeFetch({
      "/api/proof": () => new Response("<html>404</html>", { status: 404, headers: { "content-type": "text/html" } }),
      "https://raw.githubusercontent.com/o/r/HEAD/.registrai.json": () => new Response(PROOF),
    });
    const read = createProofReader({ fetchImpl: f });
    expect(await read("github:o/r")).toMatchObject({ ok: true, via: "direct" });
    expect(await read("github:o/r")).toMatchObject({ ok: true, via: "direct" });
    expect(calls.filter((c) => c.url.startsWith("/api/proof"))).toHaveLength(1);
    expect(calls[1].url).toMatch(/\?registrai=\d+$/);
  });

  test("a blocked direct read (CORS) is unreachable, never valid", async () => {
    const { f } = fakeFetch({});
    expect(await createProofReader({ fetchImpl: f, apiPath: null })("domain:app.example.org")).toMatchObject({ ok: false, error: "unreachable", via: "direct" });
  });

  test("parseProofApiBody: only the proof service's answer for this source", () => {
    expect(parseProofApiBody({ service: "registrai-proof", source: "github:o/r", ok: true, text: "{}" }, "github:o/r")).toEqual({ ok: true, text: "{}", url: "" });
    expect(parseProofApiBody({ service: "registrai-proof", source: "github:o/x", ok: true, text: "{}" }, "github:o/r")).toBeNull();
    expect(parseProofApiBody({ source: "github:o/r", ok: true, text: "{}" }, "github:o/r")).toBeNull();
    expect(parseProofApiBody({ service: "registrai-proof", source: "github:o/r", ok: false, error: "weird" }, "github:o/r")).toBeNull();
    expect(parseProofApiBody("nope", "github:o/r")).toBeNull();
  });
});

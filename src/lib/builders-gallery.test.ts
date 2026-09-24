import { describe, expect, test } from "vitest";
import { zeroAddress, type Address } from "viem";
import vectors from "./__fixtures__/verified-builder-vectors.json";
import nomineesFile from "../data/nominees.json";
import {
  DISPLAY,
  FILTERS,
  browserProofCheck,
  buildGallerySnapshot,
  builderAnchor,
  claimHref,
  displayKind,
  filterGallery,
  galleryCounts,
  galleryRowsFromRecords,
  gallerySyncPlan,
  labelOf,
  mergeGallery,
  mergeNominees,
  needsProofCheck,
  overlayLive,
  parseFilter,
  parseGallerySnapshot,
  parseNominees,
  parsePublicInvites,
  parseSourceParam,
  avatarUrl,
  proofHref,
  readLiveGallery,
  sourceHref,
  toneOf,
  xHref,
  type GalleryBuilder,
  type GalleryReader,
  type LiveChainRow,
  type LiveProof,
} from "./builders-gallery";
import { parseBuilderParam, type BadgeInfo } from "./verified-builder-badge";

const B0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Address;
const B1 = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;
const OP = "0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263";
const REG = "0x10F8D6D5905E2C4dc565a1894c102B25E9d21DF4";
const BADGE = "0x05de78E9Ff17ccE47D7F4E9170fdfC130Abe278c";
const CHAIN = 5042002;
const GH = "github:registrai-multichain/oracle-primitives";

const badge = (serial: number, lapsed = false): BadgeInfo => ({ serial, lapsed, issuedAt: 1790000000, image: `x/${serial}.jpg` });

function row(id: number, over: Partial<GalleryBuilder> = {}): GalleryBuilder {
  return { id, owner: B0, status: "verified", source: `github:acme/p${id}`, country: "PL", proofUrl: null, badge: null, createdAt: 1, ...over };
}

describe("display: status -> kind, label, tone", () => {
  test("claimed in colour, lapsed and invited in grayscale", () => {
    expect(DISPLAY).toEqual({
      verified: { label: "Verified", tone: "color" },
      nominated: { label: "Nominated", tone: "color" },
      lapsed: { label: "Lapsed", tone: "grayscale" },
      invited: { label: "Invited", tone: "grayscale" },
    });
    expect(toneOf("verified")).toBe("color");
    expect(toneOf("nominated")).toBe("color");
    expect(toneOf("lapsed")).toBe("grayscale");
    expect(toneOf("invited")).toBe("grayscale");
    expect(labelOf("nominated")).toBe("Nominated");
  });

  test("chain status maps to a kind; unverified and inactive are not shown", () => {
    expect(displayKind({ status: "verified", badge: null })).toBe("verified");
    expect(displayKind({ status: "pending", badge: null })).toBe("nominated");
    expect(displayKind({ status: "lapsed", badge: null })).toBe("lapsed");
    expect(displayKind({ status: "unverified", badge: null })).toBeNull();
    expect(displayKind({ status: "inactive", badge: badge(1) })).toBeNull();
  });

  test("a badge issued counts as verified; a lapsed badge as lapsed", () => {
    expect(displayKind({ status: "pending", badge: badge(3) })).toBe("verified");
    expect(displayKind({ status: "verified", badge: badge(3, true) })).toBe("lapsed");
    expect(displayKind({ status: "lapsed", badge: badge(3) })).toBe("lapsed");
  });
});

describe("nominees", () => {
  test("the shipped file is an empty array", () => {
    expect(nomineesFile).toEqual([]);
    expect(parseNominees(nomineesFile)).toEqual([]);
  });

  test("normalises sources and handles, drops invalid entries and duplicates", () => {
    const out = parseNominees([
      { source: "https://github.com/Acme/Widget", name: "  Widget  ", x: "acme_hq", note: "met at ETHWarsaw" },
      { source: "github:acme/widget", name: "dupe" },
      { source: "domain:App.Example.org", x: "@not a handle" },
      { source: "not a source!" },
      { name: "no source" },
      "garbage",
      { source: "acme/other", x: "@ok" },
    ]);
    expect(out).toEqual([
      { source: "github:acme/widget", name: "Widget", x: "@acme_hq", note: "met at ETHWarsaw" },
      { source: "domain:app.example.org" },
      { source: "github:acme/other", x: "@ok" },
    ]);
    expect(parseNominees({ not: "an array" })).toEqual([]);
  });
});

describe("invites from the admin API", () => {
  test("parsePublicInvites: validated like the file; notes dropped; anything else is none", () => {
    expect(
      parsePublicInvites({
        invites: [
          { source: "github:foo/bar", name: "Foo", x: "@foo", createdAt: "2026-09-24T12:00:00.000Z" },
          { source: "https://example.org/", x: "not a handle!", note: "leak" },
          { source: "not a source" },
          { source: "Foo/Bar", name: "dupe" },
        ],
      }),
    ).toEqual([{ source: "github:foo/bar", name: "Foo", x: "@foo" }, { source: "domain:example.org" }]);
    expect(parsePublicInvites("<!doctype html>")).toEqual([]);
    expect(parsePublicInvites(null)).toEqual([]);
    expect(parsePublicInvites({ invites: "x" })).toEqual([]);
  });

  test("mergeNominees: file first, deduped by normalised source, API name / X win", () => {
    const file = parseNominees([{ source: "a/b", name: "File AB", note: "kept private" }, { source: "c.example", x: "@c" }]);
    const api = parsePublicInvites({ invites: [{ source: "github:A/B", name: "Api AB", x: "@ab" }, { source: "e/f", name: "EF" }, { source: "e/f" }] });
    expect(mergeNominees(file, api)).toEqual([
      { source: "github:a/b", name: "Api AB", x: "@ab", note: "kept private" },
      { source: "domain:c.example", x: "@c" },
      { source: "github:e/f", name: "EF" },
    ]);
    expect(mergeNominees(file, [])).toEqual(file);
    expect(mergeNominees([], api)).toEqual(api.slice(0, 2));
  });

  test("an on-chain claim still wins over an API invitee", () => {
    const nominees = mergeNominees([], parsePublicInvites({ invites: [{ source: "github:o/r", name: "Claimed" }, { source: "github:x/y", name: "Open" }] }));
    const builders: GalleryBuilder[] = [
      { id: 1, owner: B0.toLowerCase(), status: "pending", source: "github:o/r", country: "DE", proofUrl: null, badge: null, createdAt: 0 },
    ];
    const merged = mergeGallery(builders, nominees);
    expect(merged.map((e) => [e.kind, e.name])).toEqual([
      ["nominated", "Claimed"],
      ["invited", "Open"],
    ]);
  });
});

describe("mergeGallery", () => {
  const nominees = parseNominees([
    { source: "https://github.com/Acme/P2", name: "Acme Two", x: "@acme" },
    { source: "github:someone/unclaimed", name: "Unclaimed", x: "@someone" },
    { source: "domain:gone.example.com", name: "Deactivated" },
  ]);
  const builders: GalleryBuilder[] = [
    row(1, { status: "lapsed", country: null }),
    row(2, { status: "pending" }),
    row(3, { badge: badge(2) }),
    row(4, { badge: badge(1), country: "DE" }),
    row(5, { status: "unverified", source: null, country: null }),
    row(6, { status: "inactive", source: "domain:gone.example.com", country: null }),
    row(7, { status: "lapsed", source: "github:acme/p2", owner: B1, country: null }),
  ];
  const entries = mergeGallery(builders, nominees);

  test("a nominee that claimed on chain is shown once, as that builder", () => {
    const acme = entries.filter((e) => e.source === "github:acme/p2");
    // builder #2 (nominated) carries the nominee's name and handle; #7 (another
    // wallet's lapsed claim on the same repo) is still shown, without them.
    expect(acme.map((e) => [e.builder?.id, e.kind, e.name, e.x])).toEqual([
      [2, "nominated", "Acme Two", "@acme"],
      [7, "lapsed", "acme/p2", null],
    ]);
    expect(entries.some((e) => e.kind === "invited" && e.source === "github:acme/p2")).toBe(false);
  });

  test("unmatched nominees are Invited, with only the file's name, source and handle", () => {
    const invited = entries.filter((e) => e.kind === "invited");
    expect(invited).toEqual([
      { key: "invited-github-someone-unclaimed", kind: "invited", name: "Unclaimed", source: "github:someone/unclaimed", x: "@someone", builder: null },
    ]);
  });

  test("unverified and inactive builders are hidden; a nominee they claimed is not re-invited", () => {
    expect(entries.some((e) => e.builder?.id === 5 || e.builder?.id === 6)).toBe(false);
    expect(entries.some((e) => e.source === "domain:gone.example.com")).toBe(false);
  });

  test("order: verified by serial, nominated, lapsed by id, then invited", () => {
    expect(entries.map((e) => e.key)).toEqual([
      "builder-4",
      "builder-3",
      "builder-2",
      "builder-1",
      "builder-7",
      "invited-github-someone-unclaimed",
    ]);
  });

  test("counts: countries only from claimed builders", () => {
    expect(galleryCounts(entries)).toEqual({ all: 6, verified: 2, nominated: 1, lapsed: 2, invited: 1, countries: 2 });
  });

  test("filters and search", () => {
    expect(FILTERS).toEqual(["all", "verified", "nominated", "lapsed", "invited"]);
    expect(filterGallery(entries, "all", "")).toHaveLength(6);
    expect(filterGallery(entries, "verified", "").map((e) => e.builder?.id)).toEqual([4, 3]);
    expect(filterGallery(entries, "invited", "").map((e) => e.name)).toEqual(["Unclaimed"]);
    expect(filterGallery(entries, "lapsed", "").map((e) => e.builder?.id)).toEqual([1, 7]);
    // name, handle, country, serial, builder id — case-insensitive, every word
    expect(filterGallery(entries, "all", "ACME two").map((e) => e.builder?.id)).toEqual([2]);
    expect(filterGallery(entries, "all", "@someone").map((e) => e.kind)).toEqual(["invited"]);
    expect(filterGallery(entries, "all", "de").map((e) => e.builder?.id)).toContain(4);
    expect(filterGallery(entries, "all", "no. 001").map((e) => e.builder?.id)).toEqual([4]);
    expect(filterGallery(entries, "all", "#3").map((e) => e.builder?.id)).toEqual([3]);
    expect(filterGallery(entries, "verified", "unclaimed")).toEqual([]);
    expect(parseFilter("lapsed")).toBe("lapsed");
    expect(parseFilter("bogus")).toBe("all");
    expect(parseFilter(null)).toBe("all");
  });
});

describe("links and deep links", () => {
  test("?builder= on the gallery URL the badge's external_url points at", () => {
    const u = new URL("https://registrai.cc/builders/?builder=7");
    expect(parseBuilderParam(u.searchParams.get("builder"))).toBe(7);
    expect(parseBuilderParam(new URL("https://registrai.cc/builders/?builder=0").searchParams.get("builder"))).toBeNull();
    expect(parseBuilderParam(new URL("https://registrai.cc/builders/?builder=7x").searchParams.get("builder"))).toBeNull();
    expect(parseBuilderParam(new URL("https://registrai.cc/builders/").searchParams.get("builder"))).toBeNull();
    expect(builderAnchor(7)).toBe("builder-7");
  });

  test("claim link round-trips through /verify's ?source=", () => {
    const href = claimHref("github:acme/widget");
    expect(href).toBe("/verify?source=github%3Aacme%2Fwidget");
    const raw = new URL(href, "https://registrai.cc").searchParams.get("source");
    expect(parseSourceParam(raw)).toEqual({ source: "github:acme/widget", path: "repo" });
    expect(parseSourceParam("https://App.Example.org/x")).toEqual({ source: "domain:app.example.org", path: "domain" });
    expect(parseSourceParam("not a source!")).toBeNull();
    expect(parseSourceParam(null)).toBeNull();
  });

  test("source, proof, avatar and X links", () => {
    expect(sourceHref("github:acme/widget")).toBe("https://github.com/acme/widget");
    expect(sourceHref("domain:app.example.org")).toBe("https://app.example.org");
    expect(proofHref("github:acme/widget")).toBe("https://raw.githubusercontent.com/acme/widget/HEAD/.registrai.json");
    expect(proofHref("domain:app.example.org")).toBe("https://app.example.org/.well-known/registrai.json");
    expect(proofHref(null)).toBeNull();
    expect(proofHref("github:Not/Canonical")).toBeNull();
    expect(avatarUrl("github:acme/widget", 128)).toBe("https://avatars.githubusercontent.com/acme?size=128");
    expect(avatarUrl("domain:app.example.org")).toBeNull();
    expect(xHref("@acme")).toBe("https://x.com/acme");
  });
});

describe("sync gallery helpers", () => {
  const records = [
    { builderId: 1, owner: B0.toUpperCase().replace("0X", "0x") as Address, active: true, status: "verified" as const, source: GH, country: "PL", proofUrl: "https://p/1", createdAt: 1790000000 },
    { builderId: 2, owner: B1, active: true, status: "pending" as const, source: "domain:app.example.org", country: "DE", proofUrl: "https://p/2", createdAt: 1790000100 },
    { builderId: 3, owner: B1, active: true, status: "lapsed" as const, source: "github:gone/repo", country: null, proofUrl: "https://p/3" },
    { builderId: 4, owner: B0, active: false, status: "unverified" as const, source: "github:acme/x", country: "US", proofUrl: null },
    { builderId: 5, owner: B0, active: true, status: "unverified" as const, source: null, country: null, proofUrl: null },
  ];

  test("rows: status incl. inactive, country only for a valid claim, badges attached", () => {
    const rows = galleryRowsFromRecords(records, new Map([[1, badge(1)]]));
    expect(rows.map((r) => [r.id, r.status, r.country, r.badge?.serial ?? null, r.createdAt])).toEqual([
      [1, "verified", "PL", 1, 1790000000],
      [2, "pending", "DE", null, 1790000100],
      [3, "lapsed", null, null, 0],
      [4, "inactive", null, null, 0],
      [5, "unverified", null, null, 0],
    ]);
    expect(rows[0].owner).toBe(B0);
  });

  test("snapshot round-trips and records its nextId", () => {
    const snap = buildGallerySnapshot({ network: "testnet", chainId: CHAIN, builderRegistry: REG, syncedAt: "2026-09-24T00:00:00Z", records, badges: new Map() });
    expect(snap.nextId).toBe(6);
    expect(parseGallerySnapshot(JSON.parse(JSON.stringify(snap)), { chainId: CHAIN, builderRegistry: REG.toLowerCase() })).toEqual(snap);
  });

  test("a snapshot for another chain or registry is ignored", () => {
    const snap = buildGallerySnapshot({ network: "testnet", chainId: CHAIN, builderRegistry: REG, syncedAt: "", records, badges: new Map() });
    expect(parseGallerySnapshot(snap, { chainId: 5042, builderRegistry: REG })).toBeNull();
    expect(parseGallerySnapshot(snap, { chainId: CHAIN, builderRegistry: BADGE })).toBeNull();
    expect(parseGallerySnapshot(snap, { chainId: CHAIN, builderRegistry: null })).toBeNull();
    expect(parseGallerySnapshot(undefined, { chainId: CHAIN, builderRegistry: REG })).toBeNull();
  });

  test("malformed rows are dropped; untrusted fields are sanitised", () => {
    const snap = parseGallerySnapshot(
      {
        chainId: CHAIN,
        builderRegistry: REG,
        network: "testnet",
        nextId: 2,
        builders: [
          { id: 1, owner: B0, status: "verified", source: "github:Bad/Case", country: "pl", proofUrl: "javascript:alert(1)", badge: { serial: 0, lapsed: false } },
          { id: 0, owner: B0, status: "verified" },
          { id: 2, owner: "0xnope", status: "verified" },
          { id: 3, owner: B0, status: "hacked" },
          { id: 9, owner: B1, status: "pending", source: GH, country: "PL", proofUrl: "https://ok", badge: badge(4), createdAt: 5 },
        ],
      },
      { chainId: CHAIN, builderRegistry: REG },
    )!;
    expect(snap.builders).toEqual([
      { id: 1, owner: B0, status: "verified", source: null, country: null, proofUrl: null, badge: null, createdAt: 0 },
      { id: 9, owner: B1, status: "pending", source: GH, country: "PL", proofUrl: "https://ok", badge: badge(4), createdAt: 5 },
    ]);
    // nextId never below what the rows cover
    expect(snap.nextId).toBe(10);
  });

  test("plan: reuse the market sync's read of the same registry, else read, or skip", () => {
    const testnetB = { chainId: CHAIN, contracts: { BuilderRegistry: REG } };
    const mainnetB = { chainId: 5042, contracts: { BuilderRegistry: BADGE } };
    expect(gallerySyncPlan(testnetB, { chainId: CHAIN, builderRegistry: REG.toLowerCase() })).toBe("reuse");
    expect(gallerySyncPlan(testnetB, null)).toBe("read");
    expect(gallerySyncPlan(mainnetB, { chainId: CHAIN, builderRegistry: REG })).toBe("read");
    expect(gallerySyncPlan({ chainId: 5042, contracts: { BuilderRegistry: null } }, null)).toBe("skip");
  });
});

describe("live overlay", () => {
  const live = (id: number, over: Partial<LiveChainRow> = {}): LiveChainRow => ({
    id,
    owner: B0,
    profileURI: `registrai:github:acme/p${id}`,
    active: true,
    createdAt: 100 + id,
    caretaker: zeroAddress,
    badge: null,
    ...over,
  });

  test("which rows need a browser proof check", () => {
    expect(needsProofCheck(live(1), undefined)).toBe(true);
    expect(needsProofCheck(live(1), row(1))).toBe(false);
    expect(needsProofCheck(live(1, { profileURI: "registrai:github:acme/changed" }), row(1))).toBe(true);
    expect(needsProofCheck(live(1, { owner: B1 }), row(1))).toBe(true);
    expect(needsProofCheck(live(1), row(1, { status: "inactive" }))).toBe(true);
    expect(needsProofCheck(live(1, { active: false }), undefined)).toBe(false);
    expect(needsProofCheck(live(1, { profileURI: "https://github.com/acme/p1" }), undefined)).toBe(false);
  });

  test("snapshot rows take live caretaker, badge and active flag; new builders are added", () => {
    const snapshot = [row(1, { status: "pending" }), row(2, { status: "verified", badge: badge(1) }), row(3)];
    const rows = [
      live(1, { caretaker: OP }), // onboarded after the sync
      live(2, { caretaker: OP, badge: badge(1, true) }), // keeper lapsed the badge
      live(3, { active: false }), // deactivated
      live(4), // new: github proof valid
      live(5, { profileURI: "registrai:domain:app.example.org" }), // new: domain, CORS-blocked
      live(6), // new: proof missing
    ];
    const proofs = new Map<number, LiveProof>([
      [4, { state: "valid", country: "PL" }],
      [5, { state: "unchecked" }],
      [6, { state: "invalid" }],
    ]);
    const out = overlayLive(snapshot, rows, proofs, OP);
    expect(out.map((b) => [b.id, b.status, b.country, displayKind(b)])).toEqual([
      [1, "verified", "PL", "verified"],
      [2, "verified", "PL", "lapsed"],
      [3, "inactive", null, null],
      [4, "pending", "PL", "nominated"],
      [5, "pending", null, "nominated"],
      [6, "lapsed", null, "lapsed"],
    ]);
    expect(out.find((b) => b.id === 5)?.proofUnchecked).toBe(true);
    expect(out.find((b) => b.id === 4)?.proofUnchecked).toBeUndefined();
    expect(out.find((b) => b.id === 4)?.proofUrl).toBe("https://raw.githubusercontent.com/acme/p4/HEAD/.registrai.json");
  });

  test("a new builder the Safe already onboarded is verified even when unchecked", () => {
    const out = overlayLive([], [live(1, { caretaker: OP, profileURI: "registrai:domain:app.example.org" })], new Map(), OP);
    expect(out[0].status).toBe("verified");
    expect(out[0].proofUnchecked).toBe(true);
  });

  test("snapshot rows the live read did not reach are kept", () => {
    expect(overlayLive([row(1), row(2)], [live(1)], new Map(), OP).map((b) => b.id)).toEqual([1, 2]);
  });

  test("readLiveGallery reads registry, caretaker and badge per builder", async () => {
    const calls: string[] = [];
    const reader: GalleryReader = {
      readContract: async ({ functionName, args }) => {
        calls.push(functionName);
        const id = args ? Number(args[0] as bigint) : 0;
        switch (functionName) {
          case "nextId": return 3n;
          case "builders": return [id === 1 ? B0 : B1, `registrai:github:acme/p${id}`, "0x", BigInt(1000 + id), true] as const;
          case "caretakerOf": return id === 1 ? OP : zeroAddress;
          case "serialOf": return id === 1 ? 7n : 0n;
          case "lapsed": return false;
          case "issuedAt": return 1790000000n;
          default: throw new Error(functionName);
        }
      },
    };
    const rows = await readLiveGallery(reader, { registry: REG as Address, caretakers: REG as Address, badge: BADGE as Address, imageBase: "https://registrai.cc/badge/arc-testnet/" });
    expect(rows).toEqual([
      { id: 1, owner: B0, profileURI: "registrai:github:acme/p1", active: true, createdAt: 1001, caretaker: OP, badge: { serial: 7, lapsed: false, issuedAt: 1790000000, image: "https://registrai.cc/badge/arc-testnet/7.jpg" } },
      { id: 2, owner: B1, profileURI: "registrai:github:acme/p2", active: true, createdAt: 1002, caretaker: zeroAddress, badge: null },
    ]);
    // Nothing market-related is ever read.
    expect(new Set(calls)).toEqual(new Set(["nextId", "builders", "caretakerOf", "serialOf", "isLapsed", "lapsed", "issuedAt"]));
  });
});

describe("browserProofCheck", () => {
  const GH_VALID = vectors.proofs.find((p) => p.name === "valid github claim")!.file;
  const res = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) }) as Response;

  test("a valid file is valid, with its country", async () => {
    const r = await browserProofCheck({ owner: B0, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(200, GH_VALID) });
    expect(r).toEqual({ state: "valid", country: "PL" });
  });

  test("another owner, a missing file or bad JSON is invalid", async () => {
    expect(await browserProofCheck({ owner: B1, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(200, GH_VALID) })).toEqual({ state: "invalid" });
    expect(await browserProofCheck({ owner: B0, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(404, "") })).toEqual({ state: "invalid" });
    expect(await browserProofCheck({ owner: B0, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(200, "{nope") })).toEqual({ state: "invalid" });
  });

  test("a read the browser may not make (CORS) or a server error is unchecked, never invalid", async () => {
    const blocked = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await browserProofCheck({ owner: B0, source: "domain:app.example.org" }, { chainId: CHAIN, fetchImpl: blocked })).toEqual({ state: "unchecked" });
    expect(await browserProofCheck({ owner: B0, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(503, "") })).toEqual({ state: "unchecked" });
  });
});

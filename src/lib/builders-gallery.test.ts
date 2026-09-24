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
  checkLiveProofs,
  greyReason,
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
  builderAvatarUrl,
  builderName,
  browserProjectProof,
  claimedSources,
  initialOf,
  leadProject,
  plainProfileName,
  projectChips,
  projectsToCheck,
  type GalleryBuilder,
  type GalleryProject,
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

/** A project; verified by default. */
function proj(id: number, source: string, over: Partial<GalleryProject> = {}): GalleryProject {
  const status = over.status ?? "verified";
  return { id, source, active: status !== "inactive", status, country: status === "verified" ? "PL" : null, proofUrl: null, ...over };
}

/** A builder with one project `github:acme/p<id>` (project id = builder id * 10), verified by default. */
function row(id: number, over: Partial<GalleryBuilder> & { source?: string | null } = {}): GalleryBuilder {
  const { source = `github:acme/p${id}`, ...rest } = over;
  const status = rest.status ?? "verified";
  const pStatus = status === "verified" || status === "pending" ? "verified" : status === "lapsed" ? "lapsed" : "inactive";
  const projects = rest.projects ?? (source ? [proj(id * 10, source, { status: pStatus })] : []);
  return { id, owner: B0, status, profileURI: "", projects, country: "PL", badge: null, createdAt: 1, onboarded: status === "verified", ...rest };
}

describe("display: status -> kind, label, tone", () => {
  test("claimed in colour, lapsed and invited in grayscale", () => {
    expect(DISPLAY).toEqual({
      verified: { label: "Verified", tone: "color" },
      nominated: { label: "Nominated", tone: "color" },
      lapsed: { label: "Lapsed", tone: "grayscale" },
      unconfirmed: { label: "Unconfirmed", tone: "grayscale" },
      invited: { label: "Invited", tone: "grayscale" },
    });
    expect(toneOf("unconfirmed")).toBe("grayscale");
    expect(toneOf("verified")).toBe("color");
    expect(toneOf("nominated")).toBe("color");
    expect(toneOf("lapsed")).toBe("grayscale");
    expect(toneOf("invited")).toBe("grayscale");
    expect(labelOf("nominated")).toBe("Nominated");
  });

  test("chain status maps to a kind; unverified and inactive are not shown", () => {
    expect(displayKind({ status: "verified", badge: null })).toBe("verified");
    expect(displayKind({ status: "pending", badge: null })).toBe("nominated");
    expect(displayKind({ status: "lapsed", badge: null, onboarded: true })).toBe("lapsed");
    expect(displayKind({ status: "unconfirmed", badge: null })).toBe("unconfirmed");
    expect(displayKind({ status: "unverified", badge: null })).toBeNull();
    expect(displayKind({ status: "inactive", badge: null })).toBeNull();
  });

  test("lapsed and never onboarded (no caretaker, no badge): hidden; onboarded or badge-holding lapsed builders stay grey", () => {
    expect(displayKind({ status: "lapsed", badge: null, onboarded: false })).toBeNull();
    expect(displayKind({ status: "lapsed", badge: null })).toBeNull();
    expect(displayKind({ status: "lapsed", badge: null, onboarded: true })).toBe("lapsed");
    expect(displayKind({ status: "lapsed", badge: badge(2), onboarded: false })).toBe("lapsed");
    // parsed from an old snapshot without the flag: only a verified row is known onboarded
    const snap = parseGallerySnapshot(
      { chainId: CHAIN, builderRegistry: REG, builders: [{ id: 1, owner: B0, status: "lapsed" }, { id: 2, owner: B0, status: "verified" }, { id: 3, owner: B0, status: "lapsed", onboarded: true }] },
      { chainId: CHAIN, builderRegistry: REG },
    )!;
    expect(snap.builders.map((b) => b.onboarded)).toEqual([false, true, true]);
    expect(mergeGallery(snap.builders, []).map((e) => e.builder?.id)).toEqual([2, 3]);
  });

  test("a badge holder never vanishes: no active project or deactivated, it shows grey so its ?builder= link resolves", () => {
    expect(displayKind({ status: "unverified", badge: badge(4) })).toBe("lapsed");
    expect(displayKind({ status: "inactive", badge: badge(4, true) })).toBe("lapsed");
    const holder = row(9, { status: "unverified", source: null, badge: badge(4), onboarded: true });
    const [e] = mergeGallery([holder], []);
    expect([e.key, e.kind, e.chips]).toEqual(["builder-9", "lapsed", []]);
    expect(greyReason(holder)).toBe("No active project");
    expect(greyReason(row(9, { status: "inactive", source: null, badge: badge(4) }))).toBe("Deactivated on the registry");
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
    const builders: GalleryBuilder[] = [row(1, { status: "pending", source: "github:o/r", country: "DE" })];
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
    row(1, { status: "lapsed", country: null, onboarded: true }),
    row(2, { status: "pending" }),
    row(3, { badge: badge(2) }),
    row(4, { badge: badge(1), country: "DE" }),
    row(5, { status: "unverified", source: null, country: null }),
    row(6, { status: "inactive", source: "domain:gone.example.com", country: null, projects: [proj(60, "domain:gone.example.com", { status: "inactive", active: true })] }),
    row(7, { status: "lapsed", source: "github:acme/p2", owner: B1, country: null }),
  ];
  const entries = mergeGallery(builders, nominees);

  test("a nominee that claimed on chain is shown once, as that builder", () => {
    const acme = entries.filter((e) => e.builder?.projects.some((p) => p.source === "github:acme/p2"));
    // builder #2 (nominated) carries the nominee's name and handle; #7 (another
    // wallet's lapsed claim on the same repo, never onboarded) is not shown at all.
    expect(acme.map((e) => [e.builder?.id, e.kind, e.name, e.x])).toEqual([[2, "nominated", "Acme Two", "@acme"]]);
    expect(entries.some((e) => e.kind === "invited" && e.source === "github:acme/p2")).toBe(false);
  });

  test("unmatched nominees are Invited, with only the file's name, source and handle", () => {
    const invited = entries.filter((e) => e.kind === "invited");
    expect(invited).toEqual([
      {
        key: "invited-github-someone-unclaimed",
        kind: "invited",
        name: "Unclaimed",
        source: "github:someone/unclaimed",
        x: "@someone",
        builder: null,
        chips: [],
        avatar: "https://avatars.githubusercontent.com/someone?size=128",
      },
      {
        key: "invited-domain-gone-example-com",
        kind: "invited",
        name: "Deactivated",
        source: "domain:gone.example.com",
        x: null,
        builder: null,
        chips: [],
        avatar: null,
      },
    ]);
  });

  test("unverified and inactive builders are hidden; a nominee only they hold stays invited (no validated proof)", () => {
    expect(entries.some((e) => e.builder?.id === 5 || e.builder?.id === 6)).toBe(false);
    expect(entries.filter((e) => e.source === "domain:gone.example.com").map((e) => e.kind)).toEqual(["invited"]);
  });

  test("order: verified by serial, nominated, lapsed by id, then invited", () => {
    expect(entries.map((e) => e.key)).toEqual([
      "builder-4",
      "builder-3",
      "builder-2",
      "builder-1",
      "invited-github-someone-unclaimed",
      "invited-domain-gone-example-com",
    ]);
  });

  test("counts: countries only from claimed builders", () => {
    expect(galleryCounts(entries)).toEqual({ all: 6, verified: 2, nominated: 1, lapsed: 1, unconfirmed: 0, invited: 2, countries: 2 });
    // unconfirmed builders are listed but never counted as claimed, nor their country
    const withUnconfirmed = mergeGallery([...builders, row(8, { status: "unconfirmed", country: "FR", projects: [proj(80, "domain:u.example.org", { status: "unconfirmed" })] })], nominees);
    expect(galleryCounts(withUnconfirmed)).toMatchObject({ verified: 2, nominated: 1, unconfirmed: 1, countries: 2 });
  });

  test("filters and search", () => {
    expect(FILTERS).toEqual(["all", "verified", "nominated", "unconfirmed", "lapsed", "invited"]);
    expect(filterGallery(entries, "all", "")).toHaveLength(6);
    expect(filterGallery(entries, "verified", "").map((e) => e.builder?.id)).toEqual([4, 3]);
    expect(filterGallery(entries, "invited", "").map((e) => e.name)).toEqual(["Unclaimed", "Deactivated"]);
    expect(filterGallery(entries, "lapsed", "").map((e) => e.builder?.id)).toEqual([1]);
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

describe("builders with several projects", () => {
  // #1: verified builder with a github project, a domain project and a lapsed one
  const multi = row(1, {
    status: "verified",
    profileURI: "Acme Labs",
    projects: [
      proj(11, "domain:acme.xyz"),
      proj(12, "github:acme/tool"),
      proj(13, "github:acme/old", { status: "lapsed" }),
      proj(14, "github:acme/removed", { status: "inactive", active: false }),
    ],
  });
  // #2: pending builder (not onboarded) with one verified project
  const pending = row(2, { status: "pending", owner: B1, projects: [proj(21, "github:beta/app")] });

  test("chips: active projects only, verified / nominated / lapsed", () => {
    expect(projectChips(multi).map((c) => [c.label, c.kind])).toEqual([
      ["acme.xyz", "verified"],
      ["acme/tool", "verified"],
      ["acme/old", "lapsed"],
    ]);
    expect(projectChips(pending).map((c) => [c.label, c.kind])).toEqual([["beta/app", "nominated"]]);
    // a badge issued makes the builder (and its verified chips) verified
    expect(projectChips({ ...pending, badge: badge(9) }).map((c) => c.kind)).toEqual(["verified"]);
  });

  test("one card per builder, merging every nominee of its projects", () => {
    const noms = parseNominees([
      { source: "github:acme/old", name: "Old Tool", x: "@acme_old" },
      { source: "github:acme/tool", name: "Tool", x: "@acme" },
      { source: "github:acme/removed", name: "Removed" },
      { source: "github:beta/app", name: "Beta" },
    ]);
    const entries = mergeGallery([multi, pending], noms);
    // a nominee whose source is only a REMOVED or a LAPSED project is invited again
    expect(entries.map((e) => [e.key, e.kind, e.name])).toEqual([
      ["builder-1", "verified", "Tool"],
      ["builder-2", "nominated", "Beta"],
      ["invited-github-acme-old", "invited", "Old Tool"],
      ["invited-github-acme-removed", "invited", "Removed"],
    ]);
    // X handle: the first merged nominee (project order) that has one
    expect(entries[0].x).toBe("@acme");
    expect(entries[0].chips).toHaveLength(3);
    // only validated projects absorb an invite
    expect(claimedSources([multi])).toEqual(new Set(["domain:acme.xyz", "github:acme/tool"]));
  });

  test("a nominee merges into the best-ranked builder holding that VALIDATED project", () => {
    const squatter = row(3, { status: "lapsed", owner: B1, onboarded: true, projects: [proj(31, "github:acme/tool", { status: "lapsed" })] });
    const noms = parseNominees([{ source: "github:acme/tool", name: "Tool", x: "@acme" }]);
    const entries = mergeGallery([squatter, row(1, { projects: [proj(11, "github:acme/tool")] })], noms);
    expect(entries.map((e) => [e.builder?.id, e.name, e.x])).toEqual([
      [1, "Tool", "@acme"],
      [3, "acme/tool", null],
    ]);
  });

  test("a squatter without a valid proof never swallows an invite: it stays Invited · Claim this project", () => {
    const noms = parseNominees([{ source: "github:acme/tool", name: "Tool", x: "@acme" }]);
    // lapsed (proof missing) and onboarded long ago: shown grey, invite still open
    const lapsedSquatter = row(3, { status: "lapsed", owner: B1, onboarded: true, projects: [proj(31, "github:acme/tool", { status: "lapsed" })] });
    expect(mergeGallery([lapsedSquatter], noms).map((e) => [e.key, e.kind, e.name])).toEqual([
      ["builder-3", "lapsed", "acme/tool"],
      ["invited-github-acme-tool", "invited", "Tool"],
    ]);
    // unconfirmed (proof unreadable): same
    const unconfirmed = row(4, { status: "unconfirmed", owner: B1, projects: [proj(41, "github:acme/tool", { status: "unconfirmed" })] });
    expect(mergeGallery([unconfirmed], noms).map((e) => [e.kind, e.name])).toEqual([
      ["unconfirmed", "acme/tool"],
      ["invited", "Tool"],
    ]);
    // a nominated builder whose OTHER project is verified does not absorb it through its lapsed one
    const mixed = row(5, { status: "pending", owner: B1, projects: [proj(51, "github:b/ok"), proj(52, "github:acme/tool", { status: "lapsed" })] });
    expect(mergeGallery([mixed], noms).map((e) => [e.kind, e.name])).toEqual([
      ["nominated", "b/ok"],
      ["invited", "Tool"],
    ]);
  });

  test("name: curated name > profile (onboarded only) > lead project > Builder #id", () => {
    // onboarded (shown as Verified): curated first, then its own plain profile name
    expect(builderName(multi, [], true)).toBe("Acme Labs");
    expect(builderName(multi, [{ name: "Curated" }], true)).toBe("Curated");
    expect(builderName({ ...multi, profileURI: "https://acme.xyz" }, [], true)).toBe("acme.xyz");
    expect(builderName({ ...multi, profileURI: "registrai:github:acme/tool" }, [], true)).toBe("acme.xyz");
    // before onboarding (pending / nominated): never the self-chosen profile
    expect(builderName({ ...pending, profileURI: "Uniswap" })).toBe("beta/app");
    expect(builderName({ ...pending, profileURI: "Uniswap" }, [{ name: "Beta Curated" }])).toBe("Beta Curated");
    // an unproven (lapsed) builder cannot put its own text on the gallery
    const lapsed = row(4, { status: "lapsed", profileURI: "Uniswap", projects: [proj(41, "github:x/y", { status: "lapsed" })] });
    expect(builderName(lapsed)).toBe("x/y");
    expect(builderName(row(5, { status: "unverified", source: null }))).toBe("Builder #5");
    // mergeGallery applies it: the nominated card is named by its project, the verified one by its profile
    const entries = mergeGallery([multi, { ...pending, profileURI: "Uniswap" }], []);
    expect(entries.map((e) => e.name)).toEqual(["Acme Labs", "beta/app"]);
    const unconfirmed = row(6, { status: "unconfirmed", profileURI: "Uniswap", projects: [proj(61, "domain:u.org", { status: "unconfirmed" })] });
    expect(mergeGallery([unconfirmed], [])[0].name).toBe("u.org");
    // lead project: first verified, else first active, else first
    expect(leadProject(multi)?.source).toBe("domain:acme.xyz");
    expect(leadProject(lapsed)?.source).toBe("github:x/y");
  });

  test("plainProfileName: a short plain name, never a link or a claim", () => {
    expect(plainProfileName("  Acme   Labs ")).toBe("Acme Labs");
    expect(plainProfileName("Zoë & Co. (beta)!")).toBe("Zoë & Co. (beta)!");
    expect(plainProfileName("Café Ñandú")).toBe("Café Ñandú");
    expect(plainProfileName("Łódź Straße")).toBe("Łódź Straße");
    expect(plainProfileName("O\u2019Brien Labs")).toBe("O\u2019Brien Labs");
    expect(plainProfileName("acme.xyz")).toBe("acme.xyz");
    // Latin only: no look-alikes from other scripts, no other digits
    for (const homoglyph of ["Unisw\u0430p", "\u0410cme", "Ζeta", "Ｕniswap", "Acme\u200b", "Acme \u0661", "L\u0131nk", "\u017Fwap"]) {
      expect(plainProfileName(homoglyph), homoglyph).toBeNull();
    }
    for (const bad of ["", "   ", "https://acme.xyz", "ipfs://x", "registrai:github:o/r", "@handle", "a/b", "-dash", "x".repeat(49), "0xabc:1", "<b>hi</b>"]) {
      expect(plainProfileName(bad)).toBeNull();
    }
    expect(plainProfileName("x".repeat(48))).toBe("x".repeat(48));
  });

  test("avatar: the first VERIFIED github project's owner, else the initial", () => {
    expect(builderAvatarUrl(multi, 128)).toBe("https://avatars.githubusercontent.com/acme?size=128");
    // a domain first, then github: still the github owner
    expect(builderAvatarUrl({ projects: [proj(1, "domain:a.org"), proj(2, "github:bob/x")] })).toBe("https://avatars.githubusercontent.com/bob?size=96");
    // lapsed github projects never give the avatar
    expect(builderAvatarUrl({ projects: [proj(1, "github:eve/x", { status: "lapsed" }), proj(2, "domain:a.org")] })).toBeNull();
    expect(initialOf("acme.xyz")).toBe("A");
    expect(initialOf("  ")).toBe("R");
    expect(initialOf("ŻAR")).toBe("Ż");
    const e = mergeGallery([multi], [])[0];
    expect(e.avatar).toBe("https://avatars.githubusercontent.com/acme?size=128");
  });

  test("search reaches every project", () => {
    const entries = mergeGallery([multi, pending], []);
    expect(filterGallery(entries, "all", "acme/old").map((e) => e.builder?.id)).toEqual([1]);
    expect(filterGallery(entries, "all", "acme.xyz").map((e) => e.builder?.id)).toEqual([1]);
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
  const P = (projectId: number, source: string, status: "verified" | "lapsed" | "inactive", over: Record<string, unknown> = {}) => ({
    projectId, source, canonical: true, active: status !== "inactive", addedAt: 1, status, country: status === "verified" ? "PL" : null, proofUrl: `https://p/${projectId}`, ...over,
  });
  const records = [
    { builderId: 1, owner: B0.toUpperCase().replace("0X", "0x") as Address, active: true, status: "verified" as const, profileURI: "Acme", projects: [P(1, GH, "verified"), P(2, "github:acme/old", "lapsed")], country: "PL", createdAt: 1790000000 },
    { builderId: 2, owner: B1, active: true, status: "pending" as const, profileURI: "", projects: [P(3, "domain:app.example.org", "verified", { country: "DE" })], country: "DE", createdAt: 1790000100 },
    { builderId: 3, owner: B1, active: true, status: "lapsed" as const, profileURI: "", projects: [P(4, "github:gone/repo", "lapsed"), P(5, "Not Canonical", "lapsed", { canonical: false })], country: null },
    { builderId: 4, owner: B0, active: false, status: "inactive" as const, profileURI: "", projects: [P(6, "github:acme/x", "inactive")], country: "US" },
    { builderId: 5, owner: B0, active: true, status: "unverified" as const, profileURI: "", projects: [], country: null },
  ];

  test("rows: status incl. inactive, projects (canonical only), country only for claimed builders, badges attached", () => {
    const rows = galleryRowsFromRecords(records, new Map([[1, badge(1)]]));
    expect(rows.map((r) => [r.id, r.status, r.country, r.badge?.serial ?? null, r.createdAt, r.projects.length])).toEqual([
      [1, "verified", "PL", 1, 1790000000, 2],
      [2, "pending", "DE", null, 1790000100, 1],
      [3, "lapsed", null, null, 0, 1],
      [4, "inactive", null, null, 0, 1],
      [5, "unverified", null, null, 0, 0],
    ]);
    expect(rows[0].owner).toBe(B0);
    expect(rows[0].profileURI).toBe("Acme");
    expect(rows[0].projects).toEqual([
      { id: 1, source: GH, active: true, status: "verified", country: "PL", proofUrl: "https://p/1" },
      { id: 2, source: "github:acme/old", active: true, status: "lapsed", country: null, proofUrl: "https://p/2" },
    ]);
  });

  test("onboarded: verified, or the operator is its caretaker (a lapsed builder the multisig onboarded)", () => {
    const withCaretakers = records.map((r) => ({ ...r, caretaker: r.builderId === 3 ? (OP.toLowerCase() as Address) : zeroAddress }));
    expect(galleryRowsFromRecords(withCaretakers, new Map(), OP).map((r) => r.onboarded)).toEqual([true, false, true, false, false]);
    // without an operator only a verified builder is known onboarded
    expect(galleryRowsFromRecords(withCaretakers, new Map()).map((r) => r.onboarded)).toEqual([true, false, false, false, false]);
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

  test("an old single-source snapshot row reads as one project", () => {
    const snap = parseGallerySnapshot(
      {
        chainId: CHAIN,
        builderRegistry: REG,
        network: "testnet",
        builders: [
          { id: 1, owner: B0, status: "verified", source: GH, country: "PL", proofUrl: "https://ok/1", badge: badge(1), createdAt: 5 },
          { id: 2, owner: B1, status: "pending", source: "domain:app.example.org", country: "DE", proofUrl: null },
          { id: 3, owner: B1, status: "lapsed", source: "github:gone/repo", country: "PL", proofUrl: "https://ok/3" },
          { id: 4, owner: B0, status: "unverified", source: null, country: null, proofUrl: null },
          { id: 5, owner: B0, status: "inactive", source: "github:acme/x", country: null, proofUrl: null },
        ],
      },
      { chainId: CHAIN, builderRegistry: REG },
    )!;
    expect(snap.builders.map((b) => [b.id, b.status, b.country, b.projects.map((p) => [p.id, p.source, p.status, p.active, p.country])])).toEqual([
      [1, "verified", "PL", [[0, GH, "verified", true, "PL"]]],
      [2, "pending", "DE", [[0, "domain:app.example.org", "verified", true, "DE"]]],
      [3, "lapsed", null, [[0, "github:gone/repo", "lapsed", true, null]]],
      [4, "unverified", null, []],
      [5, "inactive", null, [[0, "github:acme/x", "inactive", false, null]]],
    ]);
    expect(snap.builders[0].profileURI).toBe("");
    // and the old rows render like before: one card, one chip, same name — except
    // a lapsed row, which an old snapshot cannot show was ever onboarded (hidden)
    const entries = mergeGallery(snap.builders, []);
    expect(entries.map((e) => [e.builder?.id, e.kind, e.name, e.chips.map((c) => c.kind)])).toEqual([
      [1, "verified", "registrai-multichain/oracle-primitives", ["verified"]],
      [2, "nominated", "app.example.org", ["nominated"]],
    ]);
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
          { id: 9, owner: B1, status: "pending", profileURI: 7, projects: [
            { id: 4, source: GH, active: true, status: "verified", country: "PL", proofUrl: "https://ok" },
            { id: 5, source: "github:Bad/Case", status: "verified" },
            { id: -1, source: "github:o/r", status: "bogus", country: "US", proofUrl: "http://plain" },
            "junk",
          ], country: "PL", badge: badge(4), createdAt: 5 },
        ],
      },
      { chainId: CHAIN, builderRegistry: REG },
    )!;
    expect(snap.builders).toEqual([
      { id: 1, owner: B0, status: "verified", profileURI: "", projects: [], country: null, badge: null, createdAt: 0, onboarded: true },
      {
        id: 9, owner: B1, status: "pending", profileURI: "", country: "PL", badge: badge(4), createdAt: 5, onboarded: false,
        projects: [
          { id: 4, source: GH, active: true, status: "verified", country: "PL", proofUrl: "https://ok" },
          { id: 0, source: "github:o/r", active: true, status: "lapsed", country: null, proofUrl: null },
        ],
      },
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
  /** A live builder with one project `github:acme/p<id>` (project id = id * 10). */
  const live = (id: number, over: Partial<LiveChainRow> = {}): LiveChainRow => ({
    id,
    owner: B0,
    profileURI: "",
    active: true,
    createdAt: 100 + id,
    caretaker: zeroAddress,
    badge: null,
    projects: [{ id: id * 10, source: `github:acme/p${id}`, active: true, addedAt: 1 }],
    ...over,
  });

  test("every active canonical project of an active builder is checked live, snapshot or not", () => {
    const ids = (r: LiveChainRow) => projectsToCheck(r).map((p) => p.id);
    expect(ids(live(1))).toEqual([10]);
    const added = live(1, { projects: [...live(1).projects, { id: 11, source: "domain:app.example.org", active: true, addedAt: 2 }] });
    expect(ids(added)).toEqual([10, 11]);
    // removed project, deactivated builder, non-canonical source: nothing to check
    expect(ids(live(1, { projects: [{ id: 10, source: "github:acme/p1", active: false, addedAt: 1 }] }))).toEqual([]);
    expect(ids(live(1, { active: false }))).toEqual([]);
    expect(ids(live(1, { projects: [{ id: 10, source: "github:Acme/P1", active: true, addedAt: 1 }] }))).toEqual([]);
  });

  test("the live check decides; the snapshot only stands in for a proof the live check could not read", () => {
    const snapshot = [
      row(1, { status: "pending" }),
      row(2, { status: "verified", badge: badge(1), onboarded: true }),
      row(3),
      row(7, { status: "lapsed", onboarded: true }),
    ];
    const rows = [
      live(1, { caretaker: OP }), // onboarded after the sync; proof unreadable now -> the snapshot's "verified" stands in
      live(2, { caretaker: OP, badge: badge(1, true) }), // snapshot said verified, the live check says invalid: lapsed
      live(3, { active: false }), // deactivated
      live(4), // new: github proof valid
      live(5, { projects: [{ id: 50, source: "domain:app.example.org", active: true, addedAt: 1 }] }), // new, unreadable, no snapshot
      live(6), // new: proof missing, never onboarded -> hidden
      live(7, { caretaker: OP }), // snapshot said lapsed, the proof is back: verified
    ];
    const proofs = new Map<number, LiveProof>([
      [10, { state: "unchecked" }],
      [20, { state: "invalid" }],
      [40, { state: "valid", country: "PL" }],
      [50, { state: "unchecked" }],
      [60, { state: "invalid" }],
      [70, { state: "valid", country: "DE" }],
    ]);
    const out = overlayLive(snapshot, rows, proofs, OP);
    expect(out.map((b) => [b.id, b.status, b.country, displayKind(b)])).toEqual([
      [1, "verified", "PL", "verified"],
      [2, "lapsed", null, "lapsed"],
      [3, "inactive", null, null],
      [4, "pending", "PL", "nominated"],
      [5, "unconfirmed", null, "unconfirmed"],
      [6, "lapsed", null, null],
      [7, "verified", "DE", "verified"],
    ]);
    expect(out[0].projects[0].proofUnchecked).toBe(true);
    expect(out[0].proofUnchecked).toBe(true);
    expect(out[3].proofUnchecked).toBeUndefined();
    expect(out[3].projects[0].proofUrl).toBe("https://raw.githubusercontent.com/acme/p4/HEAD/.registrai.json");
    expect(out[2].projects[0].status).toBe("inactive");
    expect(out[4].projects[0]).toMatchObject({ status: "unconfirmed", proofUnchecked: true, country: null });
    expect(out.map((b) => b.onboarded)).toEqual([true, true, false, false, false, false, true]);
  });

  test("a stale snapshot verdict never wins: a snapshot 'lapsed' is not kept when the live proof is valid, nor 'verified' when it is not", () => {
    const snap = [row(1, { status: "lapsed", onboarded: true }), row(2, { status: "verified", onboarded: true })];
    const out = overlayLive(
      snap,
      [live(1, { caretaker: OP }), live(2, { caretaker: OP })],
      new Map<number, LiveProof>([
        [10, { state: "valid", country: "PL" }],
        [20, { state: "invalid" }],
      ]),
      OP,
    );
    expect(out.map((b) => b.status)).toEqual(["verified", "lapsed"]);
    // without a live answer, the snapshot's lapsed verdict is the fallback (never "unconfirmed" when it knows)
    expect(overlayLive(snap, [live(1, { caretaker: OP })], new Map(), OP)[0].status).toBe("lapsed");
  });

  test("a project added live joins the builder's card; a removed one turns inactive", () => {
    const snap = [row(1, { status: "verified" })];
    const rows = [
      live(1, {
        caretaker: OP,
        projects: [
          { id: 10, source: "github:acme/p1", active: false, addedAt: 1 }, // removed since the sync
          { id: 11, source: "domain:new.example.org", active: true, addedAt: 2 }, // added since, proof valid
          { id: 12, source: "Junk Source", active: true, addedAt: 3 }, // non-canonical: hidden, counts as lapsed
        ],
      }),
    ];
    const out = overlayLive(snap, rows, new Map([[11, { state: "valid", country: "DE" } as LiveProof]]), OP);
    expect(out[0].status).toBe("verified");
    expect(out[0].country).toBe("DE");
    expect(out[0].projects.map((p) => [p.id, p.status])).toEqual([
      [10, "inactive"],
      [11, "verified"],
    ]);
    // with only the non-canonical project left active, the builder is lapsed
    const only = overlayLive([], [live(2, { projects: [{ id: 20, source: "Junk", active: true, addedAt: 1 }] })], new Map(), OP);
    expect(only[0].status).toBe("lapsed");
    expect(only[0].projects).toEqual([]);
  });

  test("an owner change voids the snapshot's verdicts (the proofs name the old wallet)", () => {
    const snap = [row(1, { status: "verified" })];
    const moved = overlayLive(snap, [live(1, { owner: B1, caretaker: OP })], new Map([[10, { state: "invalid" } as LiveProof]]), OP);
    expect(moved[0].status).toBe("lapsed");
    expect(moved[0].owner).toBe(B1);
    // unreadable after the move: unconfirmed, not the old owner's "verified"
    expect(overlayLive(snap, [live(1, { owner: B1, caretaker: OP })], new Map(), OP)[0].status).toBe("unconfirmed");
  });

  test("an onboarded builder whose proof nobody could read is unconfirmed (grey), never verified — even with a badge", () => {
    const domain = [{ id: 10, source: "domain:app.example.org", active: true, addedAt: 1 }];
    const out = overlayLive([], [live(1, { caretaker: OP, projects: domain })], new Map(), OP);
    expect(out[0].status).toBe("unconfirmed");
    expect(displayKind(out[0])).toBe("unconfirmed");
    const withBadge = overlayLive([], [live(1, { caretaker: OP, projects: domain, badge: badge(3) })], new Map(), OP);
    expect(displayKind(withBadge[0])).toBe("unconfirmed");
    expect(greyReason(withBadge[0])).toMatch(/unconfirmed/);
  });

  test("one validated project is enough: the unreadable one beside it is unconfirmed", () => {
    const out = overlayLive(
      [],
      [live(1, { projects: [{ id: 10, source: "github:acme/p1", active: true, addedAt: 1 }, { id: 11, source: "domain:d.org", active: true, addedAt: 2 }] })],
      new Map<number, LiveProof>([[10, { state: "valid", country: "PL" }], [11, { state: "unchecked" }]]),
      OP,
    );
    expect(out[0].status).toBe("pending");
    expect(out[0].projects.map((p) => p.status)).toEqual(["verified", "unconfirmed"]);
    expect(projectChips(out[0]).map((c) => c.kind)).toEqual(["nominated", "unconfirmed"]);
  });

  test("checkLiveProofs: at most 6 at a time, within the budget; unfinished checks stay unchecked", async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      live(i + 1, {
        projects: [
          { id: (i + 1) * 10, source: `github:acme/p${i + 1}`, active: true, addedAt: 1 },
          { id: (i + 1) * 10 + 1, source: `domain:s${i + 1}.example.org`, active: true, addedAt: 2 },
        ],
      }),
    );
    let running = 0;
    let peak = 0;
    const done = await checkLiveProofs(rows, async (p) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return p.source.startsWith("github:") ? { state: "valid", country: "PL" } : { state: "invalid" };
    });
    expect(peak).toBe(6);
    expect(done.size).toBe(10);
    expect(done.get(10)).toEqual({ state: "valid", country: "PL" });
    expect(done.get(11)).toEqual({ state: "invalid" });

    // a check that hangs past the budget is left out; one that throws too
    const partial = await checkLiveProofs(
      [live(1), live(2), live(3)],
      async (p) => {
        if (p.source.endsWith("p2")) return new Promise<LiveProof>(() => undefined);
        if (p.source.endsWith("p3")) throw new Error("boom");
        return { state: "valid", country: "PL" };
      },
      { budgetMs: 30 },
    );
    expect([...partial.keys()]).toEqual([10]);
  });

  test("snapshot rows the live read did not reach are kept", () => {
    expect(overlayLive([row(1), row(2)], [live(1)], new Map(), OP).map((b) => b.id)).toEqual([1, 2]);
  });

  test("readLiveGallery reads registry, projects, caretaker and badge per builder", async () => {
    const calls: string[] = [];
    const reader: GalleryReader = {
      readContract: async ({ functionName, args }) => {
        calls.push(functionName);
        const id = args ? Number(args[0] as bigint) : 0;
        switch (functionName) {
          case "nextId": return 3n;
          case "builders": return [id === 1 ? B0 : B1, id === 1 ? "Acme" : "", "0x", BigInt(1000 + id), true] as const;
          case "projectsOf": return id === 1 ? [1n, 2n] : [];
          case "projects": return [1n, id === 1 ? "github:acme/p1" : "domain:acme.xyz", id === 1, BigInt(500 + id)] as const;
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
      {
        id: 1, owner: B0, profileURI: "Acme", active: true, createdAt: 1001, caretaker: OP,
        badge: { serial: 7, lapsed: false, issuedAt: 1790000000, image: "https://registrai.cc/badge/arc-testnet/7.jpg" },
        projects: [
          { id: 1, source: "github:acme/p1", active: true, addedAt: 501 },
          { id: 2, source: "domain:acme.xyz", active: false, addedAt: 502 },
        ],
      },
      { id: 2, owner: B1, profileURI: "", active: true, createdAt: 1002, caretaker: zeroAddress, badge: null, projects: [] },
    ]);
    // Nothing market-related is ever read.
    expect(new Set(calls)).toEqual(new Set(["nextId", "builders", "projectsOf", "projects", "caretakerOf", "serialOf", "isLapsed", "lapsed", "issuedAt"]));
  });
});

describe("browserProofCheck", () => {
  const GH_VALID = vectors.proofs.find((p) => p.name === "valid github claim")!.file;
  const res = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

  test("a valid file is valid, with its country", async () => {
    const r = await browserProofCheck({ owner: B0, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(200, GH_VALID) });
    expect(r).toEqual({ state: "valid", country: "PL" });
  });

  test("another owner, a missing file or bad JSON is invalid", async () => {
    expect(await browserProofCheck({ owner: B1, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(200, GH_VALID) })).toEqual({ state: "invalid" });
    expect(await browserProofCheck({ owner: B0, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(404, "") })).toEqual({ state: "invalid" });
    expect(await browserProofCheck({ owner: B0, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(200, "{nope") })).toEqual({ state: "invalid" });
  });

  test("browserProjectProof tells a re-sign (proof for another wallet) from a broken proof", async () => {
    expect(await browserProjectProof({ owner: B0, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(200, GH_VALID) })).toEqual({ state: "valid", country: "PL" });
    expect(await browserProjectProof({ owner: B1, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(200, GH_VALID) })).toEqual({ state: "resign", signer: B0 });
    expect(await browserProjectProof({ owner: B0, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(404, "") })).toEqual({ state: "missing" });
    const bad = await browserProjectProof({ owner: B0, source: GH }, { chainId: 5042, fetchImpl: async () => res(200, GH_VALID) });
    expect(bad.state).toBe("invalid");
    expect(await browserProjectProof({ owner: B0, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(503, "") })).toEqual({ state: "unchecked", reason: "HTTP 503" });
  });

  test("a read the browser may not make (CORS) or a server error is unchecked, never invalid", async () => {
    const blocked = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await browserProofCheck({ owner: B0, source: "domain:app.example.org" }, { chainId: CHAIN, fetchImpl: blocked })).toEqual({ state: "unchecked" });
    expect(await browserProofCheck({ owner: B0, source: GH }, { chainId: CHAIN, fetchImpl: async () => res(503, "") })).toEqual({ state: "unchecked" });
  });
});

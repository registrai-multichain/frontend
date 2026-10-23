import { describe, expect, test } from "vitest";
import {
  adminLoginMessage,
  applyInviteFields,
  claimLink,
  inviteDm,
  INVITE_OPT_OUT,
  issuedFresh,
  newInvite,
  parseAdminAllowlist,
  parseAdminLoginMessage,
  publicInvite,
  recordOpen,
  safeEqual,
  validateInviteInput,
} from "./builders-admin";

const LOGIN = { origin: "https://builder.registrai.cc", nonce: "0123456789abcdef0123456789abcdef", issued: "2026-09-24T12:00:00.000Z" };

describe("sign-in message", () => {
  test("exact bytes", () => {
    expect(adminLoginMessage(LOGIN)).toBe(
      "Registrai builders admin sign-in\norigin: https://builder.registrai.cc\nnonce: 0123456789abcdef0123456789abcdef\nissued: 2026-09-24T12:00:00.000Z",
    );
  });

  test("round trip; anything not canonical is rejected", () => {
    const m = adminLoginMessage(LOGIN);
    expect(parseAdminLoginMessage(m)).toEqual(LOGIN);
    expect(parseAdminLoginMessage(adminLoginMessage({ ...LOGIN, origin: "http://localhost:8788" }))).toMatchObject({ origin: "http://localhost:8788" });
    expect(parseAdminLoginMessage(`${m}\n`)).toBeNull();
    expect(parseAdminLoginMessage(m.replace("\n", "\r\n"))).toBeNull();
    expect(parseAdminLoginMessage(m.replace("sign-in", "login"))).toBeNull();
    expect(parseAdminLoginMessage(m.replace("origin: ", "origin:  "))).toBeNull();
    expect(parseAdminLoginMessage(adminLoginMessage({ ...LOGIN, origin: "https://x.cc/path" }))).toBeNull();
    expect(parseAdminLoginMessage(adminLoginMessage({ ...LOGIN, nonce: "short" }))).toBeNull();
    // the nonce is base64url (builders-site stateless nonces): no padding, no + or /
    expect(parseAdminLoginMessage(adminLoginMessage({ ...LOGIN, nonce: `${LOGIN.nonce}==` }))).toBeNull();
    expect(parseAdminLoginMessage(adminLoginMessage({ ...LOGIN, nonce: `${LOGIN.nonce.slice(0, 20)}+/x` }))).toBeNull();
    expect(parseAdminLoginMessage(adminLoginMessage({ ...LOGIN, nonce: "A".repeat(129) }))).toBeNull();
    expect(parseAdminLoginMessage(adminLoginMessage({ ...LOGIN, nonce: "Ab-_".repeat(18) + "xyz" }))).not.toBeNull();
    expect(parseAdminLoginMessage(adminLoginMessage({ ...LOGIN, issued: "yesterday" }))).toBeNull();
    expect(parseAdminLoginMessage(adminLoginMessage({ ...LOGIN, issued: "2026-13-45T99:00:00Z" }))).toBeNull();
  });

  test("issued within 5 minutes (and at most a minute ahead)", () => {
    const t = Date.parse(LOGIN.issued);
    expect(issuedFresh(LOGIN.issued, t)).toBe(true);
    expect(issuedFresh(LOGIN.issued, t + 5 * 60_000)).toBe(true);
    expect(issuedFresh(LOGIN.issued, t + 5 * 60_000 + 1)).toBe(false);
    expect(issuedFresh(LOGIN.issued, t - 60_000)).toBe(true);
    expect(issuedFresh(LOGIN.issued, t - 60_001)).toBe(false);
    expect(issuedFresh("nope", t)).toBe(false);
  });

  test("allowlist parsing", () => {
    const set = parseAdminAllowlist(" 0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266,0x70997970c51812dc3a010c7d01b50e0d17dc79c8 , junk,, 0x123 ");
    expect([...set]).toEqual(["0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"]);
    expect(parseAdminAllowlist("").size).toBe(0);
    expect(parseAdminAllowlist(undefined).size).toBe(0);
  });
});

describe("invites", () => {
  test("validation: source normalised like /verify, lengths, X handle", () => {
    expect(validateInviteInput({ source: "https://github.com/Foo/Bar", name: " Foo ", x: "foo", note: "n" })).toEqual({
      ok: true,
      source: "github:foo/bar",
      fields: { name: "Foo", x: "@foo", note: "n" },
    });
    expect(validateInviteInput({ source: "app.example.org" })).toEqual({ ok: true, source: "domain:app.example.org", fields: {} });
    expect(validateInviteInput({ source: "a/b", name: "", x: null })).toEqual({ ok: true, source: "github:a/b", fields: { name: null, x: null } });
    expect(validateInviteInput({ source: "a/b", x: "@abcdefghijklmno" })).toMatchObject({ ok: true, fields: { x: "@abcdefghijklmno" } });
    for (const bad of [
      null,
      [],
      "a/b",
      { source: 1 },
      { source: "ftp://x.org" },
      { source: "a/b", name: "x".repeat(81) },
      { source: "a/b", x: "@abcdefghijklmnop" },
      { source: "a/b", x: "no spaces" },
      { source: "a/b", x: "x".repeat(33) },
      { source: "a/b", note: "x".repeat(501) },
      { source: "a/b", note: 3 },
    ]) {
      expect(validateInviteInput(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  const rec = newInvite("github:foo/bar", { name: "Foo", x: "@foo", note: "private" }, {
    code: "abcdef0123456789abcdef01",
    createdAt: "2026-09-24T12:00:00.000Z",
    createdBy: "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  });

  test("new record, edits, opens", () => {
    expect(rec).toEqual({
      source: "github:foo/bar",
      name: "Foo",
      x: "@foo",
      note: "private",
      code: "abcdef0123456789abcdef01",
      createdAt: "2026-09-24T12:00:00.000Z",
      createdBy: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      opens: 0,
    });
    const edited = applyInviteFields(rec, { name: null, note: "new" });
    expect(edited.name).toBeUndefined();
    expect(edited).toMatchObject({ x: "@foo", note: "new" });
    const o1 = recordOpen(rec, "2026-09-25T00:00:00.000Z");
    const o2 = recordOpen(o1, "2026-09-26T00:00:00.000Z");
    expect(o2).toMatchObject({ opens: 2, firstOpenedAt: "2026-09-25T00:00:00.000Z", lastOpenedAt: "2026-09-26T00:00:00.000Z" });
  });

  test("public projection strips the note, the code and tracking", () => {
    const opened = recordOpen(rec, "2026-09-25T00:00:00.000Z");
    expect(publicInvite(opened)).toEqual({ source: "github:foo/bar", name: "Foo", x: "@foo", createdAt: "2026-09-24T12:00:00.000Z" });
    expect(publicInvite({ ...rec, name: undefined, x: undefined })).toEqual({ source: "github:foo/bar", createdAt: rec.createdAt });
  });

  test("claim link and DM", () => {
    const link = claimLink("https://builder.registrai.cc/", "github:foo/bar", rec.code);
    expect(link).toBe("https://builder.registrai.cc/verify/?source=github%3Afoo%2Fbar&invite=abcdef0123456789abcdef01");
    const u = new URL(link);
    expect(u.searchParams.get("source")).toBe("github:foo/bar");
    expect(u.searchParams.get("invite")).toBe(rec.code);
    expect(inviteDm(rec, link)).toBe(
      `Hey Foo, we'd like to list foo/bar as a Registrai verified builder on Arc. Claim it here (takes 2 minutes, signing is free): ${link} Don't want to be listed? Reply and we'll remove it.`,
    );
    expect(inviteDm({ source: "domain:app.example.org" }, "L")).toBe(
      "Hey, we'd like to list app.example.org as a Registrai verified builder on Arc. Claim it here (takes 2 minutes, signing is free): L Don't want to be listed? Reply and we'll remove it.",
    );
  });

  test("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("inviteDm (wonder markets)", () => {
  const link = "https://builder.registrai.cc/verify/?source=github%3Aacme%2Ftool&invite=abc";
  test("every invite offers the opt-out", () => {
    const dm = inviteDm({ source: "github:acme/tool", name: "Ann" }, link);
    expect(dm.startsWith("Hey Ann, we'd like to list acme/tool as a Registrai verified builder on Arc.")).toBe(true);
    expect(dm).toContain(`Claim it here (takes 2 minutes, signing is free): ${link}`);
    expect(dm.endsWith(INVITE_OPT_OUT)).toBe(true);
    expect(INVITE_OPT_OUT).toBe("Don't want to be listed? Reply and we'll remove it.");
  });
  test("with escrow, the spec's line", () => {
    const dm = inviteDm({ source: "github:acme/tool" }, link, 12_500_000n);
    expect(dm).toContain(`People are already trading on your project: $12.50 is waiting for you. Claim it here: ${link}`);
    expect(dm.endsWith(INVITE_OPT_OUT)).toBe(true);
  });
  test("inviteDm without escrow says nothing about money", () => {
    for (const w of [undefined, null, 0n]) expect(inviteDm({ source: "github:acme/tool" }, link, w)).not.toContain("$");
  });
});

import { adminView } from "./builders-admin";

describe("adminView (onboarder sign-in)", () => {
  test("an admin sees and does everything", () => {
    expect(adminView("admin")).toEqual({
      inviteForm: true, editInvites: true, dismissRequests: true, safeFiles: true, directOnboard: true,
      badges: true, recovery: true, projects: true, wonder: true,
    });
  });
  test("an onboarder reads invites and requests, onboards directly, and nothing else", () => {
    expect(adminView("onboarder")).toEqual({
      inviteForm: false, editInvites: false, dismissRequests: false, safeFiles: false, directOnboard: true,
      badges: false, recovery: false, projects: false, wonder: false,
    });
  });
});

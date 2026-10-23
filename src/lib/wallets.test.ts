import { describe, expect, test } from "vitest";
import { dedupeWallets, defaultWallet, isAnnouncement, type InjectedWallet } from "./wallets";

const provider = { request: async () => null };
const w = (rdns: string, name = rdns, uuid = `${rdns}-uuid`): InjectedWallet => ({ uuid, name, rdns, icon: "data:image/svg+xml;base64,AA==", provider });

describe("wallet discovery (EIP-6963)", () => {
  test("one entry per wallet, in announcement order", () => {
    const list = dedupeWallets([w("io.rabby"), w("io.metamask"), w("io.rabby", "Rabby again", "other-uuid"), w("app.phantom")]);
    expect(list.map((x) => x.rdns)).toEqual(["io.rabby", "io.metamask", "app.phantom"]);
  });

  test("default: the wallet picked last time if still installed, else the only one, else ask", () => {
    const several = [w("io.rabby"), w("io.metamask")];
    expect(defaultWallet(several, "io.metamask")?.rdns).toBe("io.metamask");
    expect(defaultWallet(several, "com.coinbase.wallet")).toBeNull();
    expect(defaultWallet(several, null)).toBeNull();
    expect(defaultWallet([w("io.metamask")], null)?.rdns).toBe("io.metamask");
    expect(defaultWallet([], "io.metamask")).toBeNull();
  });

  test("announcements: the spec's shape with a data: image icon only", () => {
    const info = { uuid: "u", name: "MetaMask", rdns: "io.metamask", icon: "data:image/png;base64,AA==" };
    expect(isAnnouncement({ info, provider })).toBe(true);
    expect(isAnnouncement({ info: { ...info, icon: "https://evil.example/x.png" }, provider })).toBe(false);
    expect(isAnnouncement({ info: { ...info, icon: "javascript:alert(1)" }, provider })).toBe(false);
    expect(isAnnouncement({ info, provider: {} })).toBe(false);
    expect(isAnnouncement({ info: { name: "x" }, provider })).toBe(false);
    expect(isAnnouncement(null)).toBe(false);
  });
});

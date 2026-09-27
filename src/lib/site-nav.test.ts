import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { APP_NAV, DASHBOARD_URL } from "./site-nav";

describe("the app and the dashboard are separate sites", () => {
  test("the app's navbar is the app only: no Transparency tab", () => {
    expect(APP_NAV.map((n) => n.label)).toEqual(["Markets", "Rounds", "Propose", "Builders", "Atlas", "How it works"]);
    expect(APP_NAV.some((n) => n.href.includes("transparency"))).toBe(false);
  });

  test("the app links to the dashboard from its footer, on its own domain", () => {
    expect(DASHBOARD_URL).toBe("https://dashboard.registrai.cc/");
    const shell = readFileSync(resolve(__dirname, "../components/PerennialShell.tsx"), "utf8");
    expect(shell).toContain("DASHBOARD_URL");
  });

  test("the dashboard page has its own shell with no app navigation", () => {
    const page = readFileSync(resolve(__dirname, "../app/transparency/page.tsx"), "utf8");
    expect(page).toContain("DashboardShell");
    expect(page).not.toContain("PerennialShell");
    const shell = readFileSync(resolve(__dirname, "../components/transparency/DashboardShell.tsx"), "utf8");
    expect(shell).not.toMatch(/PaperNav|APP_NAV/);
  });
});

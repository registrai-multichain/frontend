import { describe, expect, test } from "vitest";
import deployment from "./deployments/arc-mainnet.json";
import { BUYBACK, CONTRACTS, FEE_SPLITS, RECORD, ROLES, WALLETS, holderLabel, nativeToUsdc } from "./transparency";

describe("transparency (app.registrai.cc/transparency)", () => {
  test("every wallet comes from the mainnet deployment file, with what it does and what it cannot", () => {
    const b = deployment.builders as unknown as { operator: string; roles: Record<string, string> };
    expect(WALLETS.map((w) => w.address.toLowerCase())).toEqual(
      [b.roles.adminSafe, b.operator, b.roles.onboarder, b.roles.deployer].map((a) => a.toLowerCase()),
    );
    for (const w of WALLETS) {
      expect(w.label.length).toBeGreaterThan(0);
      expect(w.what.length).toBeGreaterThan(10);
      expect(w.cannot.length).toBeGreaterThan(10);
    }
  });

  test("the three phase-1 contracts, with their role names (DEFAULT_ADMIN first)", () => {
    expect(CONTRACTS.map((c) => c.address)).toEqual([
      deployment.builders.BuilderRegistry, deployment.builders.CaretakerRegistry, deployment.builders.VerifiedBuilderBadge,
    ]);
    expect(ROLES.registry.map((r) => r.name)).toEqual(["DEFAULT_ADMIN_ROLE", "REGISTRAR_ROLE"]);
    expect(ROLES.caretakers.map((r) => r.name)).toEqual(["DEFAULT_ADMIN_ROLE", "GOVERNOR_ROLE"]);
    expect(ROLES.badge.map((r) => r.name)).toEqual(["DEFAULT_ADMIN_ROLE", "ISSUER_ROLE", "STATUS_ROLE", "REVOKER_ROLE"]);
    expect(ROLES.registry[0].hash).toBe(`0x${"0".repeat(64)}`);
    expect(ROLES.badge[1].hash).toBe("0x114e74f6ea3bd819998f78687bfcb11b140da08e9b7d222fa9c1f1ba1f2aa122");
  });

  test("names a known wallet, shortens anything else", () => {
    expect(holderLabel(deployment.builders.roles.adminSafe.toLowerCase())).toBe("Admin Safe");
    expect(holderLabel("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });

  test("fee splits add up to 100%; the buyback spends its trigger in whole chunks", () => {
    for (const s of FEE_SPLITS) expect(s.legs.reduce((a, l) => a + l.pct, 0)).toBe(100);
    expect(BUYBACK.triggerUsdc % BUYBACK.chunkUsdc).toBe(0);
    expect(BUYBACK.burnAddress).toBe("0x000000000000000000000000000000000000dEaD");
  });

  test("the public record is newest first, every entry dated and titled", () => {
    const dates = RECORD.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const r of RECORD) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.title.length).toBeGreaterThan(5);
    }
  });

  test("Arc's native gas balance (18 decimals) in USDC base units (6)", () => {
    expect(nativeToUsdc(4_989_297_966_500_000_000n)).toBe(4_989_297n);
    expect(nativeToUsdc(0n)).toBe(0n);
  });
});

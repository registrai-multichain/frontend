import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts", "builders-site/**/*.test.ts"], environment: "node" },
});

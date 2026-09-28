import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // .test.tsx: component tests rendered with react-dom/server (the admin shell and sections).
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "builders-site/**/*.test.ts", "dashboard-site/**/*.test.ts"],
    environment: "node",
  },
});

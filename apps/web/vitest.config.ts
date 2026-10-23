import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["src/lib/documents/**/*.ts", "src/lib/ai/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      thresholds: {
        "src/lib/documents/**": {
          lines: 88,
          functions: 96,
          statements: 88,
          branches: 70,
        },
        "src/lib/ai/**": {
          lines: 98,
          functions: 98,
          statements: 98,
          branches: 97,
        },
      },
    },
  },
});

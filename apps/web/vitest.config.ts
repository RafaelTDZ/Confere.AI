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
          lines: 68,
          functions: 77,
          statements: 68,
          branches: 49,
        },
        "src/lib/ai/**": {
          lines: 2.65,
          functions: 5.14,
          statements: 2.2,
          branches: 1.98,
        },
      },
    },
  },
});

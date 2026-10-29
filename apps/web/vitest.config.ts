import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // O pacote real lança ao ser importado fora do React Server; nos testes
      // basta um módulo vazio (o guard de build é exercido pelo `next build`).
      "server-only": fileURLToPath(
        new URL("./src/test/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["src/lib/documents/**/*.ts", "src/lib/ai/**/*.ts", "src/lib/tracking/**/*.ts"],
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
        "src/lib/tracking/{validate,carriers,normalize,shared}.ts": {
          lines: 85,
          functions: 90,
          statements: 85,
          branches: 75,
        },
      },
    },
  },
});

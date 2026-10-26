import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LIB_DIR = fileURLToPath(new URL(".", import.meta.url));

/**
 * Módulos que podem rodar no cliente (sem segredos/DB/Node APIs).
 * Tudo o mais em `src/lib` precisa do marcador `server-only`.
 */
const CLIENT_SAFE = new Set([
  "utils.ts",
  "pagination.ts",
  "ai/schemas.ts",
  "ai/usage.ts",
  "ai/model-compat.ts",
  "auth/tenant.ts",
  "supabase/auth-cookie.ts",
  "supabase/client.ts",
  "supabase/database.types.ts",
  "supabase/fetch.ts",
  "supabase/public-key.ts",
]);

function listTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
    files.push(fullPath);
  }

  return files;
}

function normalize(path: string): string {
  return relative(LIB_DIR, path).split("\\").join("/");
}

describe("proteção server-only", () => {
  it("marca todos os módulos de servidor de src/lib", () => {
    const missing = listTypeScriptFiles(LIB_DIR)
      .filter((file) => {
        const name = normalize(file);
        if (name.endsWith("-shared.ts")) return false;
        return !CLIENT_SAFE.has(name);
      })
      .filter((file) => {
        const content = readFileSync(file, "utf8");
        return !content.includes('import "server-only";');
      })
      .map(normalize)
      .sort();

    expect(missing).toEqual([]);
  });

  it("mantém o marcador na primeira linha dos módulos críticos", () => {
    const critical = [
      "supabase/admin.ts",
      "supabase/server.ts",
      "documents/index.ts",
      "documents/analyze-pipeline.ts",
      "documents/storage.ts",
      "ai/tasks/classify.ts",
      "ai/document-content.ts",
      "ai/pdf-pages.ts",
      "settings/ai-settings.ts",
      "security/rate-limit.ts",
    ];

    for (const name of critical) {
      const content = readFileSync(join(LIB_DIR, name), "utf8");
      expect(content.startsWith('import "server-only";'), name).toBe(true);
    }
  });

  it("não marca os módulos client-safe", () => {
    for (const name of CLIENT_SAFE) {
      const content = readFileSync(join(LIB_DIR, name), "utf8");
      expect(content.includes('import "server-only";'), name).toBe(false);
    }
  });
});

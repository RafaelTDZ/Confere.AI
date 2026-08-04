import type { NextConfig } from "next";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");

const monorepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// Único .env do monorepo (raiz). forceReload evita o cache de loadEnvConfig
// que aponta primeiro para apps/web e ignoraria a raiz.
loadEnvConfig(
  monorepoRoot,
  process.env.NODE_ENV !== "production",
  undefined,
  true,
);

const nextConfig: NextConfig = {
  // Proxy /supabase implementado em src/app/supabase/[...path]/route.ts
};

export default nextConfig;

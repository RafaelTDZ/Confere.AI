import type { NextConfig } from "next";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");

const appDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(appDir, "../..");

// Único .env do monorepo (raiz). forceReload evita o cache de loadEnvConfig
// que aponta primeiro para apps/web e ignoraria a raiz.
loadEnvConfig(
  monorepoRoot,
  process.env.NODE_ENV !== "production",
  undefined,
  true,
);

/** Converte um diretório absoluto no glob relativo usado pelo tracing. */
function tracingGlob(directory: string, suffix = "**"): string {
  const relativeDir = path.relative(appDir, directory).split(path.sep).join("/");
  return `${relativeDir}/${suffix}`;
}

/** Resolve o diretório de um pacote a partir de outro pacote (ou null). */
function resolvePackageDir(from: NodeRequire, name: string): string | null {
  try {
    return path.dirname(from.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

/**
 * Assets que o `pdf-to-img`/`pdfjs-dist` carregam em runtime. Os globs do
 * `outputFileTracingIncludes` são resolvidos a partir de apps/web.
 */
function pdfTracingIncludes(): string[] {
  const pdfjsPackage = require.resolve("pdfjs-dist/package.json");
  const pdfjsDir = path.dirname(pdfjsPackage);
  const includes = [
    tracingGlob(path.join(pdfjsDir, "standard_fonts")),
    tracingGlob(path.join(pdfjsDir, "cmaps")),
  ];

  // `@napi-rs/canvas` é dependência direta (e o pdfjs-dist a requer em
  // runtime). Inclui o pacote e o binding nativo da plataforma do build.
  const canvasPackage = require.resolve("@napi-rs/canvas/package.json");
  const canvasDir = path.dirname(canvasPackage);
  includes.push(tracingGlob(canvasDir), "node_modules/@napi-rs/canvas/**");

  const canvasRequire = createRequire(canvasPackage);
  const manifest = require(canvasPackage) as {
    optionalDependencies?: Record<string, string>;
  };
  for (const platformPackage of Object.keys(
    manifest.optionalDependencies ?? {},
  )) {
    const platformDir = resolvePackageDir(canvasRequire, platformPackage);
    if (platformDir) {
      includes.push(
        tracingGlob(platformDir),
        `node_modules/${platformPackage}/**`,
      );
    }
  }

  return includes;
}

// O pipeline de análise roda em `/api/ai/analyze` (via `after()`) e em
// `/api/ai/jobs/run`; as duas rotas precisam dos assets de PDF no deploy.
const pdfAssets = pdfTracingIncludes();

const nextConfig: NextConfig = {
  // Proxy /supabase implementado em src/app/supabase/[...path]/route.ts
  serverExternalPackages: ["pdf-to-img", "pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/ai/analyze": pdfAssets,
    "/api/ai/jobs/run": pdfAssets,
  },
};

export default nextConfig;

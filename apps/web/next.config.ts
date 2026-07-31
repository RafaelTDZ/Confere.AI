import type { NextConfig } from "next";

const supabaseUpstream =
  process.env.SUPABASE_INTERNAL_URL ?? "http://127.0.0.1:54321";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // Proxy same-origin para o browser alcançar o Supabase local
        // (preview/túnel remoto não consegue falar com 127.0.0.1:54321).
        source: "/supabase/:path*",
        destination: `${supabaseUpstream}/:path*`,
      },
    ];
  },
};

export default nextConfig;

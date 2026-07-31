import type { NextConfig } from "next";

const supabaseUpstream =
  process.env.SUPABASE_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "http://127.0.0.1:54321";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // Proxy same-origin para o browser alcançar o Supabase. O destino segue
        // NEXT_PUBLIC_SUPABASE_URL, então funciona tanto com o Supabase local
        // quanto com o hospedado em produção/preview (o browser não fala direto
        // com o upstream, o que quebraria em preview/túnel remoto).
        source: "/supabase/:path*",
        destination: `${supabaseUpstream}/:path*`,
      },
    ];
  },
};

export default nextConfig;

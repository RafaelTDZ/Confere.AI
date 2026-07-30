import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@confere/application",
    "@confere/ai",
    "@confere/database",
    "@confere/domain",
    "@confere/infrastructure",
  ],
  serverExternalPackages: ["pg", "pg-boss"],
  webpack: (config) => {
    // Packages internos usam imports relativos com extensao .js (padrao ESM
    // NodeNext) apontando para fontes .ts — mapear para o webpack.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;

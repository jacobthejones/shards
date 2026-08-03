import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // GitHub Pages serves the static export from the repository project path.
  // Keeping this in the app build makes Vinext's router and asset URLs agree
  // with the deployed URL instead of hydrating as though the app lived at /.
  basePath: "/shards",
  trailingSlash: true,
};

export default nextConfig;

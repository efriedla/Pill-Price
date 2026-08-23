import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ADR-001. The static/dynamic boundary is at the component level: routes
  // serve a prerendered shell and upstream data is fetched inside `use cache`
  // functions whose `cacheLife` matches that source's real freshness.
  cacheComponents: true,
};

export default nextConfig;

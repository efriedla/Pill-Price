import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ADR-001. The static/dynamic boundary is at the component level: routes
  // serve a prerendered shell and upstream data is fetched inside `use cache`
  // functions whose `cacheLife` matches that source's real freshness.
  cacheComponents: true,
  // ADR-005 Q3. An unlisted /drug/[rxcui] is served as an instant App Shell
  // and upgraded after its first visit, instead of waiting on a full server
  // render. That is what lets the prerender list stay one drug long.
  partialPrefetching: true,
};

export default nextConfig;

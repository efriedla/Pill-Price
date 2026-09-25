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
  // ADR-016. Every page query loads the price index (createContext), so every
  // server route that runs one reads the snapshot at request time. On Vercel a
  // function carries only the files its trace names, and a runtime readFile
  // of a path built from process.cwd() is not traceable. Named here, it ships
  // with each function; without it, every dynamic price would render
  // "couldn't load price data".
  outputFileTracingIncludes: {
    "/drug/\\[rxcui\\]": ["./.data/nadac-snapshot.json"],
    "/search": ["./.data/nadac-snapshot.json"],
    "/api/graphql": ["./.data/nadac-snapshot.json"],
  },
};

export default nextConfig;

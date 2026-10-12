import type { MetadataRoute } from "next";

// A self-hosted install is private: keep it out of search.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}

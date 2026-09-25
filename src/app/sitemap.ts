import type { MetadataRoute } from "next";

const BASE = "https://registrai.cc";

export const dynamic = "force-static";

/**
 * The public registrai.cc only: the landing and the bridge. The builder
 * registry is on builder.registrai.cc; every other app route runs on testnet
 * and redirects to the landing (src/lib/public-site.ts), so none is listed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ["", "/bridge"].map((path) => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: path === "" ? 1 : 0.7,
  }));
}

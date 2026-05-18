import type { MetadataRoute } from "next";
import { DEMO_MARKETS } from "@/lib/markets-demo";
import { ALL_FEEDS } from "@/lib/demo";

const BASE = "https://registrai.cc";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticRoutes = [
    "",
    "/markets",
    "/markets/create",
    "/vault",
    "/agents",
    "/agents/create",
    "/docs",
    "/devlog",
    "/about",
    "/profile",
  ].map((path) => ({ url: `${BASE}${path}`, lastModified: now, changeFrequency: "weekly" as const, priority: path === "" ? 1 : 0.7 }));

  const marketRoutes = DEMO_MARKETS.map((m) => ({
    url: `${BASE}/markets/${m.id}`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.6,
  }));

  const feedRoutes = ALL_FEEDS.map((f) => ({
    url: `${BASE}/feed/${f.id}`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...marketRoutes, ...feedRoutes];
}

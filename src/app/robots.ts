import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: "https://registrai.cc/sitemap.xml",
    host: "https://registrai.cc",
  };
}

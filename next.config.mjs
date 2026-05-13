/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export for Cloudflare Pages. All routes pre-rendered to HTML.
  output: "export",
  // Cloudflare Pages serves /foo as /foo/index.html — trailingSlash makes
  // Next.js generate the directory-index layout that matches.
  trailingSlash: true,
  // Disable next/image optimization since static export has no Node runtime.
  images: { unoptimized: true },
};

export default nextConfig;

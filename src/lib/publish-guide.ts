/**
 * "How to publish it" on /verify step 4: short, host-specific recipes for
 * putting the signed proof where the checks read it: `.registrai.json` at the
 * root of a public GitHub repo's default branch, or
 * `https://<domain>/.well-known/registrai.json`. Pure data; the component
 * renders it. The rules line mirrors src/lib/proof-fetch.ts.
 */
import { PROOF_MAX_BYTES, PROOF_MAX_REDIRECTS } from "./proof-fetch";
import { proofUrl, sourceLabel } from "./verified-builders";

export interface PublishRecipe {
  id: string;
  title: string;
  steps: string[];
  /** A copyable command block, when there is one. */
  code?: string;
}

export interface PublishGuide {
  kind: "repo" | "domain";
  /** Where the file must end up, as the builder should read it. */
  target: string;
  recipes: PublishRecipe[];
  /** What the check requires, in one line each. */
  rules: string[];
}

/** Pure: the guide for a canonical source. */
export function publishGuide(source: string): PublishGuide {
  const url = proofUrl(source);
  if (source.startsWith("github:")) {
    const repo = source.slice(7);
    return {
      kind: "repo",
      target: `.registrai.json in the root of ${repo}, on its default branch`,
      recipes: [
        {
          id: "github-web",
          title: "In the browser (GitHub)",
          steps: [
            `Open github.com/${repo} and choose Add file → Create new file.`,
            "Name it .registrai.json (with the leading dot), in the root folder.",
            "Paste the file above exactly as it is.",
            "Commit changes → commit directly to the default branch (not a pull request).",
          ],
        },
        {
          id: "git",
          title: "From a terminal",
          steps: ["Save the file above as .registrai.json in your repo's root, on the default branch, then:"],
          code: `git add .registrai.json\ngit commit -m "Registrai proof"\ngit push`,
        },
      ],
      rules: [
        "The repo must be public: the check reads the file anonymously.",
        "Root of the default branch only; a file in another branch or folder is not found.",
        "GitHub can take a few minutes to serve a new push. Check again if it's not found at first.",
      ],
    };
  }

  const host = sourceLabel(source);
  return {
    kind: "domain",
    target: url,
    recipes: [
      {
        id: "next-vercel",
        title: "Next.js, Vite or another framework (Vercel, Netlify, Cloudflare Pages)",
        steps: [
          "Save the file as public/.well-known/registrai.json in your project.",
          "Deploy. The public folder is served from the site root, so it appears at /.well-known/registrai.json.",
        ],
      },
      {
        id: "static",
        title: "A static site you upload (dist, build or out folder)",
        steps: ["Put it at .well-known/registrai.json inside the folder you publish, next to index.html.", "Upload or deploy that folder."],
      },
      {
        id: "github-pages",
        title: "GitHub Pages",
        steps: [
          "Commit .well-known/registrai.json to the branch or folder Pages publishes.",
          "Also commit an empty file named .nojekyll at its root: without it, Jekyll skips folders starting with a dot.",
        ],
      },
      {
        id: "cpanel",
        title: "WordPress, cPanel or shared hosting",
        steps: [
          "Open the host's File Manager (or connect by FTP/SFTP).",
          "In public_html (the web root), create a folder named .well-known if there isn't one, and upload registrai.json into it.",
        ],
      },
      {
        id: "server",
        title: "Your own server (nginx, Apache, Caddy)",
        steps: [
          "Copy the file to <web root>/.well-known/registrai.json.",
          "Some configs deny every path starting with a dot. Allow this folder, for nginx:",
        ],
        code: "location ^~ /.well-known/ {\n    allow all;\n}",
      },
    ],
    rules: [
      `It must load over https at exactly ${url}.`,
      `At most ${PROOF_MAX_REDIRECTS} redirects, each to another https address; no login, cookie wall or bot challenge in front of it.`,
      `Serve the file as it is (at most ${Math.round(PROOF_MAX_BYTES / 1024)} KB). Try it yourself: curl ${url}`,
      `Optional: the header Access-Control-Allow-Origin: * lets browsers read it directly too. Registrai reads it server-side either way (${host}).`,
    ],
  };
}

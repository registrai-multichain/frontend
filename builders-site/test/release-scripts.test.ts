import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

/**
 * Audit OPS-8: scripts/build-builders-site.sh and scripts/deploy-builders-site.sh refuse a dirty tree, an out/
 * older than the last commit (build) and a dist-builders older than out/ (deploy); the deploy prints its commit.
 * Each case runs the real scripts in a throwaway git repository. The deploy's final `exec npx wrangler …` line is
 * replaced by an echo in that copy, so nothing is ever deployed.
 */
const ROOT = resolve(__dirname, "../..");
const DEPLOY_LINE = "exec npx wrangler pages deploy --branch=main";
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
const touch = (path: string, unixS: number) => utimesSync(path, unixS, unixS);

/** A repo with the two scripts, a builders-site/wrangler.toml, one commit at `commitAt`, and an out/ at `outAt`. */
function repo(commitAt: number, outAt: number) {
  const dir = mkdtempSync(join(tmpdir(), "release-safety-"));
  dirs.push(dir);
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "builders-site"));
  cpSync(join(ROOT, "scripts/build-builders-site.sh"), join(dir, "scripts/build-builders-site.sh"));
  const deploy = readFileSync(join(ROOT, "scripts/deploy-builders-site.sh"), "utf8");
  if (deploy.split(DEPLOY_LINE).length !== 2) throw new Error("the deploy line moved: refusing to run a copy that could reach wrangler");
  writeFileSync(join(dir, "scripts/deploy-builders-site.sh"), deploy.replace(DEPLOY_LINE, `exec echo "WOULD RUN: npx wrangler pages deploy --branch=main"`));
  writeFileSync(join(dir, "builders-site/wrangler.toml"), 'name = "release-safety-test"\nADMIN_ADDRESSES = "0x1"\n');
  writeFileSync(join(dir, ".gitignore"), "/out/\n/dist-builders/\n");
  writeFileSync(join(dir, "tracked.txt"), "v1\n");
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  const date = new Date(commitAt * 1000).toISOString();
  spawnSync("git", ["commit", "-q", "-m", "release test commit"], {
    cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  // the smallest out/ the build script packages: pages, the generic badge art, the social image
  for (const f of ["index.html", "builders/index.html", "builders-index/index.html", "badge/arc/badge-generic.jpg", "badge/arc/badge-generic-lapsed.jpg",
    "badge/arc-testnet/badge-generic.jpg", "badge/arc-testnet/badge-generic-lapsed.jpg", "social/registrai-landing-regi.png"]) {
    mkdirSync(join(dir, "out", f, ".."), { recursive: true });
    writeFileSync(join(dir, "out", f), "x");
    touch(join(dir, "out", f), outAt);
  }
  const run = (script: string) => {
    const r = spawnSync("bash", [join(dir, "scripts", script)], { cwd: dir, encoding: "utf8" });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  return { dir, run, head: () => git(dir, "rev-parse", "HEAD") };
}

const NOW = Math.floor(Date.now() / 1000);

describe("the deploy command itself is unchanged (the owner's allow rule matches it)", () => {
  test("deploy-builders-site.sh still ends in the same wrangler command", () => {
    expect(readFileSync(join(ROOT, "scripts/deploy-builders-site.sh"), "utf8").trimEnd().endsWith(DEPLOY_LINE)).toBe(true);
  });
});

describe("scripts/build-builders-site.sh", () => {
  test("packages a clean tree whose out/ is newer than the last commit", () => {
    const r = repo(NOW - 600, NOW - 60).run("build-builders-site.sh");
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/builders site: \d+ files in dist-builders/);
  });
  test("refuses uncommitted changes to tracked files (untracked files are fine)", () => {
    const t = repo(NOW - 600, NOW - 60);
    writeFileSync(join(t.dir, "untracked.txt"), "new");
    expect(t.run("build-builders-site.sh").code).toBe(0);
    writeFileSync(join(t.dir, "tracked.txt"), "v2\n");
    const r = t.run("build-builders-site.sh");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/refusing: the working tree has uncommitted changes to tracked files/);
    expect(r.err).toContain("tracked.txt");
  });
  test("refuses an out/ older than the last commit: run npm run build first", () => {
    const r = repo(NOW - 60, NOW - 600).run("build-builders-site.sh");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/out\/ is older than the last commit \([0-9a-f]+\): run npm run build first/);
  });
  test("refuses without out/", () => {
    const t = repo(NOW - 600, NOW - 60);
    rmSync(join(t.dir, "out"), { recursive: true });
    expect(t.run("build-builders-site.sh").err).toMatch(/no out\/: run npm run build first/);
  });
});

describe("scripts/deploy-builders-site.sh", () => {
  test("deploys a fresh dist-builders from a clean tree and prints the commit", () => {
    const t = repo(NOW - 600, NOW - 300);
    expect(t.run("build-builders-site.sh").code).toBe(0);
    const r = t.run("deploy-builders-site.sh");
    expect(r.code).toBe(0);
    expect(r.out).toContain(`deploying commit ${t.head()} (`);
    expect(r.out).toContain("release test commit");
    expect(r.out).toContain("WOULD RUN: npx wrangler pages deploy --branch=main");
  });
  test("refuses while the DATA_DB (registrai-data) database id is the placeholder", () => {
    const t = repo(NOW - 600, NOW - 300);
    expect(t.run("build-builders-site.sh").code).toBe(0);
    writeFileSync(join(t.dir, "builders-site/wrangler.toml"), 'name = "release-safety-test"\ndatabase_id = "REPLACE_WITH_DATA_D1_ID"\n');
    const r = t.run("deploy-builders-site.sh");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/the DATA_DB D1 database id is still the placeholder/);
    expect(r.out).not.toContain("WOULD RUN");
  });
  test("refuses a dirty tree", () => {
    const t = repo(NOW - 600, NOW - 300);
    expect(t.run("build-builders-site.sh").code).toBe(0);
    writeFileSync(join(t.dir, "tracked.txt"), "v2\n");
    const r = t.run("deploy-builders-site.sh");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/refusing: the working tree has uncommitted changes/);
    expect(r.out).not.toContain("WOULD RUN");
  });
  test("refuses a dist-builders older than out/ (npm run build ran again, the packaging did not)", () => {
    const t = repo(NOW - 600, NOW - 300);
    expect(t.run("build-builders-site.sh").code).toBe(0);
    touch(join(t.dir, "dist-builders/builders/index.html"), NOW - 200);
    touch(join(t.dir, "out/builders/index.html"), NOW - 100);
    const r = t.run("deploy-builders-site.sh");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/dist-builders is older than out\/: run bash scripts\/build-builders-site.sh first/);
    expect(r.out).not.toContain("WOULD RUN");
  });
  test("refuses a dist-builders older than the last commit", () => {
    const t = repo(NOW - 600, NOW - 900);
    // packaged long ago (out/ and dist-builders both predate the commit)
    mkdirSync(join(t.dir, "dist-builders/builders"), { recursive: true });
    writeFileSync(join(t.dir, "dist-builders/builders/index.html"), "x");
    touch(join(t.dir, "dist-builders/builders/index.html"), NOW - 800);
    const r = t.run("deploy-builders-site.sh");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/dist-builders is older than the last commit/);
    expect(r.out).not.toContain("WOULD RUN");
  });
});

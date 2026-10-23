/**
 * Writes out/_redirects for the PUBLIC registrai.cc (npm run deploy), from
 * src/lib/public-site.ts. The testnet copy (npm run deploy:testnet) and the
 * builders site (its own _redirects) never get it.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicRedirects } from "../src/lib/public-site";

const target = resolve(__dirname, "../out/_redirects");
writeFileSync(target, publicRedirects());
console.log(`wrote ${target}`);

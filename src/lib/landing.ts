// Tabula landing copy (registrai.cc home). Words come from docs/superpowers/specs/2026-10-01-tabula-landing-copy.md
// with the owner's 2026-10-01 decisions applied. Status tags are literal: swap one to "Live" only when that piece ships.
export const CONTACT_EMAIL = "contact@registrai.cc";
export const contactHref = (subject: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;

export const VERIFY_URL = "https://builder.registrai.cc/verify/";
export const HOW_WE_PUBLISH_URL = "https://builder.registrai.cc/how-we-publish/";

export const HERO = {
  eyebrow: "TABULA · BY REGISTRAI",
  headline: "Proof, mapped.",
  subline: "Tabula maps who controls a project, where its money goes and what changed, with evidence for every line, anchored on Arc. Facts, not opinions. You judge.",
  primaryCta: "Verify your project",
  secondaryCta: "How we publish",
  microcopy: "Verification is free. The builder registry is live on Arc mainnet.",
};

export const STRIP = {
  kicker: "HOW IT WORKS",
  items: [
    { name: "Radar", line: "Watches a project's contracts and wallets for owner changes, upgrades and large outflows, and alerts the team.", tag: "Building now" },
    { name: "Trace", line: "Follows funds hop by hop across chains and bridges, with a transaction link for every hop.", tag: "Building now" },
    { name: "Record", line: "Publishes neutral, evidenced facts and anchors each note's hash and time on Arc, so the record can't be quietly rewritten.", tag: "Building now" },
  ],
  note: "Today: the verified builder registry and hand-run investigations. The rest ships piece by piece, and this page will say when.",
};

type TierItem = { text: string; tag?: string };
export type Tier = { name: string; headline?: string; price: string; items: TierItem[]; cta: string; href: string };

export const TIERS: Tier[] = [
  {
    name: "Community",
    price: "Free with verification",
    items: [
      { text: "Radar alerts on your own contracts and wallets", tag: "Building now" },
      { text: "A public facts page for your project", tag: "Building now" },
      { text: "Right of reply: add context next to any fact, and get errors corrected" },
    ],
    cta: "Verify your project",
    href: VERIFY_URL,
  },
  {
    name: "Pro",
    price: "Per job",
    items: [
      { text: "Pre-launch check: who holds each admin power, what your app asks users to sign, and whether the deployed code is the code you shipped" },
      { text: "Due-diligence pack on any project, for launchpads, DEXs, funds and grant programs: a facts file with evidence, plus what was checked and what wasn't" },
      { text: "Incident tracing: where funds went after an exploit or a drain, hop by hop" },
    ],
    cta: "Request a job",
    href: contactHref("Tabula Pro"),
  },
  {
    name: "Institutional",
    headline: "Know who can move the money.",
    price: "Talk to us",
    items: [
      { text: "Control assurance: who can mint, freeze, pause or upgrade, and through which keys (single wallet, multisig or timelock)" },
      { text: "Change alerts when any of those powers or keys change" },
      { text: "Evidence reports anchored on Arc, for your team, partners and reviewers" },
      { text: "Key and front-end review: how admin keys are held, and what your app asks users to sign" },
    ],
    cta: "Talk to us",
    href: contactHref("Tabula Institutional"),
  },
];
export const TIERS_SECTION = { kicker: "PLANS", headline: "Start free. Go deeper when you need to." };

export const HOW_WE_PUBLISH = {
  kicker: "HOW WE PUBLISH",
  headline: "Facts, not opinions.",
  lines: [
    "Every fact links to its evidence: an address, a transaction or a page.",
    "No ratings, no scores, no labels. You judge.",
    "Security issues go to the project privately first.",
    "Every project can reply next to any fact, and we correct errors.",
  ],
  link: "Read how we publish",
};

export const FOOTER_BRAND_LINE = "Tabula by Registrai · the proof layer, anchored on Arc";
export const FOOTER_PAUSE_LINE = "Perennial is paused until the team clears all legal risks.";

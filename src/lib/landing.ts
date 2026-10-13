// registrai.cc home: the data company on Arc. Words come from docs/superpowers/specs/2026-10-13-landing-data-company.md.
// Status tags are literal: swap one to "Live" only when that piece ships. No live numbers here; link to the live pages.
export const CONTACT_EMAIL = "contact@registrai.cc";
export const contactHref = (subject: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;

export const VERIFY_URL = "https://builder.registrai.cc/verify/";
export const HOW_WE_PUBLISH_URL = "https://builder.registrai.cc/how-we-publish/";
export const TRACK_RECORD_URL = "https://builder.registrai.cc/track-record/";
export const INDICES_URL = "https://builder.registrai.cc/builders-index/";

export const SITE_TITLE = "Registrai · Data on Arc";
export const SITE_DESCRIPTION = "Indices, project facts and data on every app built on Arc. Independent; evidence for every number.";

export const HERO = {
  eyebrow: "REGISTRAI · DATA ON ARC",
  headline: "The source of truth for the Arc economy.",
  headlineAccent: "Arc economy.",
  subline: "Hourly indices of what every app on Arc is actually used for, and the facts behind each project, with evidence for every number.",
  primaryCta: "See the indices",
  secondaryCta: "Request data",
  secondaryHref: contactHref("Data request"),
  microcopy: "Independent. Not affiliated with Circle or Arc.",
};

export type Status = "Live" | "Building now" | "Later";
type Line = { name?: string; text: string; tag?: Status };
export type Product = { name: string; tag: Status; line?: string; items?: Line[]; info?: string; link?: { label: string; href: string } };

export const PRODUCTS_SECTION = { kicker: "WHAT WE PUBLISH" };
export const PRODUCTS: Product[] = [
  {
    name: "Indices",
    tag: "Live",
    line: "Three hourly indices, base 1,000 on 2 Oct 2026.",
    items: [
      { name: "Arc Builders Index (ABI)", text: "apps that started on Arc." },
      { name: "Arc Integrations Index (AII)", text: "products that integrated Arc, such as Uniswap, Relay and KyberSwap." },
      { name: "Arc Ecosystem Index (AEI)", text: "both, plus the base layer." },
    ],
    info: "Points come from USDC and other stablecoin payments into each app's contracts: more wallets and more volume move it up; idle apps decay (21-day half-life). Method and history are public.",
    link: { label: "Open the indices", href: INDICES_URL },
  },
  {
    name: "Project facts (Tabula)",
    tag: "Live",
    line: "Who controls a project, where its money goes and what changed, with an address, transaction or page for every line.",
    items: [
      { text: "Facts pages", tag: "Live" },
      { text: "Investigations (hand-run)", tag: "Live" },
      { text: "Radar alerts", tag: "Building now" },
      { text: "Trace (fund tracing)", tag: "Building now" },
      { text: "Record (hashes anchored on Arc)", tag: "Building now" },
    ],
    link: { label: "See the track record", href: TRACK_RECORD_URL },
  },
  {
    name: "Data API",
    tag: "Building now",
    items: [
      { text: "Full Arc history with no pruning or rate-limit walls." },
      { text: "Decoded stablecoin payments: who paid which app." },
      { text: "Address labels: which contract belongs to which project or integration." },
      { text: "Index and per-app activity endpoints." },
      { text: "Payment webhooks." },
    ],
    link: { label: "Join the early access list", href: contactHref("Data API early access") },
  },
  {
    name: "Other chains",
    tag: "Later",
    line: "The same method for other chains, measured against Arc.",
  },
];

export const AUDIENCE_SECTION = { kicker: "FOR" };
export const AUDIENCE = [
  { who: "Funds and market makers", what: "activity that's real versus washed, and who controls what." },
  { who: "Exchange listing teams", what: "due-diligence packs with evidence." },
  { who: "Launchpads and DEXs", what: "checks on the projects you host." },
  { who: "Ecosystem and grant programs", what: "who is building on Arc, and how much it's used." },
  { who: "Builders", what: "a public facts page, and your app on the index." },
];

type TierItem = { text: string; tag?: Status };
export type Tier = { name: string; headline?: string; price: string; items: TierItem[]; cta: string; href: string };

export const TIERS: Tier[] = [
  {
    name: "Community",
    price: "Free",
    items: [
      { text: "Indices and methods" },
      { text: "Public facts pages" },
      { text: "Verification, plus right of reply on any fact" },
    ],
    cta: "Verify your project",
    href: VERIFY_URL,
  },
  {
    name: "Pro",
    price: "Per job / per month",
    items: [
      { text: "Due-diligence packs" },
      { text: "Pre-launch checks" },
      { text: "Incident tracing" },
      { text: "Data API access (early access)" },
    ],
    cta: "Request a job",
    href: contactHref("Registrai Pro"),
  },
  {
    name: "Institutional",
    price: "Talk to us",
    items: [
      { text: "Data partnerships and custom feeds" },
      { text: "Control assurance and change alerts" },
      { text: "Evidence reports anchored on Arc" },
    ],
    cta: "Talk to us",
    href: contactHref("Registrai Institutional"),
  },
];
export const TIERS_SECTION = { kicker: "PLANS", headline: "Start free. Go deeper when you need to." };

export const HOW_WE_PUBLISH = {
  kicker: "HOW WE PUBLISH",
  headline: "Facts, not opinions.",
  lines: [
    "Every fact and every index number links to its evidence.",
    "No ratings, no scores, no labels. You judge.",
    "Methods change only with a published note, and history is restated in the open.",
    "Security issues go to the project privately first.",
  ],
  link: "Read how we publish",
};

export const FOOTER_BRAND_LINE = "Registrai · data on Arc · Warsaw / 2026 · Independent, not affiliated with Circle or Arc";

// Marquee under the hero: apps the indices measure (names only, no logos). Index members as of 2026-10-13.
export const MEASURED = [
  "Uniswap", "Argus", "Relay", "Peach", "OKX DEX", "Tolly", "KyberSwap", "UBI.fun", "0x", "Foci", "LI.FI",
  "ArcTools", "Across", "Arctide", "Aave", "UnitFlow", "Morpho", "Archery", "Curve", "LIFT", "Aerodrome",
  "Synthra", "rhino.fi", "Kairo", "OpenSea", "Flipt.fun", "Bungee", "MetaMask", "1inch", "Rango",
];
export const MEASURED_LABEL = "Measured every hour";

// "How the index works": three steps (explanations in the bubble, not inline).
export const STEPS_SECTION = { kicker: "HOW THE INDEX WORKS", headline: "From the chain to one number, every hour." };
export const STEPS = [
  { n: "01", title: "Payments on Arc", text: "Every USDC and stablecoin payment into an app's contracts, read from the chain." },
  { n: "02", title: "Points per app", text: "More wallets and more volume earn points. Idle apps decay with a 21-day half-life." },
  { n: "03", title: "One index, every hour", text: "Points roll up into three indices, closed on the hour and published with the method." },
];
export const STEPS_INFO = "Per payment: log2(1 + amount) + amount / $100, capped per wallet and hour; new paying wallets earn a bonus; each app's weight is the square root of its points, with rise limits per hour. Full method and history are public.";

export const LIVE_BOARD = {
  title: "Live on Arc",
  block: "Arc block",
  indices: [
    { key: "abi", name: "ABI", label: "Builders" },
    { key: "aii", name: "AII", label: "Integrations" },
    { key: "aei", name: "AEI", label: "Ecosystem" },
  ],
  summaryUrl: "https://builder.registrai.cc/api/index/summary",
  rpcUrl: "https://rpc.mainnet.arc.io",
  fallback: "Live values on the index page",
  base: "Base 1,000 · 2 Oct 2026",
};


# Directory review brief (read-only web research)

Registrai's Arc ecosystem directory lists projects on Arc mainnet (Circle's layer-1, chain ID 5042, mainnet launched 2026-09-16; a private pre-launch window existed). You get a batch of directory entries (JSON). Do NOT edit any file except your one output file. Do not post, submit or sign up for anything.

For EACH entry, research and return one result object. Rules:

1. Launch date (`first_live`): the UTC date the project went live on Arc MAINNET. Acceptable sources, in order of preference:
   - the project's own announcement / blog / docs / X post stating it is live on Arc (mainnet), dated;
   - an official arc.io or circle.com post naming it live at mainnet launch (then the date is that post's date / 2026-09-16 if the post says "at launch");
   - its first mainnet contract on explorer.arc.io: the creation transaction's timestamp (give the address or tx URL). Only if the contract is clearly the project's (it's in the entry's `contracts` or the project's docs list it).
   The source must STATE or SHOW the date. Never infer a date from an article that merely mentions the project, and never use 2026-10-10/2026-10-11 (those are when Registrai's index started seeing apps) unless a source independently shows that date.
   If nothing shows a date: first_live null.
2. Status (only report a change when the evidence is clear): for exchanges and wallets, check https://www.arc.io/blog/arc-economic-os-internet and Circle's mainnet press release https://www.arc.io/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet (also circle.com/pressroom copy). If the post says the entry "is live on Arc" / supports Arc / works "from day one", report status "live" with the exact quote. "Coming soon" stays as is. For other entries, only report a status change if a primary source clearly contradicts the current status.
3. Category (only for entries flagged in your task): read the project's own site and say which ONE of these categories fits best: payments, wallets, exchanges, banks, stablecoin-issuers, infrastructure, developer-tools, dexs, lending, trading, market-makers, custody, rwa, bridges, ai-agents, ramps, consumer, launchpads, validators, asset-managers. Give the sentence from its site that supports it.

Output: a JSON array written to the output path given in your task, one object per entry:
{"slug":"…","first_live":"YYYY-MM-DD"|null,"evidence":{"url":"https://…","title":"short title of the source","date":"YYYY-MM-DD"}|null,"why":"one line: what the source says/shows","status":"live"|null,"status_quote":"…"|null,"status_source":"https://…"|null,"category":"…"|null,"category_why":"…"|null}
`evidence.date` MUST equal `first_live` when first_live is set. Use https URLs only. Keep fetches polite (explorer.arc.io may show a Cloudflare challenge; if blocked, try https://arcscan.app or the Blockscout API, and say so; if all blocked, skip the contract route).
Finish with a short summary: how many dated, how many null, any status/category changes, anything uncertain.

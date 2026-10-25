# Payments review brief (read-only web research)

Registrai's Arc ecosystem directory (builder.registrai.cc/ecosystem/) lists projects on Arc mainnet (Circle's layer-1, chain ID 5042, public mainnet since 2026-09-16). We are rebuilding the page "Apps that accept USDC on Arc": it should lead with payment apps, merchant tools and consumer apps that let people pay or get paid in USDC on Arc MAINNET. Web search may be unavailable: fetch pages directly (WebFetch/curl) from official sites, docs, blogs, X/Twitter mirrors are often blocked. Do NOT edit any file except your output file. Do not post, sign up or submit anything.

For each entry, decide its status on Arc MAINNET, with evidence:
- "live": a source shows the product works on Arc mainnet today: the project's own page/docs/changelog/blog saying Arc mainnet is supported (quote it), an official arc.io / circle.com post saying it is live on Arc, or its contracts on Arc mainnet (explorer.arc.io or the RPC https://rpc.mainnet.arc.io; curl needs a user agent) that are clearly the project's.
- "deployed": contracts on Arc mainnet but no sign it is open for use.
- "announced": only an announcement / partnership / testnet support. Testnet support alone is NOT live.
Also give, when live: the launch date (first_live) ONLY if a source states or shows that date (with `evidence.date` equal to it), else null; never use 2026-10-10/11 unless a source shows it.
Also give one plain-English sentence (≤ 200 chars) saying what the product does for USDC payments on Arc (e.g. "Card and wallet app: pay with USDC on Arc at Visa merchants."), only from sources.
Output: JSON array to your output path, one object per entry:
{"slug":"…","name":"…","status":"live"|"deployed"|"announced","status_quote":"exact supporting text","evidence":{"url":"https://…","title":"short title","date":"YYYY-MM-DD"|null},"first_live":"YYYY-MM-DD"|null,"what":"one sentence","website":"https://…"|null,"notes":"anything uncertain"}
End with a short summary: how many live, which changed status, anything uncertain.

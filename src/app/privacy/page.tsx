import type { Metadata } from "next";
import { builderUrl } from "@/lib/public-site";
import Link from "next/link";
import { BuildersShell } from "@/components/BuildersShell";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy notice · Registrai",
  description: "What personal data builder.registrai.cc processes, why, for how long, and your rights.",
  alternates: { canonical: builderUrl("privacy") },
  // own share tags: the root layout's carry the landing page's line and image (audit L12)
  openGraph: { type: "website", siteName: "Registrai", title: "Privacy notice · Registrai", description: "What personal data builder.registrai.cc processes, why, for how long, and your rights.", url: "https://builder.registrai.cc/privacy/" },
  twitter: { card: "summary", title: "Privacy notice · Registrai", description: "What personal data builder.registrai.cc processes, why, for how long, and your rights." },
};

const H = ({ children }: { children: React.ReactNode }) => <h2 className="pa-h2 mt-8 mb-2">{children}</h2>;

const ROWS: [string, string, string, string][] = [
  ["Points pilot sign-in", "Wallet address, the signed sign-in message, a one-time nonce", "To sign you in (Art. 6(1)(b) GDPR)", "Session 12 h; nonces until used or expired"],
  ["Points pilot account", "Wallet address, points balance, orders, positions and their history, REGI eligibility checks, the REGI lock amount each leveraged position needs", "To run the game you joined (Art. 6(1)(b))", "For the season, then until you ask us to delete it"],
  ["REGI lock", "Your wallet's REGI and locked REGI balances and its withdrawals, read from public Arc data", "To check leverage eligibility and close leveraged positions after a withdrawal (Art. 6(1)(b))", "Read when needed; only the requirement on each position is stored"],
  ["Public leaderboard", "Shortened wallet address (first 6 and last 4 characters) and points", "To show the standings (Art. 6(1)(b))", "While the season's leaderboard is shown"],
  ["Rate limits and abuse prevention", "IP address as a rate-limit key; for project suggestions, a keyed hash of the IP", "Security and preventing abuse (Art. 6(1)(f))", "Rate-limit keys under 1 h; suggestion hashes 90 days"],
  ["Project suggestions", "The suggesting wallet and the suggestion you sign", "To review suggestions (Art. 6(1)(f))", "90 days after the latest suggestion"],
  ["Registration requests", "The builder wallet named in the signed claim", "To register a claim on your behalf (Art. 6(1)(b))", "60 days"],
  ["Staff sign-in", "Wallet address of staff accounts", "To secure the admin area (Art. 6(1)(f))", "Session only"],
  ["Project profiles", "Public facts about projects: contract and deployer addresses, project websites and accounts, with evidence", "Publishing verifiable public information about projects (Art. 6(1)(f))", "While the project is listed; corrections on request"],
];

/** builder.registrai.cc/privacy: privacy notice (GDPR Art. 13), static. */
export default function PrivacyPage() {
  return (
    <BuildersShell>
      <article className="perennial-app-page pa-legal">
        <header className="mb-6">
          <h1 className="pa-h1">Privacy notice</h1>
          <p className="pa-muted">Effective {LEGAL.effective}. Controller: {LEGAL.operator}, <a href={`mailto:${LEGAL.contact}`}>{LEGAL.contact}</a>.</p>
        </header>

        <p>
          This notice covers {LEGAL.site} and its API. We collect as little as the site needs. There are no ads, no analytics
          and no tracking cookies.
        </p>

        <H>What we process, why and for how long</H>
        <div style={{ overflowX: "auto" }}>
          <table className="pa-legal-table">
            <thead><tr><th>Purpose</th><th>Data</th><th>Legal basis</th><th>Kept</th></tr></thead>
            <tbody>{ROWS.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p>
          A wallet address can be personal data when it can be linked to you. Blockchain data is public: we read it from the Arc
          network, and we can&apos;t change or delete what is on chain. Lock, withdraw and claim transactions you send for the
          points pilot are public on Arc, and the site reads your vault&apos;s lock balance and its withdrawals.
        </p>

        <H>Cookies</H>
        <p>
          The site sets only two cookies, both strictly necessary and both only after you sign in: <code>__Host-rb_pilot</code>{" "}
          (points pilot session, 12 hours) and <code>__Host-rb_admin</code> (staff session). They hold a signed session token
          and are deleted when you sign out or they expire. The site may also remember display choices in your browser&apos;s
          local storage; that stays on your device.
        </p>

        <H>Who else processes data</H>
        <ul className="pa-list">
          <li><strong>Cloudflare</strong> hosts the site, its database and storage, and handles every request (including your IP address) as our processor. Cloudflare may process data outside the EEA under the EU–US Data Privacy Framework and standard contractual clauses.</li>
          <li><strong>Hetzner</strong> (Germany) runs the server that computes the indices from public chain data. It processes no visitor data.</li>
          <li><strong>Arc RPC providers.</strong> The index pages and the pilot read the Arc network directly from your browser (rpc.mainnet.arc.io), including your REGI and lock balances. That provider receives your IP address and the requests your browser sends; its own privacy terms apply. Our server also asks it for your wallet&apos;s REGI and lock balances when you sign in and place orders.</li>
          <li><strong>Your wallet software</strong> sees the messages you choose to sign and the transactions you choose to send (lock, withdraw, claim), which it passes to the Arc network.</li>
          <li><strong>Telegram</strong>, only if a project links a chat for Radar alerts: the chat ID and the messages we send there.</li>
        </ul>
        <p>We don&apos;t sell personal data or share it for advertising.</p>

        <H>Your rights</H>
        <p>
          You can ask for access to your data, correction, deletion, restriction of processing, a copy in a portable format,
          and you can object to processing based on legitimate interests. Write to <a href={`mailto:${LEGAL.contact}`}>{LEGAL.contact}</a>{" "}
          from the context you used (for pilot data, we may ask you to sign a message with the wallet to confirm it&apos;s yours).
          You can also complain to the supervisory authority: {LEGAL.authority}.
        </p>

        <H>Age</H>
        <p>The site isn&apos;t meant for anyone under 18, and the points pilot requires you to confirm you are 18 or older.</p>

        <H>Changes</H>
        <p>We&apos;ll update this notice when what we process changes; the date at the top shows the current version. See also the <Link href="/terms/">Terms of use</Link>.</p>
      </article>
    </BuildersShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { BuildersShell } from "@/components/BuildersShell";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of use · Registrai",
  description: "Terms for using builder.registrai.cc: the builder registry, the Arc indices and the points pilot.",
  alternates: { canonical: "/terms" },
  // own share tags: the root layout's carry the landing page's line and image (audit L12)
  openGraph: { type: "website", siteName: "Registrai", title: "Terms of use · Registrai", description: "Terms for using builder.registrai.cc: the builder registry, the Arc indices and the points pilot.", url: "https://builder.registrai.cc/terms/" },
  twitter: { card: "summary", title: "Terms of use · Registrai", description: "Terms for using builder.registrai.cc: the builder registry, the Arc indices and the points pilot." },
};

const H = ({ children }: { children: React.ReactNode }) => <h2 className="pa-h2 mt-8 mb-2">{children}</h2>;

/** builder.registrai.cc/terms: terms of use, static. */
export default function TermsPage() {
  return (
    <BuildersShell>
      <article className="perennial-app-page pa-legal">
        <header className="mb-6">
          <h1 className="pa-h1">Terms of use</h1>
          <p className="pa-muted">Effective {LEGAL.effective}. Operator: {LEGAL.operator}, <a href={`mailto:${LEGAL.contact}`}>{LEGAL.contact}</a>.</p>
        </header>

        <p>
          These terms apply to {LEGAL.site} and its API (the &quot;site&quot;). By using the site you accept them. If you
          don&apos;t, please don&apos;t use it. Our <Link href="/privacy/">Privacy notice</Link> explains what personal data
          we process, and the <Link href="/pilot-rules/">Pilot rules</Link> are part of these terms for the points pilot.
        </p>

        <H>1. What the site is</H>
        <ul className="pa-list">
          <li><strong>Builder registry and project data.</strong> Profiles of projects on Arc, built from public on-chain data and public sources, each fact with its evidence. See <Link href="/how-we-publish/">How we publish</Link>.</li>
          <li><strong>Arc indices.</strong> ABI (Arc Builders Index), AII (Arc Integrations Index) and AEI (Arc Ecosystem Index): hourly figures computed from public Arc data by the published method.</li>
          <li><strong>Points pilot.</strong> A game in which signed-in wallets take long or short positions on ABI, AII and AEI with play points. It is closed until we announce it open.</li>
        </ul>
        <p>
          The site asks you to send a transaction only to lock, withdraw or claim REGI in your own vault contract for the
          points pilot (locking first approves that contract to move the REGI you lock). Orders are never transactions, and
          the site never asks you to deposit funds. Signing in is a free message signature.
        </p>

        <H>2. Who may use it</H>
        <p>
          You must be at least 18 years old and able to agree to these terms. Signing in to the points pilot confirms both.
          Don&apos;t use the site where doing so would be against the law that applies to you.
        </p>

        <H>3. Data, indices and attributions</H>
        <ul className="pa-list">
          <li>Data is provided as is, for information. It can be incomplete, delayed or wrong, and we may correct, recompute or restate it, including past index values, when the method or the inputs change.</li>
          <li>Company and wallet attributions come from public sources. Where one rests on a third-party label (for example an explorer name tag), the site says so. Projects can ask us to correct a fact at {LEGAL.contact}.</li>
          <li>Nothing on the site is investment, legal or tax advice, an offer, or a recommendation to buy, sell or hold any asset.</li>
          <li>The indices are not provided for use as a benchmark in financial instruments, financial contracts or investment funds. Don&apos;t use them that way.</li>
          <li>Project names, logos and trademarks belong to their owners. {LEGAL.independence}</li>
        </ul>

        <H>4. The points pilot</H>
        <ul className="pa-list">
          <li><strong>Points only.</strong> Points have no value. They can&apos;t be bought, sold, transferred, exchanged or withdrawn, and they give no right to any payment, token, prize or other benefit. There are no prizes.</li>
          <li><strong>Locked REGI.</strong> REGI you lock stays in your own vault contract on Arc, which only your wallet can move it out of. You can withdraw it at any time, and the pilot never takes or spends it. The pilot only reads how much is locked. Locked REGI keeps its REGI holder distributions, which you claim from the vault yourself.</li>
          <li><strong>Markets.</strong> The pilot trades ABI, AII and AEI. One points balance per wallet covers all three. You hold one direction at a time in each market. The economy (house, fee pool, insurance and weekly split) is kept per market.</li>
          <li><strong>Accounting shown in points.</strong> The economy figures (house, fee pool, insurance, weekly split, including the treasury share and its buyback line) are bookkeeping in points inside the game. They are not payments and not a commitment to buy REGI or anything else.</li>
          <li><strong>Eligibility.</strong> You must hold at least $10 of REGI in the wallet when you sign in and when you place each order; closing a position needs none. Leverage above 1× needs at least $50 of REGI locked in your own vault. Dollar amounts use the median price of the REGI/USDC pool over the last 24 hours. Each leveraged position keeps the lock amount needed when it opened; a withdrawal that leaves less than that closes the position at the next price, with the normal close fee, funding and borrow. The leaderboard lists only wallets that currently hold the amount needed to join. Holding or locking REGI is only an eligibility check; it gives no rights in the pilot. We don&apos;t sell REGI.</li>
          <li><strong>One person, one wallet.</strong> Running several wallets to improve leaderboard places is not allowed.</li>
          <li><strong>Fair play.</strong> Don&apos;t try to move the index to profit in the pilot (for example with self-made or wash payments into tracked contracts), exploit bugs, automate abusive traffic, or interfere with the site. We may reset, adjust or remove points, positions or accounts that result from such conduct or from errors.</li>
          <li><strong>Changes.</strong> We may change the rules and parameters, pause trading, start a new season, reset balances, or end the pilot at any time. The current rules are on the <Link href="/pilot-rules/">Pilot rules</Link> page.</li>
          <li><strong>Public leaderboard.</strong> The leaderboard shows a shortened wallet address and its points.</li>
        </ul>

        <H>5. Your wallet and signatures</H>
        <p>
          You are responsible for your wallet and the messages and transactions you sign. We never ask for a private key or
          seed phrase. Check that a sign-in message names this site before you sign it, and check what your wallet shows before
          you confirm a lock, withdrawal or claim. Transactions on Arc are public and can&apos;t be reversed.
        </p>

        <H>6. Acceptable use of the site and API</H>
        <p>
          Use the site and the public API in a way that doesn&apos;t harm it or other users: no attempts to break security,
          no traffic meant to overload it, and no circumventing rate limits. We may block requests that do.
        </p>

        <H>7. Availability and third parties</H>
        <p>
          We provide the site without any guarantee that it is available, uninterrupted or error-free. It relies on third
          parties we don&apos;t control, including the Arc network and its RPC providers, your wallet software and our
          hosting providers.
        </p>

        <H>8. Liability</H>
        <p>
          To the extent the law allows, {LEGAL.operator} is not liable for losses arising from the use of the site, its data
          or the points pilot, including decisions you make based on them. Nothing in these terms limits liability that can&apos;t
          be limited by law, or rights you have as a consumer that can&apos;t be waived.
        </p>

        <H>9. Changes to these terms</H>
        <p>We may update these terms. The date at the top shows the current version; continuing to use the site after a change means you accept it.</p>

        <H>10. Law and contact</H>
        <p>
          Polish law governs these terms, without depriving consumers of the protection of the mandatory law of their country of
          residence. Questions, corrections and complaints: <a href={`mailto:${LEGAL.contact}`}>{LEGAL.contact}</a>.
        </p>
      </article>
    </BuildersShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { BuildersShell } from "@/components/BuildersShell";
import { OpenFromHash } from "@/components/builders/OpenFromHash";
import { BUILDERS, buildersStatusLine } from "@/lib/builders-network";
import { MAX_PROJECTS_PER_BUILDER } from "@/lib/verified-builders";
import { WONDER_ON_BUILDERS } from "@/lib/wonder";

export const metadata: Metadata = {
  title: "Builder guide · Registrai",
  description:
    "How Registrai verification works, and what to do when you move to a new wallet, lose one, change deployers or move a project.",
  alternates: { canonical: "/guide" },
};

const LABEL = BUILDERS.label;
const CONTACT = "contact@registrai.cc";

/** Every section, in order: its #anchor and title (the table of contents and the <details> ids).
 *  "Wonder markets" only on a network with wonder markets (a WonderEscrow). */
const SECTIONS = [
  ["how-it-works", "How verification works"],
  ...(WONDER_ON_BUILDERS ? ([["wonder", "Wonder markets on your project"]] as const) : []),
  ["publish-proof", "Publishing your proof"],
  ["new-wallet", "Moving to a new wallet"],
  ["lost-wallet", "Lost your wallet (or it was compromised)"],
  ["deployers", "Changing deployers"],
  ["moved-project", "Moved your repo or domain"],
  ["remove-project", "Removing a project, or leaving"],
] as const;

/**
 * The builder guide on builder.registrai.cc: the claim flow and the changes a
 * builder may need later. Written for builders (the Safe's side of each step
 * lives in /admin). Each section is a <details> with a stable #anchor.
 */
export default function GuidePage() {
  return (
    <BuildersShell wallet>
      <OpenFromHash />
      <article className="perennial-app-page">
        <header className="perennial-app-header">
          <div>
            <div className="perennial-app-status">
              <i /> {buildersStatusLine(BUILDERS)}
            </div>
            <h1>Builder guide</h1>
            <p>How verification works, and what to do when something changes. Questions: {CONTACT}.</p>
            <div className="vf-invite mt-3">
              <Link href="/verify">Claim your project →</Link>
            </div>
          </div>
        </header>

        <nav className="gd-toc" aria-label="Sections">
          {SECTIONS.map(([id, title]) => (
            <a key={id} href={`#${id}`}>
              {title}
            </a>
          ))}
        </nav>

        <div className="gd-sections">
          <details className="vf-faq gd-section" id="how-it-works" open>
            <summary>How verification works</summary>
            <ol>
              <li>
                <b>Claim.</b> On <Link href="/verify">/verify</Link>, connect the wallet that will own your builder, enter your
                GitHub repo or domain, and sign a plain-text claim. Signing is free and sends nothing.
              </li>
              <li>
                <b>Publish the proof.</b> Put the signed file in your repo or on your domain (see below). Only you can publish
                there, so it proves the project is yours.
              </li>
              <li>
                <b>Register.</b> One small transaction on {LABEL} from your wallet, or choose &ldquo;we register it for
                you&rdquo; and the Registrai Safe does it for free.
              </li>
              <li>
                <b>Nominated.</b> Your card appears in the gallery as Nominated. Nothing else is needed from you: Registrai
                reviews the claim and onboards your builder in its next batch.
              </li>
              <li>
                <b>Verified.</b> Onboarding issues your Verified Builder Badge: a soulbound NFT in your wallet, numbered in the
                order builders are verified. Your card turns Verified.
              </li>
            </ol>
            <p>
              Every proof is re-checked when the gallery loads, and by Registrai&apos;s keeper every 10 minutes. Keep the file
              published: if it disappears, the project shows as Lapsed until it is back.
            </p>
          </details>

          {WONDER_ON_BUILDERS && (
            <details className="vf-faq gd-section" id="wonder">
              <summary>Wonder markets on your project</summary>
              <p>
                Registrai may nominate a project it has invited, before the team joins. People can then trade markets about
                it: these are <b>wonder markets</b>, labelled &ldquo;Unclaimed: this team hasn&apos;t joined Registrai and
                hasn&apos;t endorsed this market.&rdquo;
              </p>
              <ol>
                <li>Half of every trading fee on a wonder market that uses the project&apos;s milestone feed is held for the team.</li>
                <li>
                  Claim the project on <Link href="/verify">/verify</Link>. Once Registrai onboards you and your proof has held
                  for three checks, the keeper queues the release; it arrives 7 days later as your builder income (the Safe can
                  cancel a release to the wrong claimant within those 7 days).
                </li>
                <li>Nobody claims it within about 180 days: the escrow goes to the season pool, never to Registrai.</li>
              </ol>
              <p>
                Don&apos;t want your project listed? Email {CONTACT}: it is un-nominated (no new wonder markets; existing ones
                run to settlement and their escrow goes to the season pool).
              </p>
            </details>
          )}

          <details className="vf-faq gd-section" id="publish-proof">
            <summary>Publishing your proof</summary>
            <p>
              <b>GitHub repo:</b> the file is <code>.registrai.json</code> (with the leading dot) in the root of the repo, on
              its default branch. The repo must be public. In the browser: Add file → Create new file → paste → commit to the
              default branch.
            </p>
            <p>
              <b>Domain</b> (your code can stay private): the file is served at{" "}
              <code>https://yourdomain/.well-known/registrai.json</code> over https. With Next.js, Vite, Vercel, Netlify or
              Cloudflare Pages, put it in <code>public/.well-known/</code>. On GitHub Pages also add an empty{" "}
              <code>.nojekyll</code> file. On WordPress or cPanel, upload it into <code>public_html/.well-known/</code>.
            </p>
            <p>Step 4 of /verify shows the exact address for your project, with a recipe per host and a live check.</p>
          </details>

          <details className="vf-faq gd-section" id="new-wallet">
            <summary>Moving to a new wallet</summary>
            <p>For when you still control the old wallet.</p>
            <ol>
              <li>
                Connect the <b>old</b> wallet on <Link href="/verify">/verify</Link> and open <b>Move to a new wallet</b>. Enter
                the new address and send one transaction. The new wallet must not already hold a builder.
              </li>
              <li>
                Connect the <b>new</b> wallet on /verify and click <b>accept ownership</b>.
              </li>
              <li>
                Every project&apos;s proof still names the old wallet: re-sign each one with the new wallet on /verify and replace
                the published file. No transaction is needed for that. Until you do, your projects show as Lapsed.
              </li>
              <li>
                Your badge follows by itself: within about 10 minutes it moves to the new wallet, keeping its number. Future
                builder income goes to the new wallet.
              </li>
            </ol>
          </details>

          <details className="vf-faq gd-section" id="lost-wallet">
            <summary>Lost your wallet (or it was compromised)</summary>
            <ol>
              <li>
                Email <b>{CONTACT}</b> with your builder number (on your gallery card) and your new wallet address. We may ask
                you to prove the project is yours, e.g. by a commit to your repo or a file on your domain.
              </li>
              <li>The Registrai Safe starts a recovery of your builder to the new wallet.</li>
              <li>
                A <b>7-day waiting period</b> follows, during which the current owner wallet can cancel. It protects every
                builder from a wrong or malicious recovery.
              </li>
              <li>
                After 7 days, connect the new wallet on /verify and click <b>finish recovery</b>. Then re-sign your projects&apos;
                proofs with it, as above. The badge moves to the new wallet by itself.
              </li>
            </ol>
            <p>
              If someone else holds your old key and keeps cancelling, tell us: the Safe can deactivate the builder and revoke
              its badge, so a stolen wallet cannot keep showing as verified.
            </p>
          </details>

          <details className="vf-faq gd-section" id="deployers">
            <summary>Changing deployers</summary>
            <p>
              Deployers (for domain projects) are the wallets that deploy your contracts. They are part of your signed proof
              file, not stored on-chain. To change them, make the claim again on /verify for the same domain with the new list,
              have each deployer sign, and replace <code>/.well-known/registrai.json</code>. The project is already registered,
              so there is nothing to send and no gas. Deployers only matter for milestone tracking once markets open on{" "}
              {LABEL}; they do not change your verified status.
            </p>
          </details>

          <details className="vf-faq gd-section" id="moved-project">
            <summary>Moved your repo or domain</summary>
            <p>
              A new repo or domain is a new project: add it on /verify (connected with your builder wallet) and publish its
              proof there. Then remove the old project from your builder panel on /verify. A builder holds up to{" "}
              {MAX_PROJECTS_PER_BUILDER} projects, and removed projects still count toward that limit.
            </p>
          </details>

          <details className="vf-faq gd-section" id="remove-project">
            <summary>Removing a project, or leaving</summary>
            <p>
              Remove a project from your builder panel on /verify (one transaction), or simply delete its proof file: the
              project then shows as Lapsed. With no verified project left, your builder shows as Lapsed and so does your badge.
              A badge&apos;s number is never given to anyone else; if you publish a valid proof again, you are verified again.
            </p>
          </details>
        </div>

        <p className="gd-foot">
          Still stuck? Email {CONTACT} with your builder number. We never ask for your seed phrase or private key.
        </p>
      </article>
    </BuildersShell>
  );
}

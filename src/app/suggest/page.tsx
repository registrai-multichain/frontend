import type { Metadata } from "next";
import Link from "next/link";
import { BuildersShell } from "@/components/BuildersShell";
import { SuggestForm } from "@/components/builders/SuggestForm";
import { WONDER_ON_BUILDERS } from "@/lib/wonder";

export const metadata: Metadata = {
  title: "Suggest a project · Registrai",
  description: "Know a team building on Arc? Suggest it for the Registrai builders gallery: its website and its X account are all we need.",
  alternates: { canonical: "/suggest" },
};

/** builder.registrai.cc/suggest: the public way into the invite list (src/lib/suggestions.ts). */
export default function SuggestPage() {
  return (
    <BuildersShell>
      <article className="perennial-app-page">
        <header className="mb-6">
          <h1 className="pa-h1">Suggest a project</h1>
          <p className="pa-lede">
            Know a team building on Arc? Tell us about it. We need its website and some social proof: its X account, or another
            public link.
          </p>
        </header>

        <div className="vf-layout">
          <div className="vf-main">
            <SuggestForm />
          </div>

          <aside className="vf-aside" aria-label="Questions">
            <div className="pp-card-label">Questions</div>
            <details className="vf-faq" open>
              <summary>What happens next?</summary>
              <p>
                We review every suggestion. When we invite a project it shows on the{" "}
                <Link href="/builders/">gallery</Link> as <b>Invited</b>, and the team gets a link to claim it.
              </p>
            </details>
            <details className="vf-faq">
              <summary>Can a team be listed without joining?</summary>
              <p>
                Yes. An invited project can be nominated for markets on its GitHub releases whether or not the team replies
                {WONDER_ON_BUILDERS ? "" : " (once markets are live)"}. Half of each trading fee on those markets is held for the
                team, and paid out when they claim the project. Every such market says the team hasn&apos;t endorsed it. A team can
                ask to be removed at contact@registrai.cc.
              </p>
            </details>
            <details className="vf-faq">
              <summary>Why the X account?</summary>
              <p>
                It&apos;s how we check the project is real and who runs it, and how we reach the team. No X account? Give another public
                link: Farcaster, Telegram or Discord.
              </p>
            </details>
            <details className="vf-faq">
              <summary>It&apos;s my own project.</summary>
              <p>
                Skip the queue: <Link href="/verify/">verify it yourself</Link>.
              </p>
            </details>
          </aside>
        </div>
      </article>
    </BuildersShell>
  );
}

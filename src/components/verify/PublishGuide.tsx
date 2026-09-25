"use client";

import { useState } from "react";
import { publishGuide } from "@/lib/publish-guide";

/** Step 4's "How to publish it": the recipes for this source's kind, each folded. */
export function PublishGuide({ source }: { source: string }) {
  const g = publishGuide(source);
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <details className="vf-details vf-guide">
      <summary>How to publish it{g.kind === "domain" ? " on your site" : " in your repo"}</summary>
      <p className="vf-note">
        The file goes to <b>{g.target}</b>. Pick how your {g.kind === "domain" ? "site is hosted" : "repo is edited"}:
      </p>
      {g.recipes.map((r) => (
        <details key={r.id} className="vf-faq vf-guide-recipe">
          <summary>{r.title}</summary>
          <ol>
            {r.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {r.code && (
            <div className="vf-guide-code">
              <pre className="vf-pre">{r.code}</pre>
              <button
                type="button"
                className="vf-mini"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(r.code!);
                    setCopied(r.id);
                    setTimeout(() => setCopied(null), 1500);
                  } catch {
                    // clipboard blocked: the text is selectable
                  }
                }}
              >
                {copied === r.id ? "copied" : "copy"}
              </button>
            </div>
          )}
        </details>
      ))}
      <ul className="vf-guide-rules">
        {g.rules.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </details>
  );
}

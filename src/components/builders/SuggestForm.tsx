"use client";

import { useState, type FormEvent } from "react";
import { SUGGEST_LIMITS, validateSuggestion, type SuggestionField } from "@/lib/suggestions";
import { sourceLabel } from "@/lib/verified-builders";

type State =
  | { kind: "idle" | "sending" }
  | { kind: "done"; source: string; count?: number; invited?: boolean }
  | { kind: "error"; message: string; field?: SuggestionField }
  | { kind: "unavailable" };

const EMPTY = { name: "", website: "", github: "", x: "", social: "", why: "", by: "" };

/**
 * builder.registrai.cc/suggest: anyone points us at a project (POST /api/suggestions).
 * It lands in /admin; nothing is published or put on chain from here.
 */
export function SuggestForm() {
  const [f, setF] = useState(EMPTY);
  const [state, setState] = useState<State>({ kind: "idle" });
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const errFor = (k: SuggestionField) => (state.kind === "error" && state.field === k ? state.message : "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local = validateSuggestion(f);
    if (!local.ok) return setState({ kind: "error", message: local.error, field: local.field });
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(f),
      });
      if (!(res.headers.get("content-type") ?? "").includes("application/json")) return setState({ kind: "unavailable" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; source?: string; count?: number; invited?: boolean; error?: string; field?: SuggestionField };
      if (res.ok && body.ok && body.source) return setState({ kind: "done", source: body.source, count: body.count, invited: body.invited });
      setState({ kind: "error", message: body.error ?? `could not send it (${res.status})`, field: body.field });
    } catch {
      setState({ kind: "unavailable" });
    }
  }

  if (state.kind === "done") {
    return (
      <div className="vf-ok">
        {state.invited ? (
          <p>{sourceLabel(state.source)} is already invited. Thanks!</p>
        ) : (
          <p>
            Thanks! {sourceLabel(state.source)} is on our list
            {state.count && state.count > 1 ? ` (suggested by ${state.count} people so far)` : ""}. We review every suggestion; when we
            invite a project it shows on the gallery as <b>Invited</b>.
          </p>
        )}
        <p>
          <button type="button" className="vf-secondary" onClick={() => { setF(EMPTY); setState({ kind: "idle" }); }}>
            Suggest another
          </button>
        </p>
      </div>
    );
  }
  if (state.kind === "unavailable") {
    return (
      <p className="vf-note">
        Suggestions aren&apos;t taken on this site. Suggest it on{" "}
        <a href="https://builder.registrai.cc/suggest/">builder.registrai.cc/suggest</a> or email contact@registrai.cc.
      </p>
    );
  }

  const field = (k: SuggestionField, label: string, o: { placeholder: string; required?: boolean; optional?: boolean; hint?: string }) => (
    <label className="vf-field">
      <span>
        {label}
        {o.optional ? " (optional)" : ""}
      </span>
      <input
        value={f[k]}
        onChange={set(k)}
        placeholder={o.placeholder}
        maxLength={SUGGEST_LIMITS[k]}
        required={o.required}
        spellCheck={false}
        autoCapitalize="off"
        aria-invalid={Boolean(errFor(k))}
      />
      <em>{errFor(k) || o.hint || ""}</em>
    </label>
  );

  return (
    <form className="adm-form" onSubmit={submit} noValidate>
      {field("name", "Project name", { placeholder: "Acme", required: true })}
      {field("website", "Website", { placeholder: "https://acme.xyz", required: true })}
      {field("x", "Project's X account", { placeholder: "@acme or x.com/acme", hint: "Social proof: this, or the link below." })}
      {field("social", "…or another public link", { placeholder: "https://warpcast.com/acme · t.me/… · discord.gg/…", hint: "When the project has no X account." })}
      {field("github", "GitHub repo", { placeholder: "github.com/acme/app", optional: true, hint: "Markets on a project count its GitHub releases." })}
      <label className="vf-field">
        <span>Why it belongs (optional)</span>
        <textarea value={f.why} onChange={set("why")} maxLength={SUGGEST_LIMITS.why} rows={3} placeholder="What are they building on Arc?" />
        <em>{errFor("why") || (f.why.length ? `${f.why.length}/${SUGGEST_LIMITS.why}` : "")}</em>
      </label>
      {field("by", "Your X handle", { placeholder: "@you", optional: true, hint: "So we can thank you." })}
      <div>
        <button type="submit" className="vf-primary" disabled={state.kind === "sending"}>
          {state.kind === "sending" ? "sending…" : "Suggest this project"}
        </button>
      </div>
      {state.kind === "error" && !state.field && <p className="vf-error">{state.message}</p>}
    </form>
  );
}

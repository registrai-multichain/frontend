"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { PROPOSAL_ASSETS, type ProposalAsset, type ProposalKind, type ProposalStatus } from "@/lib/market-proposals";
import { EMPTY_FORM, PRICE_SOURCE, parseUtcDeadline, prepareSubmission, priceQuestion, statusHref, type ProposeFormState } from "@/lib/propose-form";
import { PROPOSALS_API } from "@/lib/proposals-api";
import { newsreader } from "./fonts";
import { HowItWorks } from "./HowItWorks";
import s from "./proposals.module.css";

export { PROPOSALS_API };

const KINDS: Array<{ kind: ProposalKind; title: string; desc: string; phase2?: boolean }> = [
  { kind: "event", title: "Yes / no event", desc: "“Will X happen by a date?” Resolved by the team with evidence." },
  { kind: "price", title: "Price at a deadline", desc: "“Will BTC be at least $X on a date?” Settled from exchange prices." },
  { kind: "builder", title: "Builder market", desc: "A milestone of a verified builder. Collected now, opened when Perennial markets launch.", phase2: true },
  { kind: "wonder", title: "Wonder market", desc: "A metric of any open-source project or site. Collected now, opened with phase 2.", phase2: true },
];

type FieldName = keyof ProposeFormState | "kind";
type Problem = { error: string; field?: string };
/** Fields each kind renders; an error on any other field is shown above the button. */
const FIELDS: Record<"price" | "other", readonly string[]> = {
  price: ["kind", "asset", "comparator", "price", "deadline", "question", "why", "creatorPayee", "contact"],
  other: ["kind", "question", "rule", "source", "deadline", "why", "creatorPayee", "contact"],
};
const fieldId = (f: string) => `pf-${f}`;
/** State keys whose validation field has another name. */
const FIELD_OF: Partial<Record<keyof ProposeFormState, string>> = { deadlineText: "deadline", priceQuestionEdit: "question" };

export function ProposeForm() {
  const [form, setForm] = useState<ProposeFormState>(EMPTY_FORM);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; status: ProposalStatus } | null>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (done) doneHeading.current?.focus();
  }, [done]);

  const isPrice = form.kind === "price";
  const shown = FIELDS[isPrice ? "price" : "other"];
  const errorFor = (f: string) => (problem?.field === f ? problem.error : null);
  const generalError = problem && (!problem.field || !shown.includes(problem.field)) ? problem.error : null;

  const set = <K extends keyof ProposeFormState>(key: K, value: ProposeFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    const field = FIELD_OF[key] ?? key;
    // another market type shows other fields: its errors start fresh
    if (key === "kind" || problem?.field === field || (key === "asset" && problem?.field === "price")) setProblem(null);
  };
  const onText = (key: "question" | "rule" | "source" | "deadlineText" | "why" | "creatorPayee" | "contact" | "price" | "website2") =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, e.target.value);

  const autoQuestion = priceQuestion({ asset: form.asset, comparator: form.comparator, price: form.price, deadline: parseUtcDeadline(form.deadlineText) });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const prepared = prepareSubmission(form, Math.floor(Date.now() / 1000));
    if (!prepared.ok) {
      setProblem({ error: prepared.error, field: prepared.field });
      if (prepared.field && shown.includes(prepared.field)) {
        document.getElementById(prepared.field === "kind" ? fieldId(`kind-${form.kind}`) : fieldId(prepared.field))?.focus();
      }
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(PROPOSALS_API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(prepared.body) });
      const j = (await res.json().catch(() => ({}))) as { id?: unknown; status?: unknown; error?: unknown; field?: unknown };
      if (res.status === 201 && typeof j.id === "string") {
        setDone({ id: j.id, status: (typeof j.status === "string" ? j.status : "pending") as ProposalStatus });
      } else {
        setProblem({
          error: typeof j.error === "string" ? j.error : `The proposals service answered ${res.status}. Try again in a minute.`,
          field: typeof j.field === "string" ? j.field : undefined,
        });
      }
    } catch {
      setProblem({ error: "Could not reach the proposals service. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  const again = () => {
    setForm(EMPTY_FORM);
    setDone(null);
    setProblem(null);
  };

  return (
    <div className={`${s.root} ${newsreader.variable}`}>
      <div className={s.layout}>
        <div className={s.main}>
          <div>
            <h1 className={s.h1}>Propose a market</h1>
            <p className={s.lede}>
              Suggest a question people can bet on. The team reviews every proposal; approved markets are opened on Arc mainnet with a 5 USDC starting pool.
            </p>
          </div>

          {done ? (
            <section className={`${s.panel} ${s.done}`} aria-live="polite">
              <h2 ref={doneHeading} tabIndex={-1} className={s.h2}>Proposal sent.</h2>
              <p className={s.doneText}>
                Track it here:{" "}
                <Link className={s.link} href={statusHref(done.id)}>
                  {window.location.host}
                  {statusHref(done.id)}
                </Link>
              </p>
              <p className={s.doneText}>
                {done.status === "queued"
                  ? "It waits in the phase 2 queue and opens when Perennial markets launch. We may tighten the wording or deadline; the status page shows the final version."
                  : "The team reviews it; we may tighten the wording or deadline, and the status page shows the final version. Approved markets open on Arc mainnet within minutes."}
              </p>
              <div>
                <button type="button" className={s.buttonQuiet} onClick={again}>Propose another market</button>
              </div>
            </section>
          ) : (
            <form className={s.main} onSubmit={submit} noValidate>
              <fieldset className={`${s.fieldset} ${s.fieldsetTight}`} aria-describedby={errorFor("kind") ? fieldId("kind-error") : undefined}>
                <legend className={s.legend}>1 · Market type</legend>
                <div className={s.cards}>
                  {KINDS.map((k) => (
                    <label key={k.kind} className={s.card} data-selected={form.kind === k.kind}>
                      <span className={s.cardTitle}>
                        <input
                          id={fieldId(`kind-${k.kind}`)}
                          type="radio"
                          name="kind"
                          value={k.kind}
                          checked={form.kind === k.kind}
                          onChange={() => set("kind", k.kind)}
                        />
                        {k.title}
                        {k.phase2 && <span className={s.pill}>phase 2</span>}
                      </span>
                      <span className={s.cardDesc}>{k.desc}</span>
                    </label>
                  ))}
                </div>
                {(form.kind === "builder" || form.kind === "wonder") && <p className={s.phaseNote}>Opened when Perennial markets launch.</p>}
                <FieldError id="kind" message={errorFor("kind")} />
              </fieldset>

              <fieldset className={s.fieldset}>
                <legend className={s.legend}>2 · The question</legend>
                {isPrice ? (
                  <>
                    <div className={s.three}>
                      <div className={s.fieldBox}>
                        <label className={s.field}>
                          Asset
                          <select
                            id={fieldId("asset")}
                            className={s.select}
                            value={form.asset}
                            onChange={(e) => set("asset", e.target.value as ProposalAsset)}
                            aria-invalid={Boolean(errorFor("asset"))}
                            aria-describedby={errorFor("asset") ? fieldId("asset-error") : undefined}
                          >
                            {(Object.keys(PROPOSAL_ASSETS) as ProposalAsset[]).map((a) => (
                              <option key={a} value={a}>{PROPOSAL_ASSETS[a].symbol}</option>
                            ))}
                          </select>
                        </label>
                        <FieldError id="asset" message={errorFor("asset")} />
                      </div>
                      <div className={s.fieldBox}>
                        <label className={s.field}>
                          Resolves Yes if the price is
                          <select
                            id={fieldId("comparator")}
                            className={s.select}
                            value={form.comparator}
                            onChange={(e) => set("comparator", Number(e.target.value) === 3 ? 3 : 1)}
                            aria-invalid={Boolean(errorFor("comparator"))}
                            aria-describedby={errorFor("comparator") ? fieldId("comparator-error") : undefined}
                          >
                            <option value={1}>at least</option>
                            <option value={3}>at most</option>
                          </select>
                        </label>
                        <FieldError id="comparator" message={errorFor("comparator")} />
                      </div>
                      <TextField name="price" label="Price (USD)" value={form.price} onChange={onText("price")} error={errorFor("price")} placeholder="100000" inputMode="decimal" />
                    </div>
                    <div className={s.two}>
                      <div className={s.field}>
                        <span>Where the answer comes from</span>
                        <div className={s.fixed}>{PRICE_SOURCE}</div>
                      </div>
                      <TextField name="deadlineText" errorKey="deadline" label="Deadline (UTC)" value={form.deadlineText} onChange={onText("deadlineText")} error={errorFor("deadline")} placeholder="2026-12-31 23:00" />
                    </div>
                    <TextField
                      name="question"
                      large
                      label={<>Question <span className={s.opt}>(filled in from the above; edit it if you like)</span></>}
                      value={form.priceQuestionEdit ?? autoQuestion}
                      onChange={(e) => set("priceQuestionEdit", e.target.value)}
                      error={errorFor("question")}
                      placeholder="Will BTC be at least $100,000 on Dec 31, 2026 at 23:00 UTC?"
                    />
                    {form.priceQuestionEdit !== null && (
                      <button type="button" className={s.reset} onClick={() => set("priceQuestionEdit", null)}>Use the generated wording</button>
                    )}
                  </>
                ) : (
                  <>
                    <TextField
                      name="question"
                      large
                      label="Question"
                      value={form.question}
                      onChange={onText("question")}
                      error={errorFor("question")}
                      placeholder="Will Circle announce native USDC on a new chain before Dec 31, 2026?"
                    />
                    <TextArea
                      name="rule"
                      label="Resolves Yes if…"
                      rows={3}
                      value={form.rule}
                      onChange={onText("rule")}
                      error={errorFor("rule")}
                      placeholder="Circle publishes an official announcement that native USDC is live on a chain it did not support on Oct 1, 2026."
                    />
                    <div className={s.two}>
                      <TextField name="source" label="Where the answer comes from" type="url" value={form.source} onChange={onText("source")} error={errorFor("source")} placeholder="https://www.circle.com/blog" />
                      <TextField name="deadlineText" errorKey="deadline" label="Deadline (UTC)" value={form.deadlineText} onChange={onText("deadlineText")} error={errorFor("deadline")} placeholder="2026-12-31 23:00" />
                    </div>
                  </>
                )}
                <TextArea
                  name="why"
                  label={<>Why is this a good market? <span className={s.opt}>(optional)</span></>}
                  rows={2}
                  value={form.why}
                  onChange={onText("why")}
                  error={errorFor("why")}
                />
              </fieldset>

              <fieldset className={s.fieldset}>
                <legend className={s.legend}>3 · Your creator share</legend>
                <TextField
                  name="creatorPayee"
                  label={<>Wallet for the creator share <span className={s.opt}>(optional)</span></>}
                  value={form.creatorPayee}
                  onChange={onText("creatorPayee")}
                  error={errorFor("creatorPayee")}
                  placeholder="0x…  — leave empty and it goes to the Registrai treasury"
                  spellCheck={false}
                />
                <TextField
                  name="contact"
                  label={<>X handle or email <span className={s.opt}>(optional, only if we have a question)</span></>}
                  value={form.contact}
                  onChange={onText("contact")}
                  error={errorFor("contact")}
                  placeholder="@you"
                />
              </fieldset>

              {/* Honeypot: hidden from people and screen readers; bots fill it. */}
              <div className={s.honeypot} aria-hidden="true">
                <label>
                  Website
                  <input type="text" name="website2" tabIndex={-1} autoComplete="off" value={form.website2} onChange={onText("website2")} />
                </label>
              </div>

              {generalError && <p className={s.error} role="alert">{generalError}</p>}
              <div className={s.submitRow}>
                <button type="submit" className={s.button} disabled={busy}>{busy ? "Sending…" : "Submit proposal"}</button>
                <span className={s.note}>No wallet needed to propose. We never ask for keys or signatures here.</span>
              </div>
            </form>
          )}
        </div>
        <HowItWorks />
      </div>
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={fieldId(`${id}-error`)} className={s.error} role="alert">
      {message}
    </p>
  );
}

type TextFieldProps = {
  name: FieldName;
  /** The validation field name when it differs from the state key (deadlineText -> deadline). */
  errorKey?: string;
  label: ReactNode;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  error: string | null;
  placeholder?: string;
  large?: boolean;
  type?: "text" | "url";
  inputMode?: "decimal" | "text";
  spellCheck?: boolean;
};

function TextField({ name, errorKey, label, value, onChange, error, placeholder, large, type = "text", inputMode, spellCheck }: TextFieldProps) {
  const key = errorKey ?? name;
  return (
    <div className={s.fieldBox}>
      <label className={s.field}>
        {label}
        <input
          id={fieldId(key)}
          type={type}
          className={large ? `${s.input} ${s.inputLg}` : s.input}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          inputMode={inputMode}
          spellCheck={spellCheck}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? fieldId(`${key}-error`) : undefined}
        />
      </label>
      <FieldError id={key} message={error} />
    </div>
  );
}

function TextArea({ name, label, rows, value, onChange, error, placeholder }: {
  name: FieldName; label: ReactNode; rows: number; value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void; error: string | null; placeholder?: string;
}) {
  return (
    <div className={s.fieldBox}>
      <label className={s.field}>
        {label}
        <textarea
          id={fieldId(name)}
          className={s.textarea}
          rows={rows}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? fieldId(`${name}-error`) : undefined}
        />
      </label>
      <FieldError id={name} message={error} />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectFacts } from "@/lib/facts";
import { editorDraft, parseDraft } from "@/lib/facts-editor";
import a from "./admin.module.css";
import cx from "./admin-app.module.css";

const path = (source: string) => `/api/admin/facts/${encodeURIComponent(source)}`;

/** Admin: edit a project's public facts as JSON (same-origin session cookie, like the profile PUT). The server builds the change log. */
export function FactsEditor({ source, canEdit }: { source: string; canEdit: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string; stale?: boolean }>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setText(null);
    setLoadError(null);
    setMsg({});
    try {
      const res = await fetch(path(source), { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      const body = (await res.json().catch(() => ({}))) as { facts?: ProjectFacts; error?: string };
      if (res.status !== 200 || !body.facts) throw new Error(body.error ?? `facts (${res.status})`);
      setText(editorDraft(body.facts));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [source]);
  useEffect(() => {
    void load();
  }, [load]);

  const parsed = useMemo(() => (text === null ? null : parseDraft(text, source)), [text, source]);

  async function save() {
    if (!parsed || !parsed.ok) return;
    setSaving(true);
    setMsg({});
    try {
      const res = await fetch(path(source), {
        method: "PUT",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(parsed.value),
      });
      const body = (await res.json().catch(() => ({}))) as { facts?: ProjectFacts; error?: string };
      if (res.status === 409) setMsg({ stale: true, error: "Someone saved a newer version. Reload to see it." });
      else if (res.status === 200 && body.facts) {
        setText(editorDraft(body.facts));
        setMsg({ ok: `Saved (rev ${body.facts.rev})` });
      } else setMsg({ error: body.error ?? `could not save (${res.status})` });
    } catch (e) {
      setMsg({ error: (e as Error).message });
    }
    setSaving(false);
  }

  return (
    <div className={cx.draftDetails}>
      <p>
        <b>Public facts</b>
      </p>
      <p className={cx.hint}>
        Facts only: what you observed, with evidence. No verdict words, no personal data. Use publishAt for security issues (publish after the fix or in 30 days).
      </p>
      {loadError ? (
        <p className={cx.error}>Could not read the facts: {loadError}</p>
      ) : text === null ? (
        <p className={cx.hint}>Reading facts…</p>
      ) : (
        <>
          <textarea
            className={a.textarea}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", minHeight: 240, width: "100%" }}
            value={text}
            readOnly={!canEdit}
            spellCheck={false}
            aria-label={`Facts JSON for ${source}`}
            onChange={(e) => setText(e.target.value)}
          />
          <p className={parsed?.ok ? cx.hint : cx.error}>
            {parsed?.ok ? `Ready to save: ${parsed.value.facts.length} facts` : parsed?.error}
          </p>
          <span className={cx.rowActions}>
            <button type="button" className={cx.miniGo} disabled={!canEdit || !parsed?.ok || saving} onClick={() => void save()}>
              {saving ? "…" : "Save"}
            </button>
            {msg.stale && (
              <button type="button" className={cx.mini} onClick={() => void load()}>
                Reload
              </button>
            )}
          </span>
          {!canEdit && <p className={cx.hint}>Read-only: only the admin role can save facts.</p>}
        </>
      )}
      {msg.ok && <p className={cx.ok}>{msg.ok}</p>}
      {msg.error && <p className={cx.error}>{msg.error}</p>}
    </div>
  );
}

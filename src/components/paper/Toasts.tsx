"use client";

import { useEffect, useSyncExternalStore } from "react";
import { EMPTY_TOASTS, OK_TTL_MS, dismissToast, expireToasts, getToasts, subscribeToasts } from "@/lib/toast-store";

/** Transaction notes, bottom-right. Successes fade after OK_TTL_MS; errors stay until closed. */
export function Toasts() {
  const { list } = useSyncExternalStore(subscribeToasts, getToasts, () => EMPTY_TOASTS);
  useEffect(() => {
    if (!list.some((t) => t.kind !== "error")) return;
    const id = window.setInterval(() => expireToasts(), Math.min(1000, OK_TTL_MS));
    return () => window.clearInterval(id);
  }, [list]);
  if (!list.length) return null;
  return (
    <div className="pa-toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="pa-toast" data-kind={t.kind}>
          <span>
            {t.kind === "ok" ? "✓ " : ""}
            {t.text}
            {t.href && (
              <>
                {" · "}
                <a href={t.href} target="_blank" rel="noreferrer">view receipt ↗</a>
              </>
            )}
          </span>
          <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  );
}

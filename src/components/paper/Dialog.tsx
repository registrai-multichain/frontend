"use client";

import { useEffect, type ReactNode } from "react";

/** A modal panel: centred on desktop, full screen on a phone. Escape or the backdrop closes it. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="pa-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pa-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="pa-dialog-head">
          <h2 className="pa-h3">{title}</h2>
          <button type="button" className="pa-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

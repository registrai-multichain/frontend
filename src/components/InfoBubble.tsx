"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** A small "i" button that opens a bubble; click outside or Escape closes it. */
export function InfoBubble({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span className="pa-info" ref={ref}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>i</button>
      {open && <span role="note" className="pa-info-bubble">{children}</span>}
    </span>
  );
}

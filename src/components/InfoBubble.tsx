"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** A small "i" button that opens a bubble; click outside or Escape closes it. */
export function InfoBubble({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span className="pa-info" ref={ref}>
      <button type="button" ref={btn} aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>i</button>
      {open && <span id={id} role="note" className="pa-info-bubble">{children}</span>}
    </span>
  );
}

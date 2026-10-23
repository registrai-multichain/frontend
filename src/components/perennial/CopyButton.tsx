"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="pa-chip"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked: the address stays selectable */
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

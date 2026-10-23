"use client";

import { useEffect } from "react";

/**
 * Opens the <details> whose id is the URL's #fragment (on load and on every
 * hash change) and scrolls it into view, so a link like /guide#lost-wallet
 * lands on that section open.
 */
export function OpenFromHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}

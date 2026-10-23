"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Adds data-in once the block scrolls into view; CSS (landing.css) does the motion. Children with
 * style --i get a staggered delay. Without IntersectionObserver (or with reduced motion) it shows at once. */
export function Reveal({ children, className = "", as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "ul" }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.dataset.in = "1";
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          (e.target as HTMLElement).dataset.in = "1";
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref as never} className={`lp-x-reveal ${className}`}>{children}</Tag>;
}

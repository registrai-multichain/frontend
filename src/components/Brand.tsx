import type { CSSProperties } from "react";

type BrandMarkProps = {
  className?: string;
  monochrome?: boolean;
  accent?: string;
};

export function BrandMark({
  className = "",
  monochrome = false,
  accent = "#ff5a1f",
}: BrandMarkProps) {
  const style = { "--brand-accent": accent } as CSSProperties;

  return (
    <svg
      viewBox="0 0 64 64"
      className={`brand-mark ${className}`}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M9 6h28.5C51 6 59 13.9 59 26.1c0 8.3-4.3 14.7-12.1 18L59.5 58H41.7L31 46H25v12H9V6Zm16 13.2v14h10.4c4.9 0 7.7-2.7 7.7-7s-2.8-7-7.7-7H25Z"
        clipRule="evenodd"
      />
      <path
        fill={monochrome ? "currentColor" : "var(--brand-accent)"}
        d="m9 6 18 16.8v5.9L9 46V6Z"
      />
    </svg>
  );
}

export function BrandLockup({
  className = "",
  markClassName = "",
  wordmarkClassName = "",
  monochrome = false,
}: BrandMarkProps & {
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={`brand-lockup ${className}`}>
      <BrandMark className={markClassName} monochrome={monochrome} />
      <span className={`brand-wordmark ${wordmarkClassName}`}>Registrai</span>
    </span>
  );
}

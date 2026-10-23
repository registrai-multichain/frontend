"use client";

import { useState, type ReactNode } from "react";
import { initialOf } from "@/lib/builders-gallery";

/** The avatar tile (clipped-corner square): the GitHub owner's picture, else the initial. */
export function Avatar({ url, name, tone = "plain" }: { url: string | null; name: string; tone?: "ok" | "invited" | "plain" }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="bld-avatar" data-tone={tone} aria-hidden="true">
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimizer
        <img src={url} alt="" width={56} height={56} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span>{initialOf(name)}</span>
      )}
    </div>
  );
}

export interface BuilderCardProps {
  id?: string;
  name: ReactNode;
  /** Plain text for the avatar's initial and the title attribute. */
  nameText: string;
  avatar: string | null;
  tone: "ok" | "invited" | "plain";
  pill: { text: string; tone?: "ok" | "unclaimed" | "muted" | "onchain" | "down" };
  /** A rubber-stamp mark over the card (e.g. "Gone dark"); decorative, the note says it in words. */
  stamp?: string;
  sub?: ReactNode;
  facts?: { label: string; value: ReactNode }[];
  note?: ReactNode;
  children?: ReactNode;
  foot?: ReactNode;
  grey?: boolean;
  highlighted?: boolean;
  kind?: string;
}

/** One builder card, shared by the gallery (builder.registrai.cc) and the markets app's Builders page. */
export function BuilderCardView(p: BuilderCardProps) {
  return (
    <li id={p.id} className="bld-card pa-card" data-kind={p.kind} data-tone={p.grey ? "grayscale" : undefined} data-highlight={p.highlighted ? "true" : undefined}>
      {p.stamp && <span className="bld-stamp" aria-hidden="true">{p.stamp}</span>}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <span className="pa-pill" data-tone={p.pill.tone}>{p.pill.text}</span>
          <h2 className="pa-h3 mt-2 truncate" title={p.nameText}>{p.name}</h2>
          {p.sub && <div className="pa-muted pa-small mt-0.5 truncate">{p.sub}</div>}
        </div>
        <Avatar url={p.avatar} name={p.nameText} tone={p.tone} />
      </div>
      {p.children}
      {p.facts && p.facts.length > 0 && (
        <p className="pa-muted pa-small mt-3">
          {p.facts.map((f, i) => (
            <span key={f.label}>{i > 0 && " · "}{f.label} <b className="text-fg">{f.value}</b></span>
          ))}
        </p>
      )}
      {p.note && <div className="pa-small mt-2">{p.note}</div>}
      {p.foot && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 pa-small">{p.foot}</div>}
    </li>
  );
}

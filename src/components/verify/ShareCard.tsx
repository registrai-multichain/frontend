"use client";

import { useEffect, useRef, useState } from "react";
import {
  CARD_H,
  CARD_LAYOUT,
  CARD_W,
  cardFileName,
  cardFont,
  drawShareCard,
  projectName,
  xIntentUrl,
  type ShareCardData,
} from "@/lib/share-card";
import { BADGE_NETWORK } from "@/components/BuilderBadgeCard";

/**
 * next/font exposes JetBrains Mono as the --font-mono variable on <html>
 * (src/app/layout.tsx), under a generated family name. Canvas needs that exact
 * family, with a system monospace as the fallback.
 */
function monoFamily(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  return v ? `${v}, monospace` : `"JetBrains Mono", monospace`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/**
 * The X share card for a builder's (non-lapsed) badge, drawn at native size and
 * previewed at container width. X's intent cannot carry an image, so the
 * builder downloads the card and attaches it to the post.
 */
export function ShareCard(d: ShareCardData) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"drawing" | "ready" | "error">("drawing");
  const { serial, builderId, source, issuedAt } = d;

  useEffect(() => {
    let live = true;
    (async () => {
      const family = monoFamily();
      const name = projectName(source, builderId);
      // Every weight/size the card uses, so nothing is drawn in the fallback face.
      await Promise.all([
        document.fonts.load(cardFont(CARD_LAYOUT.no.weight, CARD_LAYOUT.no.size, family), "NO."),
        document.fonts.load(cardFont(CARD_LAYOUT.serial.weight, CARD_LAYOUT.serial.size, family), "0123456789"),
        document.fonts.load(cardFont(CARD_LAYOUT.name.weight, CARD_LAYOUT.name.start, family), name),
        document.fonts.load(cardFont(CARD_LAYOUT.sub.weight, CARD_LAYOUT.sub.size, family), "GITHUB DOMAIN BUILDER VERIFIED #·0123456789-"),
      ]);
      const bg = await loadImage(`/badge/${BADGE_NETWORK}/card.jpg`);
      const ctx = canvas.current?.getContext("2d");
      if (!live || !ctx) return;
      drawShareCard(ctx, bg, { serial, builderId, source, issuedAt }, family);
      setState("ready");
    })().catch(() => {
      if (live) setState("error");
    });
    return () => {
      live = false;
    };
  }, [serial, builderId, source, issuedAt]);

  function download() {
    canvas.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = cardFileName(serial);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    }, "image/png");
  }

  return (
    <div className="share-card">
      <div className="pp-card-label">Share on X</div>
      <div className="share-card-frame" data-state={state}>
        <canvas ref={canvas} width={CARD_W} height={CARD_H} aria-label={`Share card: Registrai Verified Builder, ${projectName(source, builderId)}`} />
        {state !== "ready" && <span>{state === "error" ? "Couldn't draw the card." : "Drawing…"}</span>}
      </div>
      <div className="share-card-actions">
        <button type="button" className="vf-primary" onClick={download} disabled={state !== "ready"}>Download card</button>
        <a className="vf-mini" href={xIntentUrl({ serial, source, builderId })} target="_blank" rel="noreferrer">Post on X ↗</a>
      </div>
      <p className="vf-hint">X can&apos;t take the image from a link: download the card, then attach it to your post.</p>
    </div>
  );
}

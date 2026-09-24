"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  CARD_H,
  CARD_LAYOUT,
  CARD_W,
  cardFileName,
  cardFont,
  defaultPictureUrl,
  drawShareCard,
  projectName,
  tagText,
  xIntentUrl,
  type CardPicture,
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

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    // A remote picture must be CORS-clean or the canvas can no longer be exported.
    if (crossOrigin) img.crossOrigin = "anonymous";
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
/** The builder's picture: an uploaded file, else the GitHub owner's avatar, else none (initial). */
async function loadPicture(upload: string | null, source: string | null): Promise<CardPicture | null> {
  const url = upload ?? defaultPictureUrl(source);
  if (!url) return null;
  try {
    const img = await loadImage(url, !upload);
    return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  }
}

export function ShareCard(d: Omit<ShareCardData, "picture">) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"drawing" | "ready" | "error">("drawing");
  const [upload, setUpload] = useState<string | null>(null);
  const { serial, builderId, source, issuedAt } = d;

  useEffect(() => {
    let live = true;
    (async () => {
      setState("drawing");
      const family = monoFamily();
      const name = projectName(source, builderId);
      const L = CARD_LAYOUT;
      // Every weight/size the card uses, so nothing is drawn in the fallback face.
      await Promise.all([
        document.fonts.load(cardFont(L.tag.weight, L.tag.start, family), tagText(serial)),
        document.fonts.load(cardFont(L.initial.weight, L.initial.size, family), name),
        document.fonts.load(cardFont(L.name.weight, L.name.start, family), name),
        document.fonts.load(cardFont(L.sub.weight, L.sub.size, family), "GITHUB DOMAIN BUILDER VERIFIED #·0123456789-"),
      ]);
      const [bg, picture] = await Promise.all([loadImage(`/badge/${BADGE_NETWORK}/card.jpg`), loadPicture(upload, source)]);
      const ctx = canvas.current?.getContext("2d");
      if (!live || !ctx) return;
      drawShareCard(ctx, bg, { serial, builderId, source, issuedAt, picture }, family);
      setState("ready");
    })().catch(() => {
      if (live) setState("error");
    });
    return () => {
      live = false;
    };
  }, [serial, builderId, source, issuedAt, upload]);

  useEffect(() => () => {
    if (upload) URL.revokeObjectURL(upload);
  }, [upload]);

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f && f.type.startsWith("image/")) setUpload(URL.createObjectURL(f));
    e.target.value = "";
  }

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
        <label className="vf-mini share-card-upload">
          {upload ? "Change picture" : "Use another picture"}
          <input type="file" accept="image/*" onChange={pick} hidden />
        </label>
        {upload && (
          <button type="button" className="vf-mini" onClick={() => setUpload(null)}>
            {defaultPictureUrl(source) ? "Use GitHub avatar" : "Remove picture"}
          </button>
        )}
      </div>
      <p className="vf-hint">
        Your picture stays in your browser. X can&apos;t take the image from a link: download the card, then attach it to your post.
      </p>
    </div>
  );
}

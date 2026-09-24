#!/usr/bin/env python3
"""Render the VerifiedBuilderBadge artwork: one image per serial, plus its
"lapsed" variant, for each network whose badge contract is deployed.

The on-chain tokenURI points at `imageBase + serial + ("-lapsed")? + ".jpg"`,
e.g. https://registrai.cc/badge/arc/7.jpg. Images depend only on (serial,
network, lapsed), so they are pre-rendered ahead of issuance (`--ahead`): a
freshly issued badge already has its picture before the next site deploy.

    python3 scripts/render-badges.py                      # networks + counts from live-data.json
    python3 scripts/render-badges.py --network arc --upto 60

Output: public/badge/<network>/<serial>.jpg and <serial>-lapsed.jpg, plus the
X share-card background card.jpg (git-ignored,
regenerated on deploy). Existing files are kept unless the art/renderer changed
(a stamp file records the input hash).

Art: art/verified-builder-badge.png (1254x1254). The two pieces of per-token
text — "NO. 001" and "ARC MAINNET" — are cleared with texture copied from the
empty band just above them, and redrawn in JetBrains Mono on the art's own
17 px monospace grid.
"""
import argparse
import hashlib
import json
import pathlib
import sys

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

HERE = pathlib.Path(__file__).resolve().parent.parent
ART = HERE / "art" / "verified-builder-badge.png"
CARD_ART = HERE / "art" / "verified-builder-card-9x4.png"
FONT_MEDIUM = HERE / "art" / "fonts" / "JetBrainsMono-Medium.ttf"
FONT_BOLD = HERE / "art" / "fonts" / "JetBrainsMono-Bold.ttf"
OUT = HERE / "public" / "badge"
LIVE = HERE / "src" / "lib" / "live-data.json"

# Network key (URL path segment) -> the label printed bottom-left.
NETWORKS = {"arc": "ARC MAINNET", "arc-testnet": "ARC TESTNET", "local": "LOCAL ANVIL"}

# Geometry measured from the art (1254x1254).
PITCH = 17            # monospace cell width
NO_RIGHT = 1110       # right edge of the "NO. 001" run
LABEL_LEFT = 142      # left edge of the "ARC MAINNET" run
TEXT_TOP = 1110       # cap top of both runs
CAP = 16              # cap height
NO_BOX = (975, 1098, 1125, 1136)
LABEL_BOX = (132, 1098, 335, 1136)
PATCH_DY = -42        # the empty band above the runs supplies the texture
INK = (224, 222, 215)
SHADOW = (4, 4, 3)
ORANGE = (255, 112, 56)
SIZE = 1024           # published size
QUALITY = 84

# The X share card (1881x836). Only its network label is baked here; the
# picture, project name and serial tag are drawn in the browser
# (src/lib/share-card.ts), so the art's sample "#001" is cleared from the tag.
CARD_PITCH = 23.6
CARD_LABEL_LEFT = 1406
CARD_TEXT_TOP = 656
CARD_CAP = 20
CARD_LABEL_BOX = (1400, 647, 1684, 685)
CARD_PATCH_DY = 113   # empty band below the label
CARD_TAG_BOX = (1522, 413, 1640, 455)   # the "#001" inside the serial tag
CARD_TAG_SRC = (700, 455)               # empty bar interior: grain source


def _erase(im, box, dy=PATCH_DY):
    x0, y0, x1, y1 = box
    patch = im.crop((x0, y0 + dy, x1, y1 + dy))
    mask = Image.new("L", patch.size, 0)
    ImageDraw.Draw(mask).rectangle((4, 4, patch.size[0] - 5, patch.size[1] - 5), fill=255)
    im.paste(patch, (x0, y0), mask.filter(ImageFilter.GaussianBlur(3)))


def _cap_font(path, cap):
    for size in range(8, 64):
        f = ImageFont.truetype(str(path), size)
        b = f.getbbox("H")
        if b[3] - b[1] >= cap:
            return f
    raise SystemExit("no font size reaches the cap height")


def _cells(im, text, left, font, pitch=PITCH, text_top=TEXT_TOP):
    d = ImageDraw.Draw(im)
    top = font.getbbox("H")[1]
    for k, ch in enumerate(text):
        if ch == " ":
            continue
        b = font.getbbox(ch)
        x = left + k * pitch + pitch / 2 - (b[2] - b[0]) / 2 - b[0]
        y = text_top - top
        d.text((x, y + 1.2), ch, font=font, fill=SHADOW)  # the art's letterpress shadow
        d.text((x, y), ch, font=font, fill=INK)


def serial_text(serial):
    return f"NO. {serial:03d}"


def render(serial, network, lapsed, base=None):
    im = (base or Image.open(ART).convert("RGB")).copy()
    font = _cap_font(FONT_MEDIUM, CAP)
    no = serial_text(serial)
    _erase(im, NO_BOX)
    _cells(im, no, NO_RIGHT - len(no) * PITCH, font)
    label = NETWORKS[network]
    if label != "ARC MAINNET":
        _erase(im, LABEL_BOX)
        _cells(im, label, LABEL_LEFT, font)
    if lapsed:
        im = ImageEnhance.Brightness(ImageOps.grayscale(im).convert("RGB")).enhance(0.55)
        d = ImageDraw.Draw(im)
        w = im.size[0]
        d.rectangle((0, 560, w, 660), fill=(12, 12, 11))
        d.line((0, 560, w, 560), fill=ORANGE, width=3)
        d.line((0, 660, w, 660), fill=ORANGE, width=3)
        big = ImageFont.truetype(str(FONT_BOLD), 64)
        text = " ".join("PROOF LAPSED")
        tb = d.textbbox((0, 0), text, font=big)
        d.text(((w - (tb[2] - tb[0])) / 2 - tb[0], 610 - (tb[3] + tb[1]) / 2), text, font=big, fill=ORANGE)
    return im.resize((SIZE, SIZE), Image.LANCZOS)


def _inpaint(im, box, grain_xy):
    """Remove the lime sample text inside `box` without touching its frame:
    only text pixels (dilated) are replaced, by the surrounding fill
    (normalized-convolution blur of the known pixels) plus the grain of an
    empty area at `grain_xy`."""
    import numpy as np
    x0, y0, x1, y1 = box
    region = im.crop(box)
    a = np.asarray(region).astype(float)
    text = (a[:, :, 1] > 120) & (a[:, :, 2] < a[:, :, 1] - 40)       # lime ink and its anti-aliasing
    mask = Image.fromarray((text * 255).astype("uint8")).filter(ImageFilter.MaxFilter(7))
    m = np.asarray(mask).astype(float) / 255.0
    known = 1.0 - m
    def blur(arr, r=8):
        # three separable box passes ~ a Gaussian; edge-padded so borders keep their level
        k = np.ones(2 * r + 1) / (2 * r + 1)
        out = arr
        for _ in range(3):
            out = np.pad(out, ((r, r), (0, 0)), mode="edge")
            out = np.apply_along_axis(lambda c: np.convolve(c, k, mode="valid"), 0, out)
            out = np.pad(out, ((0, 0), (r, r)), mode="edge")
            out = np.apply_along_axis(lambda c: np.convolve(c, k, mode="valid"), 1, out)
        return out
    fill = np.stack([blur(a[:, :, i] * known) / np.maximum(blur(known), 1e-3) for i in range(3)], axis=2)
    src = np.asarray(im.crop((grain_xy[0], grain_xy[1], grain_xy[0] + (x1 - x0), grain_xy[1] + (y1 - y0)))).astype(float)
    grain = src - np.stack([blur(src[:, :, i], 3) for i in range(3)], axis=2)
    soft = np.asarray(mask.filter(ImageFilter.GaussianBlur(1.5))).astype(float)[:, :, None] / 255.0
    out = a * (1 - soft) + np.clip(fill + grain, 0, 255) * soft
    im.paste(Image.fromarray(out.round().astype("uint8")), (x0, y0))


def render_card_template(network):
    """The share card with this network's label; everything per-builder is left blank."""
    im = Image.open(CARD_ART).convert("RGB")
    _inpaint(im, CARD_TAG_BOX, CARD_TAG_SRC)
    label = NETWORKS[network]
    if label != "ARC MAINNET":
        _erase(im, CARD_LABEL_BOX, CARD_PATCH_DY)
        _cells(im, label, CARD_LABEL_LEFT, _cap_font(FONT_MEDIUM, CARD_CAP), CARD_PITCH, CARD_TEXT_TOP)
    return im


def _stamp():
    h = hashlib.sha256()
    for p in (ART, CARD_ART, FONT_MEDIUM, FONT_BOLD, pathlib.Path(__file__)):
        h.update(p.read_bytes())
    return h.hexdigest()[:16]


def targets_from_live(ahead, minimum):
    """{network: upto} for every network whose badge contract live-data knows."""
    try:
        live = json.loads(LIVE.read_text())
    except (OSError, ValueError):
        return {}
    out = {}
    for net, info in (live.get("badges") or {}).items():
        if net in NETWORKS and info.get("address"):
            out[net] = max(minimum, int(info.get("maxSerial") or 0) + ahead)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--network", choices=sorted(NETWORKS))
    ap.add_argument("--upto", type=int, help="render serials 1..UPTO")
    ap.add_argument("--ahead", type=int, default=50, help="serials to pre-render past the highest issued")
    ap.add_argument("--min", type=int, default=50, dest="minimum")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)

    if a.network:
        targets = {a.network: a.upto or a.minimum}
    else:
        targets = targets_from_live(a.ahead, a.minimum)
        if not targets:
            print("render-badges: no badge contract in live-data.json; nothing to render")
            return 0

    stamp = _stamp()
    base = Image.open(ART).convert("RGB")
    for net, upto in targets.items():
        d = pathlib.Path(a.out) / net
        d.mkdir(parents=True, exist_ok=True)
        sf = d / ".stamp"
        fresh = a.force or not sf.exists() or sf.read_text().strip() != stamp
        made = 0
        for serial in range(1, upto + 1):
            for lapsed in (False, True):
                f = d / f"{serial}{'-lapsed' if lapsed else ''}.jpg"
                if f.exists() and not fresh:
                    continue
                render(serial, net, lapsed, base).save(f, quality=QUALITY, optimize=True, progressive=True)
                made += 1
        card = d / "card.jpg"
        if fresh or not card.exists():
            render_card_template(net).save(card, quality=88, optimize=True, progressive=True)
        sf.write_text(stamp + "\n")
        print(f"render-badges: {net} 1..{upto} ({made} rendered) -> {d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Prepare a generated top-down floor-seal inlay for the game (17 Sep 2026).

The image lane returns the inlay on a cut background; between the metal lines it may still hold the "matte
black" the prompt asked for. This keys that near-black to alpha (soft ramp), trims to the alpha bounding
box, pads to a square with a small margin, de-fringes the edge colour so bilinear filtering never drags a
dark halo in, and writes the 2048 px RGBA decal. The source is never modified.

Usage: prepare-floor-seal.py <generated.png> <out.png> [--key 34] [--soft 26] [--size 2048] [--margin .02]
"""
import argparse
import numpy as np
from PIL import Image, ImageFilter

p = argparse.ArgumentParser()
p.add_argument('src'); p.add_argument('out')
p.add_argument('--key', type=float, default=34, help='luminance (0-255) at and under which a pixel is fully transparent')
p.add_argument('--soft', type=float, default=26, help='luminance ramp width above --key')
p.add_argument('--size', type=int, default=2048)
p.add_argument('--margin', type=float, default=.02)
p.add_argument('--outer', type=float, default=0, help='keep only the band OUTSIDE this radius fraction (0 keeps everything)')
p.add_argument('--centre', type=float, default=0, help='with --outer: also keep the emblem INSIDE this radius fraction')
p.add_argument('--ring', default='', help='with --outer: also keep a band r0,r1 (fractions), e.g. .325,.395')
p.add_argument('--desaturate', type=float, default=0, help='0..1: pull the colour toward its luminance (dark iron instead of brass)')
a = p.parse_args()

im = Image.open(a.src).convert('RGBA')
arr = np.asarray(im).astype(np.float64)
rgb, alpha = arr[..., :3], arr[..., 3] / 255.
lum = rgb @ np.array([.2126, .7152, .0722])
keyed = np.clip((lum - a.key) / max(1e-6, a.soft), 0, 1)
alpha = alpha * keyed
# trim + square pad
ys, xs = np.nonzero(alpha > .02)
if len(xs) == 0:
    raise SystemExit('nothing opaque in the image')
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
side = max(x1 - x0, y1 - y0)
pad = int(round(side * a.margin))
side += 2 * pad
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
canvas_rgb = np.zeros((side, side, 3)); canvas_a = np.zeros((side, side))
sx0, sy0 = cx - side // 2, cy - side // 2
for y in range(side):
    yy = sy0 + y
    if 0 <= yy < arr.shape[0]:
        xa, xb = max(0, sx0), min(arr.shape[1], sx0 + side)
        canvas_rgb[y, xa - sx0:xb - sx0] = rgb[yy, xa:xb]
        canvas_a[y, xa - sx0:xb - sx0] = alpha[yy, xa:xb]
# de-fringe: colour of translucent pixels comes from a blur of the opaque colour (alpha-weighted)
w = canvas_a[..., None]
blur_rgb = np.asarray(Image.fromarray((canvas_rgb * w).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float64)
blur_a = np.asarray(Image.fromarray((canvas_a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float64) / 255.
spread = blur_rgb / np.maximum(blur_a[..., None], 1e-3)
fixed = np.where(canvas_a[..., None] > .85, canvas_rgb, spread)
# Minimalist cut (17 Sep, second pass): keep the outer band and, optionally, a small central emblem; the rest
# of the tracery goes so the flagstones stay open. Soft 1.5 % feathers so no ring edge is a hard circle.
if a.outer > 0:
    h, w = canvas_a.shape
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot((xx - (w - 1) / 2) / (w / 2), (yy - (h - 1) / 2) / (h / 2))
    feather = .015
    keep = np.clip((r - a.outer) / feather + .5, 0, 1)
    if a.centre > 0:
        keep = np.maximum(keep, np.clip((a.centre - r) / feather + .5, 0, 1))
    if a.ring:
        r0, r1 = [float(x) for x in a.ring.split(',')]
        band = np.minimum(np.clip((r - r0) / feather + .5, 0, 1), np.clip((r1 - r) / feather + .5, 0, 1))
        keep = np.maximum(keep, band)
    canvas_a = canvas_a * keep
if a.desaturate > 0:
    lum = (fixed @ np.array([.2126, .7152, .0722]))[..., None]
    fixed = fixed * (1 - a.desaturate) + lum * a.desaturate
out = np.dstack([np.clip(fixed, 0, 255), np.clip(canvas_a * 255, 0, 255)]).astype(np.uint8)
result = Image.fromarray(out, 'RGBA').resize((a.size, a.size), Image.LANCZOS)
result.save(a.out)
opaque = (np.asarray(result)[..., 3] > 128).mean()
print(f'{a.out}: {a.size}x{a.size}, trimmed from ({x0},{y0})-({x1},{y1}), opaque {opaque*100:.1f}% of the square')

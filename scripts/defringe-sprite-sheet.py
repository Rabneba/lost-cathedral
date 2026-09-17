#!/usr/bin/env python3
"""De-fringe a generated transparent sprite sheet: the RGB under fully transparent
pixels is garbage (rainbow noise), and bilinear filtering drags it into every alpha
edge as a coloured halo. This dilates the colour of opaque pixels outward into the
transparent area, hardens alpha slightly, and writes a NEW file. The source is untouched.

Usage: defringe-sprite-sheet.py <in.png> <out.png> [--iterations 24] [--alpha-gamma .85]
"""
import argparse
import numpy as np
from PIL import Image

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--iterations', type=int, default=24)
    ap.add_argument('--alpha-gamma', type=float, default=.85)
    ap.add_argument('--threshold', type=int, default=24, help='alpha below this is treated as empty')
    a = ap.parse_args()
    img = np.asarray(Image.open(a.src).convert('RGBA')).astype(np.float64)
    rgb, alpha = img[..., :3].copy(), img[..., 3].copy()
    solid = alpha >= a.threshold
    # Everything below the threshold becomes fully transparent: the generator leaves
    # a faint noisy halo of 1-20 alpha around every object.
    alpha[~solid] = 0
    filled = solid.copy()
    colour = rgb.copy(); colour[~solid] = 0
    for _ in range(a.iterations):
        if filled.all():
            break
        acc = np.zeros_like(colour); cnt = np.zeros(filled.shape, dtype=np.float64)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            shifted = np.roll(np.roll(filled, dy, axis=0), dx, axis=1)
            shifted_colour = np.roll(np.roll(colour, dy, axis=0), dx, axis=1)
            acc += shifted_colour * shifted[..., None]
            cnt += shifted
        grow = (~filled) & (cnt > 0)
        colour[grow] = acc[grow] / cnt[grow][:, None]
        filled |= grow
    colour[~filled] = colour[filled].mean(axis=0) if filled.any() else 0
    alpha = 255 * np.clip(alpha / 255, 0, 1) ** a.alpha_gamma
    out = np.concatenate([colour, alpha[..., None]], axis=-1)
    Image.fromarray(np.clip(out + .5, 0, 255).astype(np.uint8), mode='RGBA').save(a.out, optimize=True)
    print(f'{a.out}: {solid.mean()*100:.1f}% opaque, dilated {a.iterations} px')

if __name__ == '__main__':
    main()

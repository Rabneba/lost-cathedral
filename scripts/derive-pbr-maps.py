#!/usr/bin/env python3
"""Derive a tangent-space normal map (with roughness packed in alpha) from a tiling
base-colour texture. The Genex texture lane returns base colour only on this account
(16 Sep, twice), so relief and gloss are derived from the photograph itself: dark
recessed joints and cracks sit low and rough, bright polished slab centres sit high
and smoother, and fine scratches add micro-roughness.

Usage: derive-pbr-maps.py <albedo> <out-normal-rgba.png> [--strength 2.4] [--broad 6]
       [--rough-base .62 --rough-range .38] [--preview <out-rough.png>]
The source file is never modified. Wrap-around (np.roll) keeps the result seamless.
"""
import argparse
import numpy as np
from PIL import Image

def gaussian(a, sigma):
    """Separable Gaussian blur with wrap-around, so the result tiles like the source."""
    if sigma <= 0:
        return a
    radius = int(np.ceil(sigma * 3))
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    kernel = np.exp(-.5 * (x / sigma) ** 2); kernel /= kernel.sum()
    padded = np.pad(a, ((0, 0), (radius, radius)), mode='wrap')
    out = np.zeros_like(a)
    for i, w in enumerate(kernel):
        out += w * padded[:, i:i + a.shape[1]]
    padded = np.pad(out, ((radius, radius), (0, 0)), mode='wrap')
    out = np.zeros_like(a)
    for i, w in enumerate(kernel):
        out += w * padded[i:i + a.shape[0], :]
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('albedo'); ap.add_argument('out')
    ap.add_argument('--strength', type=float, default=2.4)
    ap.add_argument('--broad', type=float, default=6.0)
    ap.add_argument('--fine', type=float, default=1.0)
    ap.add_argument('--rough-base', type=float, default=.62)
    ap.add_argument('--rough-range', type=float, default=.38)
    ap.add_argument('--invert', action='store_true', help='bright = low (for dark-on-light engravings)')
    ap.add_argument('--preview', default=None)
    a = ap.parse_args()
    img = Image.open(a.albedo).convert('RGB')
    rgb = np.asarray(img, dtype=np.float64) / 255.0
    lin = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    lum = lin @ np.array([.2126, .7152, .0722])
    lum = lum / max(lum.max(), 1e-6)
    if a.invert:
        lum = 1 - lum
    # Height: a broad term (joints and slab-to-slab level) plus a fine term (grain).
    fine = gaussian(lum, a.fine)
    broad = gaussian(lum, a.broad)
    height = broad * .55 + fine * .45
    height = (height - height.min()) / max(height.max() - height.min(), 1e-6)
    # Gradients with wrap so the tile stays seamless.
    du = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * .5
    dv = (np.roll(height, 1, axis=0) - np.roll(height, -1, axis=0)) * .5   # +v is UP the image
    k = a.strength * height.shape[0] / 64.0
    nx, ny, nz = -du * k, -dv * k, np.ones_like(height)
    n = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / n, ny / n, nz / n
    # Roughness: rough in the dark joints, on cracks and scratches (local contrast);
    # smoother on the bright worn slab centres.
    contrast = gaussian(np.abs(fine - gaussian(lum, 3.0)), 1.5)
    contrast = contrast / max(np.percentile(contrast, 99), 1e-6)
    joint = 1 - np.clip((broad - broad.min()) / max(broad.max() - broad.min(), 1e-6), 0, 1)
    rough = a.rough_base + a.rough_range * np.clip(.55 * joint + .65 * contrast, 0, 1)
    rough = np.clip(rough, 0, 1)
    out = np.stack([nx * .5 + .5, ny * .5 + .5, nz * .5 + .5, rough], axis=-1)
    Image.fromarray((out * 255 + .5).astype(np.uint8), mode='RGBA').save(a.out, optimize=True)
    if a.preview:
        Image.fromarray((rough * 255 + .5).astype(np.uint8), mode='L').save(a.preview)
    print(f'{a.out}: normal xy std {np.std(nx):.3f}/{np.std(ny):.3f}, rough mean {rough.mean():.3f} min {rough.min():.3f} max {rough.max():.3f}')

if __name__ == '__main__':
    main()

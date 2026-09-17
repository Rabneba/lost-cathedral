#!/usr/bin/env python3
"""Motion-compensated shimmer between consecutive game stills.

The lock-on camera is never truly still (it tracks a walking boss, 2-3 px per 150 ms),
so a raw per-pixel diff of two "static" frames mostly measures the pan. This aligns
frame B onto frame A per region with a sub-pixel bilinear search (+-2 px, 0.1 px steps)
and reports the RESIDUAL: mean |delta| and the share of pixels changing by more than
20 and 40 levels after alignment. That residual is what a player sees as shimmer,
sparkle or flicker while moving. Regions default to the four actor-free floor quarters
at the fight camera (1600x813).

Usage: measure-floor-shimmer.py <dir> [--frames s1,s2,s3,s4] [--region name=x0,y0,x1,y1]...
"""
import sys, os
import numpy as np
from PIL import Image

DEFAULT_REGIONS = {'far L': (100, 330, 560, 560), 'far R': (1050, 330, 1500, 560),
                   'near L': (100, 560, 700, 800), 'near R': (900, 560, 1500, 800)}

def luma(path):
    a = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64)
    return a @ np.array([.2126, .7152, .0722])

def shifted(b, dx, dy):
    h, w = b.shape
    X = np.clip(np.arange(w) + dx, 0, w - 1); Y = np.clip(np.arange(h) + dy, 0, h - 1)
    x0 = np.floor(X).astype(int); x1 = np.minimum(x0 + 1, w - 1); fx = X - x0
    y0 = np.floor(Y).astype(int); y1 = np.minimum(y0 + 1, h - 1); fy = (Y - y0)[:, None]
    return (b[y0][:, x0] * (1 - fx) * (1 - fy) + b[y0][:, x1] * fx * (1 - fy)
            + b[y1][:, x0] * (1 - fx) * fy + b[y1][:, x1] * fx * fy)

def align(a, b):
    best = None
    for dy in np.arange(-2.5, 2.51, .5):
        for dx in np.arange(-2.5, 2.51, .5):
            err = np.abs(a - shifted(b, dx, dy)).mean()
            if best is None or err < best[0]: best = (err, dx, dy)
    _, cx, cy = best
    for dy in np.arange(cy - .5, cy + .51, .1):
        for dx in np.arange(cx - .5, cx + .51, .1):
            bb = shifted(b, dx, dy); err = np.abs(a - bb).mean()
            if err < best[0]: best = (err, dx, dy, bb)
    if len(best) == 3: best = best + (shifted(b, best[1], best[2]),)
    return best

def main():
    args = sys.argv[1:]
    d = args[0]; frames = ['s1', 's2', 's3', 's4']; regions = dict(DEFAULT_REGIONS)
    i = 1
    while i < len(args):
        if args[i] == '--frames': frames = args[i + 1].split(','); i += 2
        elif args[i] == '--region':
            name, box = args[i + 1].split('='); regions[name] = tuple(int(v) for v in box.split(',')); i += 2
        else: i += 1
    ims = [luma(os.path.join(d, f + '.png')) for f in frames]
    print(f'{d}: motion-compensated residual, frames {frames}')
    totals = []
    for k in range(len(ims) - 1):
        a, b = ims[k], ims[k + 1]
        row = []
        for name, (x0, y0, x1, y1) in regions.items():
            ra, rb = a[y0:y1, x0:x1], b[y0:y1, x0:x1]
            raw = np.abs(ra - rb).mean()
            err, dx, dy, bb = align(ra, rb)
            res = np.abs(ra - bb)
            row.append(f'{name}: shift ({dx:+.1f},{dy:+.1f}) raw {raw:4.2f} -> residual {err:4.2f}, >20 {(res > 20).mean() * 100:4.2f}%, >40 {(res > 40).mean() * 100:4.2f}%')
            totals.append((err, (res > 20).mean(), (res > 40).mean()))
        print(f'  {frames[k]}->{frames[k + 1]}\n    ' + '\n    '.join(row))
    t = np.array(totals)
    print(f'  MEAN residual {t[:, 0].mean():.2f}  >20 {t[:, 1].mean() * 100:.2f}%  >40 {t[:, 2].mean() * 100:.3f}%')

if __name__ == '__main__':
    main()

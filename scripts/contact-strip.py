#!/usr/bin/env python3
"""Tile review renders into one labelled strip so a whole clip can be judged in a single image.

    python3 scripts/contact-strip.py <out.png> <label> <image> [<image> ...]

Each source image keeps its own file name as the caption (the renderer encodes the clip time in
it, e.g. light-quarter-045.png = 0.45 s).
"""
import sys, os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.image as mpimg

out, label, files = sys.argv[1], sys.argv[2], sys.argv[3:]
cols = min(len(files), 4)
rows = (len(files) + cols - 1) // cols
fig = plt.figure(figsize=(3.2 * cols, 3.4 * rows), layout='constrained', facecolor='#1b1d20')
for i, f in enumerate(files):
    ax = fig.add_subplot(rows, cols, i + 1)
    ax.imshow(mpimg.imread(f))
    ax.axis('off')
    name = os.path.basename(f).rsplit('.', 1)[0]
    stamp = name.rsplit('-', 1)[-1]
    try:
        ax.set_title('%.2f s' % (int(stamp) / 100), color='#e8e2d4', fontsize=13)
    except ValueError:
        ax.set_title(name, color='#e8e2d4', fontsize=11)
fig.suptitle(label, color='#e8e2d4', fontsize=17, fontweight='bold')
os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
fig.savefig(out, dpi=95, facecolor='#1b1d20')
print('STRIP', out)

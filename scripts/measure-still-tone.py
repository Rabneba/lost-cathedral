#!/usr/bin/env python3
"""Tone statistics for game stills (JPG or PNG): whole-frame 8-bit luma mean, share of
pixels under level 12, p95, and the same for an optional region. Used to compare the
hero cameras against the user's references (round 2, stream ENV).

Usage: measure-still-tone.py <image>... [--region x0,y0,x1,y1]
"""
import sys
import numpy as np
from PIL import Image

def stats(l):
    return f'mean {l.mean():5.1f}  <12: {(l < 12).mean() * 100:5.1f}%  p95 {np.percentile(l, 95):5.1f}  p99 {np.percentile(l, 99):5.1f}'

def main():
    args = sys.argv[1:]
    region = None
    files = []
    i = 0
    while i < len(args):
        if args[i] == '--region':
            region = [int(v) for v in args[i + 1].split(',')]; i += 2
        else:
            files.append(args[i]); i += 1
    for f in files:
        a = np.asarray(Image.open(f).convert('RGB'), dtype=np.float64)
        l = a @ np.array([.2126, .7152, .0722])
        line = f'{f.split("/")[-1]:24s} frame {stats(l)}'
        if region:
            x0, y0, x1, y1 = region
            line += f' | region {stats(l[y0:y1, x0:x1])}'
        print(line)

if __name__ == '__main__':
    main()

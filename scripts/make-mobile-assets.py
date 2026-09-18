#!/usr/bin/env python3
"""Phone copies of the heavy models and the seal (17 Sep 2026, the mobile pass).

A GLB is a container: a JSON chunk (mesh, skeleton, clips, materials, image records) and a binary chunk that holds
the vertex buffers, the animation samplers and the embedded JPEG/PNG images side by side. This rewrites the images
smaller and leaves every other byte of the binary chunk as it was, so the copy has the same mesh, the same rig, the
same clips and the same materials, only with textures no larger than --max on their long side. The originals are
never touched: copies go to assets/mobile/ and src/game/asset-paths.js points the touch path at them.

  python3 scripts/make-mobile-assets.py            # the shipped set, 1024 px
  python3 scripts/make-mobile-assets.py --max 512  # smaller still
"""
import argparse, io, json, os, struct, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'mobile')
# The heavy models: every one of these carries three 4096-square maps (see docs/mobile-2026-09-17/README.md).
GLBS = {
    'player-video-candidate-v18.glb': 'assets/player-motion-revision-3/player-video-candidate-v18.glb',
    'boss-supported-combat.glb': 'assets/production/boss-supported-combat.glb',
    'scythe-fitted.glb': 'assets/idle-video-motion/scythe-fitted.glb',
    'player-sword.glb': 'assets/create-the-exact-isolated-player-sword-s-cmu12ngf.glb',
    'player-shield.glb': 'assets/create-the-exact-isolated-player-shield-cmu12nf3.glb',
    'funerary-monument.glb': 'assets/a-single-weathered-gothic-cathedral-fune-cmu1gsre.glb',
    'funerary-monument-lod.glb': 'assets/environment-lod/funerary-monument-lod.glb',
}
IMAGES = {
    'floor-seal.png': 'assets/environment/floor-seal.png',
    'floor-seal-nr.png': 'assets/environment/floor-seal-nr.png',
}


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67 and version == 2, f'{path}: not a glTF 2 binary'
    offset, chunks = 12, {}
    while offset < length:
        size, kind = struct.unpack_from('<II', data, offset)
        chunks[kind] = data[offset + 8: offset + 8 + size]
        offset += 8 + size
    doc = json.loads(chunks[0x4E4F534A].decode('utf-8'))
    return doc, chunks.get(0x004E4942, b'')


def write_glb(path, doc, binary):
    text = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    text += b' ' * (-len(text) % 4)
    binary = bytes(binary) + b'\0' * (-len(binary) % 4)
    body = struct.pack('<II', len(text), 0x4E4F534A) + text + struct.pack('<II', len(binary), 0x004E4942) + binary
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + len(body)) + body)


def shrink_image(raw, mime, cap, quality):
    image = Image.open(io.BytesIO(raw))
    width, height = image.size
    if max(width, height) <= cap:
        return raw, (width, height), (width, height)
    scale = cap / max(width, height)
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    small = image.resize(size, Image.LANCZOS)
    out = io.BytesIO()
    if mime == 'image/png':
        small.save(out, 'PNG', optimize=True)
    else:
        if small.mode not in ('RGB', 'L'):
            small = small.convert('RGB')
        small.save(out, 'JPEG', quality=quality, subsampling=0, optimize=True)
    return out.getvalue(), (width, height), size


def convert_glb(src, dst, cap, quality):
    doc, binary = read_glb(src)
    views = doc.get('bufferViews', [])
    image_views = {}
    for i, image in enumerate(doc.get('images', [])):
        assert 'bufferView' in image, f'{src}: image {i} is external, not embedded'
        image_views[image['bufferView']] = image.get('mimeType', 'image/jpeg')
    assert len(doc.get('buffers', [])) == 1, f'{src}: expected one buffer'
    out, report = bytearray(), []
    for i, view in enumerate(views):
        start = view.get('byteOffset', 0)
        raw = binary[start: start + view['byteLength']]
        if i in image_views:
            raw, before, after = shrink_image(raw, image_views[i], cap, quality)
            report.append((image_views[i], before, after, view['byteLength'], len(raw)))
        out += b'\0' * (-len(out) % 4)
        view['byteOffset'] = len(out)
        view['byteLength'] = len(raw)
        out += raw
    doc['buffers'][0]['byteLength'] = len(out)
    doc.setdefault('asset', {})['generator'] = (doc.get('asset', {}).get('generator', '') + ' · phone copy: textures capped at %d px (scripts/make-mobile-assets.py)' % cap).strip(' ·')
    write_glb(dst, doc, out)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--max', type=int, default=1024, help='long side cap in px (default 1024)')
    parser.add_argument('--quality', type=int, default=88, help='JPEG quality for resized maps (default 88)')
    args = parser.parse_args()
    os.makedirs(OUT, exist_ok=True)
    for name, rel in GLBS.items():
        src, dst = os.path.join(ROOT, rel), os.path.join(OUT, name)
        report = convert_glb(src, dst, args.max, args.quality)
        maps = ', '.join(f'{b[0]}x{b[1]}->{a[0]}x{a[1]}' for _, b, a, _, _ in report)
        print(f'{name}: {os.path.getsize(src)/1048576:.1f} MB -> {os.path.getsize(dst)/1048576:.1f} MB  [{maps}]')
    for name, rel in IMAGES.items():
        src, dst = os.path.join(ROOT, rel), os.path.join(OUT, name)
        with open(src, 'rb') as f:
            raw = f.read()
        small, before, after = shrink_image(raw, 'image/png', args.max, args.quality)
        with open(dst, 'wb') as f:
            f.write(small)
        print(f'{name}: {len(raw)/1048576:.1f} MB -> {len(small)/1048576:.1f} MB  [{before[0]}x{before[1]}->{after[0]}x{after[1]}]')


if __name__ == '__main__':
    sys.exit(main())

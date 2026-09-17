---
name: genex-tool-image
description: Generate a real image (PNG/JPEG) from a text prompt with `npx genex image` — posters, signs, logos, sprites, icons, card and item art, loading screens, decals, art for in-game screens. Pass `--transparent` for an alpha channel, `--edit` to modify an existing image, `--remove-bg` to cut a background. The file downloads to ./assets and is yours.
---

# Genex Tools · Image

Wherever the project needs a picture, this is the tool. Any style, any subject,
any aspect. It is also the tool for editing an image you already have.

## Run

```bash
npx genex image "hand-painted wooden tavern sign, weathered iron brackets"
npx genex image "chalk graffiti tag" --transparent    # alpha channel — sprites, icons, logos
```

Blocks until ready, saves the file, and prints where it went:

```
✓ Done — 1 file saved to your project:
  assets/hand-painted-wooden-tavern-sign-a1b2c3d4.png  (1.2 MB)
  source of record (provenance, not hosting): https://assets.genex.technology/...
```

Wire the **local path**. The URL is provenance — never fetch it at runtime.

## Options

- `--transparent` — real alpha channel. Use for sprites, icons, logos, decals, anything that sits on top of the game rather than inside a frame. Combines with `--quality` and `--size`: a hero wordmark can ask for `--quality high` on an exact canvas, while a plain sprite is fine on the default mid tier. Not with `--candidates` — this lane cuts the background after generating and that is billed per image, so generate candidates with `--quality`/`--size`, pick one, then cut it with `--clean <url>`.
- `--edit <path|url>` — modify THIS image with the prompt. Takes a local file (≤4 MB) or a previous generation's URL, so a reference screenshot goes straight into the chain.
- `--inpaint <mask>` — with `--edit`, a PNG mask whose TRANSPARENT hole is the region to change. Targets where the edit lands; the whole image still re-renders and alpha is destroyed, so re-run `--remove-bg` afterwards if you need it.
- `--remove-bg` — cut the background after generating or editing.
- `--bg-mode <sprite|glyph|sheet|matte>` — which removal model. `matte` gives soft alpha for hair, glow and smoke edges.
- `--clean <url>` — remove the background of an existing image, no generation.
- `--upscale <url>` — 2× an existing image.
- `--aspect <ratio>` · `--size <WxH>` · `--quality <low|medium|high>` — framing and fidelity.
- `--candidates <2-4>` — several variants in ONE call, so you pick instead of re-rolling. Needs `--quality` or `--size`.
- `--open` — also open it in a browser, for something the user must look at and approve.
- `--out-dir <dir>` — where the file lands (default `./assets`).
- `--no-download` — print the URL only, save nothing.
- `--no-wait` — enqueue and return; pick it up later with `npx genex wait <id>`.

## Cost

From **4 credits** per image at default quality (1 credit = $0.01);
`--transparent`, `--quality high`, `--edit` and 4K canvases cost more, and
`--candidates` bills per variant - the command prints the exact quote. Live
prices and your balance: `npx genex doctor`.

## Waiting

`--no-wait` returns a generation id immediately. Attach to it with
`npx genex wait <id>` — that never bills. **Re-running the image command creates
(and bills) a NEW image**, so never use it to "check on" one that is running.

## Troubleshooting

- **Out of credits** — the error prints your balance, the price, and when credits refill. Say that plainly to the user; don't retry.
- **"Email not verified"** — the printed link unlocks the free credits; generation works right after.
- **Anything else** — `npx genex doctor` reports sign-in, credits, and whether the image lane is live on this account.
- A prompt that keeps producing the wrong thing is a prompt problem, not a lane problem — name the subject, the medium and the framing concretely ("vintage travel poster, screen-printed, three flat colours"), rather than adding adjectives.

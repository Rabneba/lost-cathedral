---
name: genex-tool-video
description: Generate a short video (mp4) from a text prompt with `npx genex video` — menu backdrops, cutscene beats, animated logos, in-game screens, seamless ambient loops like fog, embers, rain or flowing water. Can animate from a still frame you already have, and loop seamlessly. The file downloads to ./assets.
---

# Genex Tools · Video

Short motion clips: a menu backdrop, a cutscene beat, an animated wordmark, an
in-game screen, or an ambient loop (fog, embers, drifting dust, water).

## Run

```bash
npx genex video "slow drifting fog over wet cobblestones, embers rising"
npx genex video "candle flame flickering in the dark" --loop
```

Blocks until ready, saves the mp4 into `./assets`, and prints the path. Wire the
local path — a shipped build must never fetch the URL at runtime.

Every clip carries a **native stereo audio track** (score, foley, ambience).
Browsers only autoplay muted video, so keep the `<video>` element muted unless
the sound is the point — and route it through your game's volume control.

## Animating a still

The strongest results come from conditioning on an image you already approved,
so the video inherits art you have already agreed on rather than reinventing it:

```bash
npx genex image "misty citadel at dusk, cinematic wide shot" --aspect 16:9
npx genex video "camera drifts slowly forward, banners stirring" --frame ./assets/misty-citadel-....png
```

- `--frame <path|url>` — animate FROM this frame back to itself, i.e. a seamless loop. Local file (≤ 4 MB) or a previous generation's URL.
- `--start-frame <path|url>` — continue from this frame, no end anchor — the clip-chaining primitive.
- `--first-frame <path|url>` / `--last-frame <path|url>` — a two-frame motion between them. All frame anchors take local files.

Frame anchors are **compositional guidance, not pixel-pinning** — the model
repaints the frame (same scene and composition, not the same pixels), and
regenerating doesn't change that. Chained clips (a cutscene sequence, a
branching video story) stay coherent when each clip starts from the previous
clip's REAL last frame, so drift never accumulates:

```bash
ffmpeg -sseof -0.2 -i ./assets/prev.mp4 -update 1 -q:v 1 last.png
npx genex video "she turns and walks toward the far door" --start-frame last.png
```

Write chained prompts as CHANGE ONLY — the start frame already says everything
else. Cut clip-to-clip, or crossfade ~200 ms to hide the residual repaint.

## Options

- `--duration <sec>` — target clip length, 5–15 seconds (default 5; clips bill
  per second).
- `--loop` — a seamless loop.
- `--resolution <480p|768p|2k|4k>` — default 768p (the top native mode). `2k`/`4k` upscale the same base at ~2–3× the cost; `480p` is the opt-down for clips where fidelity genuinely does not matter. Loop clips ignore it.
- `--ref <path|url>` — repeatable, up to 9 subject/style reference images, cited in the prompt as "Image 1"…"Image N" — the way one character or art style holds across many clips. Cannot combine with `--frame`/`--loop`.
- `--open` — also open it in a browser, for something the user must approve.
- `--out-dir <dir>` — where the file lands (default `./assets`).
- `--no-download` — print the URL only.
- `--no-wait` — enqueue and return; pick it up with `npx genex wait <id>`.

## Cost

From **23 credits** for a 5 s 768p clip (1 credit = $0.01); longer clips, 2K/4K
and `--frame` menu loops cost more, and the command prints the exact quote
before it waits. Live prices and your balance: `npx genex doctor`.

## Waiting

Video is minutes, not seconds. Prefer `--no-wait` and pick the result up with
`npx genex wait <id>` while you build something else. **Re-running the video
command bills a NEW clip** — it is never a way to check on one already running.

## Troubleshooting

- **It failed** — video fails server-side more often than any other lane, and every attempt is minutes. The CLI counts failures in this folder and tells you when to stop: after the second, use a still image instead and say so in one plain line. A third attempt bills the same and returns the same.
- **"Prompt rejected"** — the content-safety filter; never retryable with the same wording. The measured false-positive class is anatomy being pierced or entered (cables/wires/needles into a body — biomech vocabulary trips it). Describe the object or machine instead: "a statue-like figure threaded into the wall" passes where "cables entering her spine" fails.
- **Out of credits** — the error prints balance, price and refill date. Relay it; don't retry.
- **Anything else** — `npx genex doctor` reports sign-in, credits, and whether the video lane is live.

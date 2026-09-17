---
name: genex-tool-audio
description: Generate game audio as mp3 files with `npx genex sfx` (sound effects — impacts, pickups, UI clicks, weapons, ambience), `npx genex music` (one looping instrumental track) and `npx genex voice` (a short spoken line from a cast of archetypes). Files download to ./assets and are yours to ship.
---

# Genex Tools · Audio

Three lanes, one file format (mp3), one destination (`./assets`).

## Sound effects

```bash
npx genex sfx "punchy laser zap"
npx genex sfx "heavy wooden door creaking open" --duration 3
```

`--duration <sec>` targets a clip length; leave it off and the model decides.
Generate each sound separately — one prompt, one sound.

## Music

```bash
npx genex music "brooding orchestral battle loop, seamless, no intro or outro"
npx genex music "sparse ambient synth pads" --duration 120
```

ONE looping instrumental track is the shape this lane is built for.
`--duration` is 10–300 seconds, default 90. Say "seamless loop, no intro or
outro" in the prompt — a track that opens with a flourish is unusable on repeat.

Reuse the same track quieter for a menu rather than generating a second one, and
give the player Music and SFX volume sliders: a loop with no volume control is
the first thing a person turns off by closing the tab.

## Voice

```bash
npx genex voice "You shall not pass!" --voice gruff
npx genex voice "Systems nominal." --voice-id <raw-voice-id>
```

- `--voice <archetype>` — `narrator` (default), `heroine`, `gruff`, `elder`, `robot`, `imp`.
- `--voice-id <id>` — any raw provider voice id, past the curated cast.

Billed per submitted character and hard-capped at 1000, so split longer copy
into separate lines. Voice lines are content: keep them short, subtitle them,
and let the player skip.

## Shared options

`--out-dir <dir>` (default `./assets`) · `--no-download` (URL only) ·
`--no-wait` (enqueue, pick up with `npx genex wait <id>`).

## Cost

From **2 credits** an sfx · **27** a 90 s music track · **2** a short voice line
(voice bills per character, up to 12 at the 1000-character cap; 1 credit = $0.01).
Longer `--duration`s cost more. Live prices and your balance: `npx genex doctor`.

## Waiting

`--no-wait` returns an id. `npx genex wait <id>` picks it up and never bills;
**re-running a generate command bills a new asset.**

## Troubleshooting

- **Audio does not play on the first click** — nearly always the audio context, not the file: browsers require it to be created inside a real user gesture, and a sound fired before it exists is lost rather than queued. Create it on the first click or key press, then re-trigger whatever track was already selected.
- **Out of credits** — the error prints balance, price and refill date. Relay it; don't retry.
- **Anything else** — `npx genex doctor` reports whether the audio lanes are live on this account.

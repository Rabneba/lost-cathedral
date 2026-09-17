---
name: genex-tool-character
description: Generate a rigged, animated 3D character or creature with `npx genex character` and `npx genex creature`, then give it any move in plain words with `npx genex character animate`. Covers the guided concept-to-final flow, the one-shot direct path, the 8-way locomotion set, and searching the ready-made animation library. Files download to ./assets.
---

# Genex Tools · Character

A rigged humanoid body with animation clips bound to it — the player, an NPC, an
enemy. The output is a GLB with a skeleton and named clips, loadable anywhere.

For a prop, vehicle or building, use `$genex-tool-model`. For a non-humanoid
body plan (quadruped, flier, serpent) use that skill's `model rig` lane — this
one produces biped-shaped bodies.

## The guided flow (three steps, one approval each)

Use this when the character's LOOK matters and a person is choosing it:

```bash
npx genex character "stylized sci-fi courier, practical layered clothing"
# → three concept candidates. SHOW them and wait for an explicit pick.

npx genex character preview <concept-id> --candidate 2 --user-approved
# → a 3D preview of that one, four views. Show it; wait for approval.

npx genex character finalize <preview-id> --user-approved --approve-remesh 10000
# → the rigged, game-ready character at that face budget.
```

Each step needs the previous step's generation id. The approval flags are not
ceremony: they record that a person actually looked and chose, and each step
costs credits.

## The knobs (Meshy 7 on every lane)

Ultra and 4k textures are the defaults; every knob is priced in the quote.
Pick per role and say so in one line:

- `--approve-remesh <faces>` (finalize) / `--polycount <faces>` (one shot):
  the rigging copy's face budget, 10000-100000 — 10000 for crowds and
  distance, 20000-30000 for a third-person player body, 50000+ only for a
  close-up hero. Moves no cost.
- `--texture 2k|4k|8k` (preview / one shot): 8k is +5 credits, for close-ups.
- `--no-ultra` (preview / one shot): −5 credits, less surface detail — stand-ins
  and crowd enemies.
- `--pose a-pose|t-pose` (one shot): the preferred rest pose.
- `--height <metres>`: 0.5-3, default 1.7.

## One shot

When nobody is choosing — a background NPC, a quick test:

```bash
npx genex character "stylized sci-fi courier" --direct-text
npx genex creature "hulking bone seraph, upright stance"
```

`creature` is the same lane with enemy defaults: no approval steps, no player
controller pack (and priced without one). Biped-shaped bodies only. The knobs
above apply: a crowd enemy is `--polycount 10000 --no-ultra --texture 2k`.

## Import a character the user already has

```bash
npx genex character import ./knight.glb --height 1.8   # free upload + Uthana auto-rig (finger joints; --no-fingers skips them)
npx genex character animate <id> --locomotion          # then the walk/run set — an import has no clips yet
```

Biped humanoid, T- or A-pose, feet on the ground, facing +Z, `.glb` ≤ 30 MB.
**Never rebuild a mesh the user gives you** — import it. The result is a
Uthana-rigged body: verbs, `--locomotion` and `--video` work; the Meshy
catalog and controller pack do not. Non-biped bodies: `npx genex model
import` + `npx genex model rig`.

## Animating it

Say what the character should DO, in plain words — one clip per verb:

```bash
npx genex character animate <character-id> "overhead slam" "parry and recover"
npx genex character animate <character-id> --locomotion          # the 8-way walk + run set
npx genex character animate <character-id> "victory pose" --video ./take-3.mp4
npx genex character motions <character-id>                        # what is installed
```

- `--locomotion` — the full 8-direction walk and run set, 16 clips.
- `--video <file>` — use your own footage as the reference.
- `--duration 3-6` — a longer reference for a multi-beat move, so it lands instead of rushing. Bills per second.
- `--action <id|query>` — pick a ready-made clip from the library instead of generating.

`npx genex creature animate <id> "<verb>"` is the same lane for an enemy.

Free and spend-free: the command prints its PLAN before anything is charged.
Show that plan to the user when the cost matters.

## The ready-made library

```bash
npx genex animations search "rifle reload" --limit 10
```

Free. Search by gameplay intent, then bind a result with `--action <id>`. Always
look here first — a library clip costs nothing to generate.

## Cost

Typical: **32** concept · **41** preview · **29** finalize · **64** one-shot
character · **46** creature · **18** import (Uthana auto-rig; the upload is
free) · **46 per clip** for a generated move · **free** for a library search
(1 credit = $0.01). `--texture 8k` adds 6, `--no-ultra`
takes 6 off. Live prices and your balance: `npx genex doctor`.

## Waiting

Character stages take SEVERAL MINUTES server-side. Do not sit in a foreground
wait: pass `--no-wait`, keep building, then `npx genex wait --all` for one
status line each and `npx genex wait <id>` to pick one up. **Re-running a
character command bills a NEW character.**

## Troubleshooting

- **A four-legged prompt came back upright** — the rig here is biped-shaped only. Generate the body with `npx genex model` and rig it with `npx genex model rig --type quadruped` (see `$genex-tool-model`), or ship it static and animate in code.
- **Rigs rest facing +Z.** Set yaw explicitly when you place one, and never mirror a skinned mesh with a negative scale — it inverts the whole thing silently.
- **Out of credits** — the error prints balance, price and refill date. Relay it; don't retry.
- **Anything else** — `npx genex doctor`.

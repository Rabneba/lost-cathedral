---
name: genex-tool-publish
description: Put the game in this folder on the web with Genex — the draft page, `npx genex preview`, then `promote` / `publish`; the link you hand the user, the size limits, and what to do with the preflight lines. Installed once the folder is connected to a hosted Genex game (`npx genex init --convert`). Load it before the first preview.
---

# Genex Tools · Publish

The user built this game themselves and asked for it online. Your job is to
put it there **as it is** — the code, the structure and the assets stay
exactly what they are. Publishing adds glue and nothing else; it never starts
a rework, a design document or a build plan.

## The glue (all of it)

1. **A static build.** The game must build to files with its own build
   command — `npm run build` into `dist/`, or an `index.html` at the root
   with no build step. Asset paths must work from the game's own hosted URL,
   so prefer relative ones (Vite: `base: './'`). Files the game loads at
   runtime — everything in `./assets` — must end up inside the build (Vite:
   a `public/` folder, or copy `assets/` into `dist/` in the build).
2. **Player identity.** Load `$genex-threejs-embed-auth` and add the one
   `initEmbed(...)` call at the very top of the boot code. Create the
   renderer and draw a frame BEFORE any `await waitForPlayer()` — on a hosted
   page identity takes seconds, and a game that awaits it first ships black.
3. **The CLI as a dev dependency** so plain `npx genex` keeps resolving here
   (setup already did this; check `package.json` if in doubt).

Commit the glue as its own small commit when the folder is a git repo, so the
line between the user's game and what publishing added stays visible.

## Preview

```bash
npx genex preview
```

Builds, uploads and puts the build on the game's **draft page** — unlisted,
only the user can open it. When it reports live, open the hosted build once
yourself and confirm it loads with no missing files (the dev server forgives
paths the hosted build will not), then hand over the link.

**The link is always the game's page on Genex, never the raw play address,
never localhost, never a file path:**

- draft: `<dashboard>/draft/<slug>`
- public, once published: `<dashboard>/world/<slug>`

`<dashboard>` is the first `dashboardOrigins` entry in `.genex/project.json`
and `<slug>` is the `slug` there. `preview` prints the exact page link as
"your game's page" — use that line verbatim.

## The preflight is a report, not a to-do list

`preview` prints warning lines before it uploads — an estimated phone GPU
budget, a music track with no volume slider, a paid asset nobody wired, a
viewport meta line. None of them blocks the deploy, and none of them was
asked for. So: **ship first**, hand over the link, then relay each line to
the user in one plain sentence with an offer ("phones will struggle with the
textures — want me to shrink them?"). Fix one only on the user's yes. Never
turn the report into a milestone before the link.

## Draft and public version

`preview` updates the **draft** and never touches what players are on. The
first release lists the game:

```bash
npx genex publish --categories games
```

Pick 1–3 categories that fit (`games`, `assets`, `physics`, `terrain`,
`lighting`, `vfx`); `games` when unsure. Ask before the first publish — "This
is a private draft only you can open. Say the word and I'll publish it for
anyone to play." — and celebrate the public page link when it lands.

After that first release the game is two versions, and the user only ever
hears these two words for them: the **draft** (updated by `preview`) and the
**public version** (what everyone plays). "Publish it", "update it" and "yes"
after the first release ALL mean:

```bash
npx genex promote      # the exact draft build goes public — no rebuild
```

Never run `publish` a second time (it would ship an untried rebuild). If
anything changed since the last `preview`, preview again before promoting.
Ask once per round of work, in one line, and keep working while you wait.

## Limits and refusals

- **Upload size**: ~95 MB per file, ~500 MB in total. Over that, tell the user
  plainly which part is too large (usually a video, model or audio file) and by
  roughly how much; ask before compressing or removing anything.
- **Terms refusal**: the CLI prints a link, waits for the user's click and
  re-sends by itself — hand the link over and let it finish.
- **`preview` says the folder is behind another machine** (`stale_source`):
  `npx genex pull` takes the newer draft, then redo the change — never
  `--force` over somebody else's work.
- **Out of credits or a lane down**: `npx genex doctor` says which; publishing
  itself costs nothing.

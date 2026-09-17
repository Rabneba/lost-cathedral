---
name: genex-tool-workflow
description: How Genex Tools works across every lane — `npx genex doctor` to check sign-in, credits and which generation lanes are live; `npx genex wait` to pick up assets enqueued with `--no-wait`; where files land and how to wire them; what things cost and how credits work. Read this before running several generations, and whenever a command fails.
---

# Genex Tools · Workflow

The rules that apply to every lane. The per-lane cards are
`$genex-tool-model`, `$genex-tool-image`, `$genex-tool-video`,
`$genex-tool-texture`, `$genex-tool-audio`, `$genex-tool-character`.

## Check before you promise

```bash
npx genex doctor
```

Reports, in one screen: workspace, Node version, CLI version, who you are signed
in as, credit balance and refill date, and **which generation lanes are actually
live on this account**. Exit code 0 means all clear, 1 means something needs
fixing.

Run it when a command fails, and before telling the user what you can generate —
it is the only live source for prices, balance and lane status. `--json` gives
the same facts machine-readably.

## Where files go

Every finished generation downloads into `./assets` and the command prints the
local path. **Wire that path.** The URL printed beside it is provenance — where
the asset came from — not hosting: never fetch it at runtime, and never ship a
build that depends on it. The files are the user's, to move, rename, commit or
process further.

`--out-dir <dir>` puts them somewhere else. `--no-download` prints the URL and
saves nothing.

## Running several at once

This is the normal way to work, and the one rule that matters:

```bash
npx genex model "rusted fuel drum" --no-wait      # → prints a generation id
npx genex image "faded hazard decal" --no-wait
# …keep building…
npx genex wait --all                              # one status line per generation
npx genex wait <id>                               # pick one up (and download it)
```

- `--no-wait` enqueues and returns immediately with an id.
- `npx genex wait <id>` attaches to that generation, waits, and saves the file. It **never** creates or bills anything, and is safe to re-run.
- `npx genex wait --all` prints one line per generation from this folder — done, running, queued, failed. Never blocks, never bills.

**Never re-run a generate command to check on one that is already running.**
That starts, and bills, a second asset. `wait` is the only status check.

Before you finish a piece of work, run `npx genex wait --all` and wire in
everything that landed. A paid generation nobody wired in is the most common way
credits get wasted.

## Credits

One balance across everything. Typical prices: texture 3 · sfx 5 · image 8 ·
voice 10 · rig 20 · model 25 · music 40 · video 20 · character 50 · a generated
animation clip 26. **Live prices: `npx genex doctor`** — they are set
server-side and these are only typical.

- A FAILED generation is refunded automatically. You never pay for something that did not arrive.
- Out of credits is a plain refusal that prints your balance, the price, and the date credits refill. Relay those facts to the user and carry on with something else — do not retry.
- A library animation search (`npx genex animations search`) costs nothing, and neither does `wait`, `doctor`, or the plan a character animate prints before charging.

## Signing in

```bash
npx genex auth              # connect this machine
npx genex auth --force      # switch accounts
```

It prints a short link and a code; the user approves on any device. If it ends
"not approved yet", run `npx genex auth` again — it resumes the SAME code rather
than minting a confusing second one. Nothing is lost by waiting.

## Warnings are work

Every warning line the CLI prints — a texture seam, a repeated lane failure, an
unwired generation — is an actual defect it measured. Act on it or say out loud
why you are not. Treating them as noise is how a game ships with a visibly
tiling floor and three paid assets nobody loaded.

## What is not here

Hosting, publishing, multiplayer, remixing and custom domains are the Genex
platform, not this toolkit — those commands are refused in this folder by
design, and the refusal says where they live. This workspace generates assets
for a game you build and ship yourself. When the user wants that game live on
Genex with its own URL, the AGENTS.md rules say how to offer it; on a yes the
folder is connected to a hosted game in place — same cards, same rules — and
the `$genex-tool-publish` card arrives with the publishing commands.

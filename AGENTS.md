<!-- genex:contract:begin (managed by genex — edits inside this block are overwritten on sync) -->
# Genex Tools (always in effect in this folder)

This folder uses **Genex Tools**: AI asset generation for games, from your terminal. All via `npx genex …` — `model "<prompt>"` (plus `model --image <file>` from a reference photo, `model segment <id>` into named parts, `model rig <id>` across 7 body plans, `model animate <rig-id> --preset walk`) · `image` (`--transparent` · `--edit` · `--inpaint` · `--remove-bg` · `--upscale`) · `video` · `texture` · `sfx` · `music` · `voice` · rigged `character` / `creature` and `character animate <id> "<verb>"` · `animations search` · `wait <id>` / `wait --all` · `doctor`. Full options with costs: `npx genex --help`. Each tool has a skill card (`genex-tool-…`) — load the one for the lane you are using. The project and code are the user's own — Genex generates the assets, and can put the finished game live on the web when they want it. This game is also hosted on Genex: `preview` · `promote` · `publish` · `rollback` · `rename` work here (the `genex-tool-publish` card owns them).

1. **NEVER delete, empty, move, rename, or overwrite anything you did not create yourself.** This is someone's real project: it holds their code, their reference images, their notes, an earlier attempt — files that may exist nowhere else and have no undo, no trash, no backup. A non-empty folder is NORMAL and is never something to clean up, and "start clean" is never a reason. That rules out `rm`/`rm -rf`, `git clean`, `git checkout -- .`, `git reset --hard` over their work, deleting to resolve a conflict or a stuck prompt, and every tool's offer to empty a directory (`--force`, `--overwrite`, "Remove existing files"). You may add files and edit the ones you wrote. If a step genuinely cannot continue without removing something of theirs, STOP and ask, naming the exact files, and wait for a yes — "it looks like junk" is never that yes.
2. **Generated assets are local files the user owns.** Every generation downloads into `./assets/` and the command prints the local path — wire THAT path into the code, exactly like an asset they drew themselves. The URL printed beside it is provenance, not hosting: never fetch it at runtime, never ship a build that depends on it. Assets are theirs to move, rename, commit, or process further.
3. **Run `npx genex doctor` when a command fails, and before promising what you can generate.** It reports sign-in, credit balance, and which generation lanes are actually live on this account — the only live source for all three. Treat every genex warning line as work, not noise, and never re-run a generation command to "retry" one that is still running: that bills a second asset. Attach to the first with `npx genex wait <id>`.
4. **Real assets beat placeholders.** Use generated art to enrich the requested result. When making a game, that includes how it plays and how its world behaves. Reach for the belt where it adds character: distinctive models, textures, music, sounds and animated characters. Models built in code can be finished assets when they fit the style or need moving parts. Put soul into the details; never limit your imagination to what is easy to code. You know the tools and their costs (`npx genex --help`) — decide and generate on your own judgment, without stopping to ask permission; a status line saying what you queued is enough. Queue with `--no-wait` and continue any independent work on the user’s request while generations run.
5. **This game is hosted on Genex now, and publishing is glue — never a rebuild.** The game ships exactly as the user built it: `initEmbed()` first in the boot code (the `genex-threejs-embed-auth` card has the call; the renderer draws before any `await waitForPlayer()`), a static build into `dist/` with relative asset paths, then `npx genex preview`. Never restructure, reformat or "improve" the game to ship it, never scaffold a new app around it, and never start a design document or a build plan for it — the user's own process is theirs. Load the `genex-tool-publish` card before the first preview; it owns the vocabulary, the links and the limits.
6. **Ship first, then report.** `preview` prints a preflight — phone memory, a missing volume slider, an asset nobody wired, a viewport line. It never blocks a deploy, so push the build as it is, hand over the link, THEN relay each preflight line to the user in one plain sentence with an offer to fix it, and fix one only on their yes. The preflight is a report for the user, not a to-do list for you.
7. **The link is the game's page, and there are two versions.** After every preview give the user `<dashboard>/draft/<slug>` — `dashboardOrigins[0]` and `slug` from `.genex/project.json` — never localhost, a file path or the bare play origin. `preview` updates the draft and never touches what players are on; the first release is `npx genex publish` (it lists the game); after that "publish it", "update it" and "yes" all mean `npx genex promote` — the exact draft build, no rebuild. Ask once per round of work, in one line, and keep working while you wait.
<!-- genex:contract:end -->

## User approval requirements (2026-09-14)

- Obtain explicit user approval before creating visual concepts, character concepts,
  3D assets, textures, animations, audio, or other creative asset batches. This
  overrides the managed block's suggestion to generate without asking.
- Approve the generation brief first, then show the actual results for approval
  before proceeding to dependent stages. Character concept, 3D preview,
  finalization, and animation are separate approval stages.
- The user clarified that “Souls Ring” means Dark Souls. Use Dark Souls visual
  references; original/Remastered screenshots are collected in docs/references.
  Do not claim a one-to-one visual match without comparing the actual game output.
- Nonvisual gameplay code, tooling, research, and validation may proceed.
- Keep approval decisions and asset provenance in docs/asset-plan.md.
- On 2026-09-14 the user rejected the generic knight character batch and explicitly
  requested a redo using three attached references. That request authorizes revised
  character concepts only. Prior Player 1 / Boss 2 recommendations were not approved.
  The new direction requires distinctive gothic player fashion and unusual boss
  anatomy/appendages; do not constrain concept design to easy humanoid rigging.
  User-supplied reference copies are in docs/references/user-*.
- Latest approval: the user selected revised Player 1 (Thorn Exile) and Boss 1
  (Reliquary Saint) for the 3D preview stage. Generate only those selected designs.
  The player input/model MUST exclude the shield and loose trailing/torn fabric.
  Generate the shield as a separate asset; attach cloth separately through code.
  Weapons are also separate mesh assets for combat attachment. Neutral isolated
  reference preparation is part of this approved 3D work. Animation clips and
  rig/finalization remain a later review stage.

- Subsequent review: the user explicitly approved the concepts and 3D models,
  then requested discussion of the complex boss rigging approach. Record models
  as approved; discuss the boss skeleton, deformation and movement design before
  generating or implementing that rig. Animation clips remain unapproved.

- Latest approval: the user agreed to the proposed custom boss rig and explicitly
  authorized use of their local Blender installation. Build and validate that rig
  on a copy of the approved mesh, including diagnostic poses and weapon sockets.
  Full combat/locomotion animation clips remain a later approval stage.


- Latest direction: the user has set aside the many-armed Reliquary Saint because
  of animation complexity and explicitly requested new dark humanoid boss
  concepts suitable for the Meshy API. This authorizes three concept sketches
  and reference research. Preserve all previous boss assets/rigs. The approved
  player stays selected. Obtain a concept selection before a replacement 3D
  model, then model approval before rigging/animation. Target a normal human
  body with clear limbs; separate equipment and loose cloth.

- Latest concept revision: the user supplied a hooded silver-armored reference
  and asked to regenerate the boss as Death with a scythe. This explicitly
  authorizes one revised Hollow Reaper concept using that reference. Preserve
  humanoid anatomy, separate scythe and loose cloth. Replacement 3D generation,
  rigging and animation still require the next approvals.

- Latest correction: the user rejected the first armored reaper result as too
  far from their reference. Preserve the reference's hunched three-quarter
  posture, heavy hood folds, uneven bulky armor and rough materials in concept
  revisions. Do not force a symmetrical A pose or redesign the armor during
  appearance review. Body isolation and neutral rig pose preparation come
  after visual approval. The user authorized one corrective reference edit.

- Latest request: the user liked the corrected reference study and requested
  two more modest variations, keeping its mood while adding distinct armor
  elements. Replace the scythe with a separate very large, fully rusted sword
  in the same forged style, designed to look heavy and powerful. The corrected
  study is accepted as the visual starting point, not as the final 3D selection.
  This authorizes two high-quality reference edits only.

- Latest correction: the user rejected the greatsword pair as too close to the
  reference, with oversized clunky weapons that clash with the character colors.
  They explicitly requested a few new concepts using only the reference's vibe
  and retaining the pose. This authorizes three more original gothic designs
  with distinct armor, smaller refined swords, and shared cool dark-metal
  palettes. This supersedes the request for huge uniformly rusted blades and
  narrowly constrained armor edits. Preserve standard humanoid anatomy.

- FINAL CURRENT BOSS SELECTION: the user explicitly approved the original
  reference-faithful Armored Death image, generation cmu1dtozl041l2pnwiao6dh0f,
  assets/edit-the-attached-image-treat-this-chara-cmu1dtoz.png. They then
  confirmed: KEEP THE SCYTHE SHOWN. Both hands must grip it during attacks.
  Do not keep redesigning this character or substitute a sword. The user asks
  to discuss the development plan, remaining approvals and verification before
  launching new work. This approves appearance and two-handed scythe intent,
  not replacement 3D generation, rigging or animation batches. The proposed
  production plan is docs/development-plan.md; its recommendations are not yet
  user approvals. Existing Thorn Exile player assets remain approved.

- LATEST AUTONOMOUS PRODUCTION AUTHORIZATION: the user approved the full plan
  and explicitly instructed continued work to completion while away, including
  self-critique and improvements. This authorizes the remaining models, rigs,
  animations, environment, effects/audio, game implementation and validation
  within the approved character/scythe design. Do not stop for the earlier
  per-stage approval pauses. Use online Elden Ring and Dark Souls III imagery
  as visual references and record sources. Prioritize very dark, realistic
  graphics with proper anti-aliasing and bloom while preserving combat
  readability. No public publishing or messages to other people authorized.

- Rig provider update: the user explicitly selected Uthana + Blender to preserve the approved designs. Use Genex character import on normalized copies and Blender for two-handed scythe corrections; Meshy is no longer mandatory.

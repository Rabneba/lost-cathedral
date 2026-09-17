---
name: genex-threejs-embed-auth
description: Wire up player identity AND durable game state for a Genex game via @genex-ai/embed-sdk. Load this UNCONDITIONALLY for every game, multiplayer or not, BEFORE writing any boot code — every player gets an identity (signed-in account or guest); per-player saves, shared world state, and leaderboards are one-line SDK calls; multiplayer requires the SDK's token either way.
---

# Genex Three.js Embed Auth

`@genex-ai/embed-sdk` is how a Genex game learns **who is playing it** — and
how it **saves**. Every game needs it. Published games are playable by
**guests** (no account — the SDK mints a temporary identity like `Guest-1234`
automatically), while **signing in** unlocks saving/loading progress (each
player gets their own save slot) and leaderboard entries; multiplayer works
for both, using the SDK's token. The SDK handles every context with one
`initEmbed(...)` call:

- **Embedded in the Genex dashboard (an iframe):** a silent handshake signs
  the viewer in within a couple of seconds — or drops a signed-out viewer
  straight into guest play. No login screen either way.
- **Standalone (someone opens the game's link directly):** the visit bounces
  once through Genex (at the CDN edge in production, so the game only loads
  AFTER identity is resolved; the SDK does the same bounce itself in local
  dev) — signed-in visitors arrive already authenticated on ANY game with
  zero clicks; everyone else arrives as a guest with a small dismissible
  "sign in to save progress" popover (rendered by the SDK — don't build your
  own). Nobody ever hits a login wall on a published game.
- **Local test mode (your own self-testing):** `?genex_local_test=1` on the
  local dev server boots a credential-less local session — see "Self-testing
  a draft" below.

While identity is resolving (or blocked) the SDK shows its own full-screen
overlay over the game, so never build a separate "connecting" screen for auth.
Guest sessions have **no** overlay — the game just plays.

## Install

```bash
npm i @genex-ai/embed-sdk
```

(Already installed if you followed Step 3 of the scaffold; repeated here so
this skill is self-contained.)

## Bootstrap (required, every game)

```ts
// main.ts — the FIRST thing in the boot sequence, before any other game code
import { initEmbed } from "@genex-ai/embed-sdk";
import { GENEX } from "./genex.config";

initEmbed({
  slug: GENEX.slug,
  apiUrl: GENEX.apiUrl,
  dashboardOrigins: GENEX.dashboardOrigins,
});
```

**Create the renderer and draw a frame BEFORE you await identity; `await
waitForPlayer()` only where you need the name or the token.** On a hosted page
identity takes seconds (the dashboard handshake, or the standalone bounce), so
a `main.ts` whose first statement is `const { user } = await waitForPlayer()`
shows black for all of them — and forever when `initEmbed()` was never called,
because nothing else resolves that promise. Renderer, scene, camera, first
frame, then the await, down where the name or the avatar is actually used.

Also give `<body>` a dark background in `index.html` (e.g.
`<body style="margin:0;background:#080a14">`) — it makes the pre-boot frame
(before any JS runs) match the SDK's own loading overlay instead of flashing
white, and every Genex surface assumes a dark canvas anyway.

Scene setup and asset loading may continue immediately after this call — auth
never blocks rendering. There are **two gates**, and picking the right one
matters:

```ts
import { waitForPlayer, waitForAuth, getColyseusAuth, getEmbedToken } from "@genex-ai/embed-sdk";

// PLAYER gate — resolves for guests AND signed-in players. Use for
// multiplayer connect() and player-name UI. This is the gate almost
// everything wants.
const { user, guest } = await waitForPlayer();
// user.id / user.name — real account identity, or guest:<id> / "Guest-1234"
// user.avatarUrl — the player's OWN VRM avatar (profile pick; per-session for
// guests). It is the FALLBACK body, not the game's character: pass it to
// loadPlayerCharacter({ avatarUrl: user.avatarUrl }) and it is used only when
// this game has no generated character of its own, with the baked
// ./assets/avatar.vrm behind it (absent on old APIs / local test mode).
// Peers resolve the same way via the multiplayer SDK's player.avatarUrl.

// ACCOUNT gate — resolves ONLY for signed-in players (stays pending for
// guests; resolves later if they sign in mid-game). Use ONLY for /state
// saving/loading and other account-bound features.
const { user: account } = await waitForAuth();
```

**NEVER gate scene boot or `connect()` on `waitForAuth()`** — for a guest it
stays pending forever and your game would sit empty. `waitForPlayer()` is the
boot-path gate; `waitForAuth()` guards saves only.

## API surface (exact — do not invent methods)

- `initEmbed({ slug, apiUrl, dashboardOrigins })` — call once, first. All three
  fields required (from `genex.config.ts`).
- `waitForPlayer()` → `Promise<{ user, guest }>` — THE gate for `connect()`
  and player-name UI; resolves for guests and accounts alike, rejects only if
  the session ends up blocked.
- `waitForAuth()` → `Promise<{ user }>` — the gate for `/state` calls and
  account-bound features. Stays PENDING for guests (resolves live if they
  sign in); rejects if blocked. Catch rejections and let the SDK's overlay
  handle the UX (don't build your own sign-in UI).
- `isEmbedded()` → `boolean` — structural "is in an iframe" check; NOT the same
  question as "is signed in".
- `getAuthState()` → `"pending" | "authenticated" | "guest" | "blocked"` —
  synchronous.
- `getUser()` → `{ id, name, image? } | null` — non-null once authenticated OR
  guest. Guest ids are prefixed `guest:` (local test mode: `local:test`).
- `getEmbedToken()` → `string | undefined` — the raw token, for the RARE
  advanced case of calling the Genex API by hand. The state/leaderboard
  helpers below attach it automatically — prefer them; never hand-roll fetch
  calls to `/state` endpoints.
- `getColyseusAuth()` → `{ embedToken } | undefined` — relay credential
  (REQUIRED; guest tokens are accepted). Pass `auth: () => getColyseusAuth()`
  to both `connect()` and `matchmake()` so each explicit connect and every
  automatic re-seat reads a fresh token. Tokens rotate automatically (~every
  10 minutes). Never cache the value across joins and never log it.
- `on(event, cb)` → unsubscribe fn. Events: `"authenticated"`, `"guest"`,
  `"blocked"`, `"error"`. A mid-game sign-in fires `"authenticated"` after
  `"guest"` — progress saving can start right then, no reload.

Durable state + leaderboards (all six are safe to call from boot — they wait
for identity internally, never throw for guests, and reject only when the
session is blocked):

- `loadPlayerState()` → `Promise<{ data, version, guest? }>` — THIS player's
  own save (per-player, per-game; other players can never read or overwrite
  it). `{ data: null, version: 0 }` when they never saved.
- `savePlayerState(data, { ifVersion? }?)` → `Promise<{ saved, version?,
  conflict?, guest?, queued? }>` — save any JSON ≤ 256KB to their slot. For
  guests the value is QUEUED in memory and auto-flushed if they sign in
  mid-game — no extra code. Small saves survive tab close automatically.
- `loadWorldState()` / `saveWorldState(data, { ifVersion? }?)` — the game's
  ONE shared world slot (≤ 1MB, every player reads/writes the same blob) —
  level layouts, persistent-world object positions. Multiplayer games: only
  the host writes it (see the multiplayer skill). Always pass `ifVersion`
  here (shared slot = real races); a losing write resolves
  `{ conflict: true, version }` — reload, merge, retry.
- `submitScore(score, { board?, mode? }?)` → `Promise<{ submitted, best?,
  improved?, guest?, queued? }>` — keep-best leaderboard submit (`mode:
  "min"` for lap-time boards). Guests: best value queues, flushes on sign-in.
- `getLeaderboard({ board?, limit?, order? }?)` → `Promise<{ items, me }>` —
  top entries (verified display names — never trust client-side name input
  for this) + the signed-in player's own `{ rank, score }`. Works for guests
  too (`me: null`). `limit` caps at 100 server-side. Local test mode resolves
  `{ items: [], me: null }` locally.

Server write limits (per player, per minute): **60 player-saves, 120
world-saves, 30 score submits**. A debounced ~1/sec checkpoint never gets near
them — only a save-per-frame loop does (it surfaces as HTTP 429).

Runtime generation (SDK 0.21.0+, signed-in production play, default-off service):

- `getGenerationModels()` returns configured models and personal providers.
  A 404 means this environment has not enabled generation.
- `generate({ estimateCoins, modelId, prompt, outputFormat: 'text' | 'json',
  schema?, allowExternal?, idempotencyKey?, timeoutMs? })` returns execution,
  output/source on success, and charged/reserved coin plus authoritative USD.
  Call directly from a click before any await to reserve its trusted popup.
- Required `estimateCoins` is the fixed price of a started attempt, despite its
  name: fixed 5 charges 5 even if usage would cost 2. New `declared-v1` quotes
  charge that full price on failure, cancellation or a budget limit after work
  starts. No model work is zero; an unsuccessful attempt with verified zero model
  cost is also uncharged. A usable result is not guaranteed. Every API
  model requires a positive price, including Gemini and GLM. Personal funding
  selected in the trusted Genex modal remains zero coin.
- `getGeneration(id)` reads the private player/game-scoped receipt;
  `waitForGeneration(id)` waits for execution. A timeout does not cancel.
  Keep reading while billing is pending; unknown expense retains the hold and
  missing receipt fields never mean zero. Saved consumed/legacy policies remain.

Registered workflows require an existing trusted, operator-registered executor:

- `getWorkflowOfferings(workflowId)` supplies model, bundle, availability,
  suggested prices and frozen operator tariff. Calibrate the game's fixed price
  with development benchmarks, then show coin and USD beside the selected option.
  Its public offerings contain paid API/model rows;
  personal plan funding appears only in the trusted Genex approval modal.
- `requestWorkflow({ workflowId, offeringId, input, estimateCoins, allowExternal?,
  idempotencyKey?, timeoutMs? })` returns **approval**, not completion. Call from
  the click, then send its generation ID, exact input and fresh `getEmbedToken()`
  to the game backend to claim/enqueue. Waiting for completion first deadlocks it.
- Persist input, declared price, offering, operation key and generation ID across
  reloads. Never persist the token or auto-charge on boot. Use
  `resumeWorkflow(generationId)` from a click to reopen saved approval through
  GET only, preserving pre-0.21 quotes without a replacement price.
  Already-approved zero-price API requests retain their terms; an old unconfirmed
  zero-price API quote needs a fresh price review before coin approval.
- The server derives the hard model budget from the fixed price after its tariff.
  Only the selected model runs. The trusted executor validates staged artifacts;
  the browser cannot submit costs, settle a bill or claim delivery.

Both APIs with `allowExternal: true` can offer a configured personal plan beside
coins: Claude for Claude models, ChatGPT for ChatGPT models, and neither for
other model families. Keep this choice in the trusted Genex approval modal; never
render a "Your Plan" entry in the game's model picker. Each costs zero, uses that
player's own plan limits and never falls back to paid work. Approved personal
requests retain their connector for recovery; historical personal-only offerings
cannot become free coin execution. Submitted results are `source: 'external'` and
`modelProvenance: 'unverified'`; never treat them as authority for rewards.
Genex handles connector setup; games never collect subscription credentials.

For calibration, server-only `@genex-ai/embed-sdk/development` uses your full
creator bearer credential, owned project and explicit `maxCoins` to benchmark
actual usage against your own wallet, with no production-play token. It uses
`consumed-v1`, including failed work, and returns charged coins, output and
actual/unknown provider cost. All API models are paid at the normal
tariff here; personal-only options are refused. Never bundle a creator credential
or expose it through Vite variables. Read `$genex-monetization` for generic and
registered-workflow examples. Native WebViews and local-test player identity
still cannot use public generation confirmation.

## Saving progress (per-player — every player has their own slot)

Use the SDK helpers; never hand-roll fetch calls to the state API. Progression,
inventory, unlocks — anything about ONE player — goes in their player slot:

```ts
import { loadPlayerState, savePlayerState } from "@genex-ai/embed-sdk";

// boot: load whatever this player saved last time (fine for guests — resolves
// { data: null, guest: true } instead of failing)
const { data } = await loadPlayerState();
applyProgress(data ?? defaultProgress());

// checkpoints / level-ups: fire-and-forget, DEBOUNCED (not per frame)
void savePlayerState(progress);
```

Guests need zero special handling: their saves queue in memory and auto-flush
the moment they sign in mid-game (so a guest's progress follows them into
their new account), and `waitForAuth()` resolving is the signal that a real
account now exists. The SDK already tells guests to sign in (its popover / the
dashboard's card) — don't add another prompt.

**Per-player vs world:** `savePlayerState` is each player's own progress;
`saveWorldState` is the game's ONE shared world (persistent-world layouts —
see the multiplayer skill's persistence section for the host-writes pattern).
Never store per-player progression in the world slot: every player of the
game shares that single blob.

## Leaderboards

```ts
import { submitScore, getLeaderboard } from "@genex-ai/embed-sdk";

// on game over / lap complete — keep-best, so just submit every run
void submitScore(finalScore);                            // higher is better
void submitScore(lapMs, { board: "laps", mode: "min" }); // lower is better

// render a top-10 + the player's own rank
const { items, me } = await getLeaderboard({ limit: 10 });
```

Scores are per-account (one row per player per board, real display names from
their Genex account) and keep-best — submitting a worse score changes nothing
(`improved: false`). Guests can READ leaderboards; their submits queue and
post when they sign in. Send a consistent `mode` per board. Scores are
client-reported (arcade-style trust) — don't present them as anti-cheat.

## NEVER log the tokens

**NEVER log the return value of `getEmbedToken()` or `getColyseusAuth()` — not
to `console.log`, not to a crash-reporter or analytics breadcrumb.** The token
is bounded (15 minutes, one game, one scope), but third-party logging-service
retention can outlive that. Nothing in normal game code ever needs to print it.

## Config wiring (already done — do NOT hand-write URLs)

**`genex init` already wrote the config files** — do not create or edit them,
and NEVER hardcode an environment URL anywhere in game code:

- `src/genex.config.ts` — a static env-reader (production URL defaults,
  overridable via `VITE_GENEX_*` env vars). Import `GENEX` from it as shown
  above; treat the file as read-only.
- `.env` — `VITE_GENEX_SLUG` (the game's identity; committed).
- `.env.development.local` — present only when init ran against a local/dev
  stack: URL overrides that apply in `npm run dev` ONLY. A production build
  (`vite build`) always uses the production defaults, so localhost values can
  never ship. Gitignored via `*.local` — never commit it.

If `src/genex.config.ts` is somehow missing (e.g. it was deleted), re-run
`genex init` in the project folder rather than writing one by hand.

## Standalone behavior (what to expect, not something to code)

Opening a published game's link directly (not from the dashboard) shows a
brief "Loading…" overlay while the SDK round-trips through Genex once, then
the game starts: already-signed-in visitors come back authenticated (zero
clicks — on every game), everyone else comes back playing as a guest with the
SDK's own top-right "sign in to save progress" popover. The return trip
carries a one-time pass (or an inert guest marker) in the URL that the SDK
consumes and removes immediately. Unpublished drafts are the exception:
strangers can't play them, so a draft link shows the SDK's sign-in gate
instead (for self-testing, see local test mode below). Don't code around any
of this: no `?`/`#` URL params of yours will be affected, and `isEmbedded()`
/ the return-trip handling are internal SDK concerns.

### Self-testing a draft: local test mode

An unpublished draft shows the sign-in gate to any browser that isn't signed
in as the owner — **including your own test browser** (Playwright, headless
Chrome) — and the hosted draft URL applies the same identity rule. The one
supported way to see and play the game yourself is **local test mode**: open
the local dev server with the explicit opt-in marker —

```
http://localhost:5173/?genex_local_test=1
```

(any port; append with `&` if the URL already has a query). On an exact http
loopback origin (`localhost`, `127.0.0.1`, `[::1]`) the SDK skips the
identity flow entirely and boots a guest-like session: no redirect, no
overlay, `waitForPlayer()` resolves with the unmistakable local identity
`{ id: "local:test", name: "Local Tester" }`, and the console prints a
"local test mode" notice. Requires `@genex-ai/embed-sdk` 0.5.0+ — on an older
project the marker does nothing; apply the pending platform update first (any
`genex` command prints the update nudge and how to apply it), then retry.

**It validates:** rendering, camera, controls, HUD, game feel, and real
gameplay screenshots — everything local.

**It does NOT validate** (nothing online exists in this mode; no credential
is ever minted): real sign-in (`waitForAuth()` stays pending, exactly like a
guest), saves (they queue in memory), leaderboards (`getLeaderboard()`
resolves `{ items: [], me: null }` locally), score submits, and multiplayer
(`getColyseusAuth()` is `undefined`, so `connect()` fails at the relay —
expected in this mode, not a bug to chase).

Rules:

- **Label the evidence** in your handoff: "validated in local test mode —
  auth, saves, and multiplayer not exercised." Presenting a local-test
  capture as full validation is an over-claim.
- Pointer lock still can't be acquired headlessly (`requestPointerLock`
  throws in headless Chromium): for aim games validate the unlocked "click
  to aim" cue and the wiring, not the lock itself (see
  `$genex-threejs-visual-validation` step 6).
- The marker is inert on any hosted URL, on https, and inside any iframe —
  local test mode cannot open the hosted draft; hosted draft access stays
  owner-only. Do NOT work around that gate: no undocumented URL fragments,
  no auth mocks, and never drive the user's own signed-in browser.
- Opening localhost WITHOUT the marker keeps the normal real-auth flow (the
  identity bounce) — that's for testing real sign-in, not for self-testing.
- The owner's draft run-through stays a required beat, not a fallback: push
  `genex preview` at each playable milestone and hand it off plainly ("check
  the draft — you can now X; ping me if something feels off"), then keep
  building while they look. Hosted QA catches what local test mode can't:
  real identity, saves, multiplayer, feel. Once the game is **published**,
  any fresh browser gets in as a guest, so full visual validation also works
  without the marker.

## Checklist

- [ ] `initEmbed(...)` is the very first call in `main.ts`, with all three
      config fields.
- [ ] `genex.config.ts` includes `dashboardOrigins` (from `.genex/project.json`).
- [ ] Multiplayer and player-name UI await `waitForPlayer()` — NEVER
      `waitForAuth()` (guests would hang forever). Both `connect()` and
      `matchmake()` receive `auth: () => getColyseusAuth()`.
- [ ] Saves/loads use the SDK helpers (`savePlayerState`/`loadPlayerState` for
      per-player progress, `saveWorldState`/`loadWorldState` for the shared
      world, `submitScore`/`getLeaderboard` for scores) — no hand-rolled fetch
      to `/state` endpoints, no manual guest gating (the helpers own it).
- [ ] Per-player progression lives in the PLAYER slot, never in the shared
      world slot.
- [ ] Saves are debounced (checkpoints/level-ups), not per-frame.
- [ ] No token value is ever logged or sent to analytics.
- [ ] No custom sign-in prompt, guest badge, or auth overlay — the SDK popover/
      overlay and the dashboard own all of that UX.
- [ ] Self-test evidence captured in local test mode is labeled as such in the
      handoff ("local test mode — auth, saves, and multiplayer not exercised").

## Troubleshooting

- **Game loads then immediately navigates away (standalone/local dev)** — the
  identity bounce, working as designed for EVERY standalone visit. It returns
  to the game automatically (signed-in or as a guest) within a second.
- **`waitForAuth()` never resolves** — the player is a GUEST; that's the
  designed behavior. Anything that must run for guests belongs behind
  `waitForPlayer()` instead.
- **State is `"blocked"` / `waitForPlayer()` rejects** — an unpublished draft
  opened by a non-owner, or auth infrastructure was unreachable. The SDK
  overlay (or the dashboard, when embedded) shows the sign-in prompt; the game
  just stays paused behind it. Don't retry in a loop. Self-testing a draft
  locally? Use local test mode (`?genex_local_test=1`) instead.
- **Local test mode doesn't activate** — check all four: the value is exactly
  `genex_local_test=1`, the origin is http loopback (`localhost`/`127.0.0.1`/
  `[::1]` — not https, not a LAN IP), the page is not inside an iframe, and
  `@genex-ai/embed-sdk` is 0.5.0+ (older: apply the pending platform update).
- **Multiplayer `connect()` fails in local test mode** — by design: no relay
  credential exists there. Validate multiplayer on the hosted draft (the
  owner's session) or the published game, and say plainly when it wasn't.
- **Multiplayer join rejected with 401** — the join ran before
  `waitForPlayer()` resolved, without `auth: () => getColyseusAuth()`, or with a
  stale cached token on reconnect (read it fresh each call).
- **Multiplayer join rejected with 403 "guest capacity"** — the room is at its
  guest limit; only signing in gets the player a seat right now. Surface the
  relay's message as-is.
- **`/state` returns 401/403 (hand-rolled fetch)** — missing `Authorization`
  header (401), a guest token (403 `guest_no_save`), or the token belongs to a
  different game (403). All three mean the code bypassed the SDK helpers —
  switch to `savePlayerState`/`saveWorldState`, which handle every case.
- **Saves or score submits return 429** — writing too often (per-player limits:
  60 player-saves/min, 120 world-saves/min, 30 score submits/min). Debounce to
  ~1 write/sec at checkpoints and never save in the render loop; back off a
  second and retry.
- **`saveWorldState` resolves `{ conflict: true }`** — another player wrote the
  shared slot since your last read. Expected under concurrency: reload with
  `loadWorldState()`, merge, retry with the fresh `version`. If it happens
  constantly, more than one client is acting as the writer — in multiplayer,
  only the host should save the world.

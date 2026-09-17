/**
 * The player's two-hit light combo and the hold-for-heavy input, as pure rules.
 *
 * Chaining (consumed by the encounter rules in encounter.js and combat.js):
 *   - A second attack input while `light` plays queues a follow-up: a light input becomes
 *     `light2`, a heavy input becomes `heavy`. Both are accepted anywhere inside the light's
 *     chain window, which by default is the whole clip (a natural double tap lands inside the
 *     first cut's windup; rejecting it means the combo never happens for a fast tap-tap). A
 *     manifest may narrow it with `chainOpen` seconds.
 *   - `light2` starts at the light's chain point and cancels the rest of its recovery. The point
 *     is `chainAt` seconds from the manifest (measured where the second cut's first frame is
 *     continuous with the first cut's recovery) or, failing that, the moment when
 *     CHAIN_RECOVERY_LEFT of the recovery is still ahead. An input that arrives after the chain
 *     point starts `light2` immediately.
 *   - A queued `heavy` starts when the light ends: its cocked windup pose matches the light's
 *     guard finish (measured tip delta 0.24 m) and not its mid-recovery (0.57 m).
 *   - Whiffing chains too; there is no third hit; a queued follow-up is dropped when the player
 *     is hit (the action is replaced) and its stamina is checked when queued and when it starts.
 *   - Follow-ups exist only on a bundle whose manifest carries `light2` (V18+); on V17 and earlier
 *     an attack input during an attack is refused exactly as before.
 *
 * Hold-for-heavy (consumed by main.js): a press starts a hold; release before HOLD_SECONDS is a
 * tap (`light`, at release); crossing HOLD_SECONDS while still held is `heavy`, at the threshold,
 * without waiting for the release. The tap therefore arrives up to HOLD_SECONDS late; K stays an
 * instant heavy.
 */
export const CHAIN_RECOVERY_LEFT = .36;
export const HOLD_SECONDS = .22;

/** Base timing of the second hit; a manifest `light2` entry overrides it clip by clip. The
 * geometry-gated encounter ignores `reach` (it uses swept blade contact); combat.js uses it. */
export const LIGHT2_TIMING = Object.freeze({windup: .28, active: .22, recovery: .42, damage: 70, cost: 22, reach: 2.8});

const FOLLOW_UPS = Object.freeze({light: Object.freeze({light: 'light2', light2: 'light2', heavy: 'heavy'})});

export function actionLength(spec) {
  return spec.duration ?? spec.windup + spec.active + spec.recovery;
}

function hitEnd(spec) {
  const window = spec.hitWindows?.[0];
  return Number.isFinite(window?.[1]) ? window[1] : spec.windup + spec.active;
}

/** Which follow-up an attack input maps to while `current` plays; null when it cannot chain. */
export function followUp(current, request) {
  return FOLLOW_UPS[current]?.[request] ?? null;
}

/** Seconds into `spec` at which `follow` may start. */
export function chainPoint(spec, follow = 'light2') {
  const end = actionLength(spec);
  if (follow === 'heavy') return end;
  if (Number.isFinite(spec.chainAt)) return Math.min(end, Math.max(0, spec.chainAt));
  const cut = hitEnd(spec);
  return Math.min(end, cut + (end - cut) * (1 - CHAIN_RECOVERY_LEFT));
}

/** [open, close) seconds during which a follow-up input is accepted. */
export function chainWindow(spec) {
  const end = actionLength(spec);
  return [Math.min(end, Math.max(0, spec.chainOpen ?? 0)), end];
}

/** Adds the `light2` timing to a player timing table when the motion manifest carries the clip;
 * a bundle without it (V17 and earlier) simply has no combo. */
export function withComboTimings(timings, metadata = {}) {
  const clip = metadata.clips?.light2;
  if (!clip) return timings;
  timings.light2 = {...LIGHT2_TIMING, ...clip};
  return timings;
}

/** Tap-or-hold state for one attack button (J and the left mouse button share it). */
export class AttackInput {
  constructor({holdSeconds = HOLD_SECONDS} = {}) {
    this.holdSeconds = holdSeconds;
    this.since = null;
  }

  get holding() { return this.since !== null; }

  /** Button down at `time` (seconds). Returns nothing: the decision waits for the release or the threshold. */
  press(time) {
    if (this.since === null) this.since = time;
  }

  /** Button up at `time`: 'light' when the press was a tap, null when the hold already fired or nothing was held. */
  release(time) {
    if (this.since === null) return null;
    const held = time - this.since;
    this.since = null;
    return held < this.holdSeconds ? 'light' : null;
  }

  /** Call every frame with the current time: 'heavy' once the threshold is crossed while held. */
  update(time) {
    if (this.since === null || time - this.since < this.holdSeconds) return null;
    this.since = null;
    return 'heavy';
  }

  cancel() { this.since = null; }
}

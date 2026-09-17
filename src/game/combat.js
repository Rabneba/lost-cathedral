/**
 * Renderer-independent encounter rules. Times are in seconds and distances in
 * metres. Visual poses and animation assets are intentionally outside this module.
 */
import { LIGHT2_TIMING, followUp, chainPoint, chainWindow } from './player-combo.js';

export const RULES = Object.freeze({
  step: 1 / 120,
  playerHealth: 100,
  bossHealth: 900,
  stamina: 100,
  staminaRegen: 25,
  staminaDelay: 0.65,
  flasks: 3,
  healAmount: 45,
});

const PLAYER_ACTIONS = Object.freeze({
  light: { cost: 22, windup: 0.18, active: 0.14, recovery: 0.32, damage: 65, reach: 2.8 },
  // The second hit of the light combo; only reachable by chaining (player-combo.js).
  light2: { cost: LIGHT2_TIMING.cost, windup: 0.12, active: 0.14, recovery: 0.3, damage: LIGHT2_TIMING.damage, reach: LIGHT2_TIMING.reach },
  heavy: { cost: 38, windup: 0.52, active: 0.2, recovery: 0.55, damage: 120, reach: 3.1 },
  dodge: { cost: 28, windup: 0, active: 0.48, recovery: 0.16 },
  heal: { cost: 0, windup: 0.85, active: 0, recovery: 0.45 },
});

const BOSS_ACTIONS = Object.freeze({
  sweep: { windup: 0.8, active: 0.2, recovery: 0.85, damage: 26, reach: 4.1 },
  slam: { windup: 1.15, active: 0.18, recovery: 1.25, damage: 42, reach: 4.8 },
  thrust: { windup: 0.6, active: 0.15, recovery: 0.7, damage: 32, reach: 6.2 },
});

const copy = (value) => structuredClone(value);
const duration = (spec) => spec.windup + spec.active + spec.recovery;

export class Encounter {
  constructor() {
    this.restart();
  }

  restart() {
    this.state = {
      time: 0,
      status: 'ready',
      player: { health: RULES.playerHealth, stamina: RULES.stamina, flasks: RULES.flasks, action: null },
      boss: { health: RULES.bossHealth, phase: 1, action: null },
    };
    this.staminaDelay = 0;
    this.bossCooldown = 1.2;
    this.bossAttackIndex = 0;
    this.remainder = 0;
    this.events = [];
    return this.snapshot();
  }

  start() {
    if (this.state.status !== 'ready') return false;
    this.state.status = 'fighting';
    return true;
  }

  snapshot() {
    return copy(this.state);
  }

  drainEvents() {
    return this.events.splice(0);
  }

  request(actionName) {
    const spec = PLAYER_ACTIONS[actionName];
    const player = this.state.player;
    if (this.state.status !== 'fighting') return false;
    if (player.action) return this.queueFollowUp(actionName);
    // light2 is the combo's second hit and only starts by chaining.
    if (!spec || actionName === 'light2') return false;
    if (player.stamina < spec.cost || (actionName === 'heal' &&
      (player.flasks === 0 || player.health >= RULES.playerHealth))) return false;

    player.stamina -= spec.cost;
    if (spec.cost > 0) this.staminaDelay = RULES.staminaDelay;
    if (actionName === 'heal') player.flasks--;
    player.action = { name: actionName, elapsed: 0, resolved: false };
    this.events.push({ type: 'player-action', action: actionName });
    return true;
  }

  /** A second attack input while an attack plays: queue its follow-up (see player-combo.js). */
  queueFollowUp(actionName) {
    const player = this.state.player, action = player.action;
    const follow = followUp(action.name, actionName), spec = follow && PLAYER_ACTIONS[follow];
    if (!spec || action.queued || player.stamina < spec.cost) return false;
    const [open, close] = chainWindow(PLAYER_ACTIONS[action.name]);
    if (action.elapsed < open || action.elapsed >= close) return false;
    action.queued = follow;
    this.events.push({ type: 'player-chain', action: follow });
    if (action.elapsed >= chainPoint(PLAYER_ACTIONS[action.name], follow)) this.beginChained(0);
    return true;
  }

  /** Start the queued follow-up; `carry` is the fixed-step overshoot past the chain point. */
  beginChained(carry) {
    const player = this.state.player, name = player.action.queued, spec = PLAYER_ACTIONS[name];
    if (!spec || player.stamina < spec.cost) { player.action.queued = null; return false; }
    player.stamina -= spec.cost;
    this.staminaDelay = RULES.staminaDelay;
    player.action = { name, elapsed: carry, resolved: false, chained: true };
    this.events.push({ type: 'player-action', action: name, chained: true });
    return true;
  }

  get invulnerable() {
    const action = this.state.player.action;
    return action?.name === 'dodge' && action.elapsed >= 0.06 && action.elapsed < 0.38;
  }

  /**
   * Caller supplies geometric hit checks; default values support headless tests.
   * A live scene can provide a function so geometry is sampled at every step.
   */
  update(seconds, geometry = {}) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid elapsed time');
    if (this.state.status !== 'fighting') return this.snapshot();
    // Discard long tab-suspension gaps instead of simulating unavoidable damage.
    this.remainder += Math.min(seconds, 0.25);
    while (this.remainder + 1e-10 >= RULES.step && this.state.status === 'fighting') {
      this.remainder -= RULES.step;
      const sample = typeof geometry === 'function' ? geometry() : geometry;
      this.tick(RULES.step, {
        distance: sample.distance ?? 3,
        playerFacing: sample.playerFacing ?? true,
        bossFacing: sample.bossFacing ?? true,
      });
    }
    return this.snapshot();
  }

  tick(dt, geometry) {
    const { player, boss } = this.state;
    this.state.time += dt;
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);
    if (!player.action && this.staminaDelay === 0) {
      player.stamina = Math.min(RULES.stamina, player.stamina + RULES.staminaRegen * dt);
    }

    this.advancePlayer(dt, geometry);
    if (this.state.status !== 'fighting') return;
    if (boss.health <= RULES.bossHealth / 2 && boss.phase === 1) {
      boss.phase = 2;
      this.events.push({ type: 'phase-change', phase: 2 });
    }

    if (boss.action) {
      this.advanceBoss(dt, geometry);
    } else {
      this.bossCooldown -= dt;
      if (this.bossCooldown <= 0 && geometry.distance <= 7) {
        const sequence = boss.phase === 1 ? ['sweep', 'slam', 'sweep'] : ['thrust', 'sweep', 'slam'];
        const name = sequence[this.bossAttackIndex++ % sequence.length];
        boss.action = { name, elapsed: 0, resolved: false, speed: boss.phase === 2 ? 1.18 : 1 };
        this.events.push({ type: 'boss-tell', action: name });
      }
    }
  }

  advancePlayer(dt, geometry) {
    const { player, boss } = this.state;
    const action = player.action;
    if (!action) return;
    const spec = PLAYER_ACTIONS[action.name];
    action.elapsed += dt;
    if (!action.resolved && action.elapsed >= spec.windup) {
      if (action.name === 'heal') {
        player.health = Math.min(RULES.playerHealth, player.health + RULES.healAmount);
        action.resolved = true;
        this.events.push({ type: 'heal', health: player.health });
      } else if (spec.damage && action.elapsed < spec.windup + spec.active &&
        geometry.distance <= spec.reach && geometry.playerFacing) {
        boss.health = Math.max(0, boss.health - spec.damage);
        action.resolved = true;
        this.events.push({ type: 'boss-hit', damage: spec.damage });
        if (boss.health === 0) this.finish('victory');
      }
    }
    if (this.state.status !== 'fighting') return;
    const at = action.queued ? chainPoint(spec, action.queued) : Infinity;
    if (action.elapsed >= at) this.beginChained(action.elapsed - at);
    else if (action.elapsed >= duration(spec)) player.action = null;
  }

  advanceBoss(dt, geometry) {
    const { player, boss } = this.state;
    const action = boss.action;
    const spec = BOSS_ACTIONS[action.name];
    action.elapsed += dt * action.speed;
    if (!action.resolved && action.elapsed >= spec.windup && action.elapsed < spec.windup + spec.active &&
      geometry.distance <= spec.reach && geometry.bossFacing) {
      action.resolved = true;
      if (this.invulnerable) {
        this.events.push({ type: 'evade', action: action.name });
      } else {
        player.health = Math.max(0, player.health - spec.damage);
        player.action = null;
        this.events.push({ type: 'player-hit', damage: spec.damage });
        if (player.health === 0) this.finish('defeat');
      }
    }
    if (action.elapsed >= duration(spec)) {
      boss.action = null;
      this.bossCooldown = boss.phase === 2 ? 0.35 : 0.7;
    }
  }

  finish(status) {
    this.state.status = status;
    this.state.player.action = null;
    this.state.boss.action = null;
    this.events.push({ type: status });
  }
}

import {BOSS_TIMING,createActionTimings,actionDuration} from './weapon-motion.js';
import {slideGround} from './ground-collision.js';
import {actorDimensions} from './actor-scale.js';
import {actionTravelAt,compileTravelCurve,facingTravelDirection} from './action-travel.js';
import {bossEngagement} from './engagement-range.js';
/** Ground-plane movement rules, with no rendering or animation dependencies. */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const length = (v) => Math.hypot(v.x, v.z);
const normalized = (v) => {
  const magnitude = length(v);
  return magnitude > 1e-8 ? { x: v.x / magnitude, z: v.z / magnitude } : { x: 0, z: 0 };
};

/** yaw=0 means looking down -Z; diagonal input has the same speed as forward. */
export function cameraRelativeDirection({ forward = 0, right = 0, cameraYaw = 0 } = {}) {
  const input = normalized({ x: clamp(right, -1, 1), z: clamp(forward, -1, 1) });
  return {
    x: input.x * Math.cos(cameraYaw) - input.z * Math.sin(cameraYaw),
    z: -input.x * Math.sin(cameraYaw) - input.z * Math.cos(cameraYaw),
  };
}

/** Combat retreat and lateral travel use the shorter strides' natural pace.
 * Squared heading alignment keeps speed continuous through diagonal sectors.
 */
export function runSpeedForDirection(direction,yaw,metadata={}) {
  const forward=metadata.locomotionSpeed??4.2,magnitude=length(direction);
  if(magnitude<1e-8)return forward;
  const alignment=clamp((direction.x*Math.sin(yaw)+direction.z*Math.cos(yaw))/magnitude,-1,1);
  const side=metadata.strafeSpeed??forward,along=alignment>=0?forward:metadata.retreatSpeed??forward;
  return side+(along-side)*alignment*alignment;
}

/** Roll entry: the body turns into the requested heading this quickly, rate limited.
 * `seconds` is the target, but the rate is capped: the user asked for the character to
 * "turn into the desired direction through a transition", and a fixed 0.12 s made the whip
 * worse the bigger the turn -- a locked back roll span 180 degrees at 1375 deg/s, eight
 * frames for a half turn, which reads as a spin rather than a transition. At `maxRate` a
 * quarter turn still takes 0.13 s and a half turn 0.26 s, well inside the roll's own 1 s.
 * Travel follows `dodge.direction` and is unaffected by how fast the body gets there. */
export const ROLL_TURN={seconds:.12,minRate:6,maxRate:12};
/** After the clip the lock-on facing takes over again; it eases in over this long so
 * the character reads as standing up and then turning, rather than snapping round. */
export const ROLL_RECOVERY={seconds:.28,startRate:4.5};
export const LOCK_ON_TURN_RATE=9;
/** The last few degrees of a lock-on turn ease out to `floor` of the rate, so the body
 * settles onto the boss rather than whipping to a halt on the frame it arrives. */
export const LOCK_ON_SETTLE={arc:.3,floor:.16};
/** Turns bigger than `from` (a locked back roll ends a half-turn out, and only a forward-roll
 * clip exists) come round up to `gain` faster, so the recovery does not drag. */
export const LOCK_ON_SWEEP={from:1.2,gain:.9};

/** The yaw the player must face for the clip's authored travel to run along `direction`. */
export function rollHeading(direction,clipDirection='forward'){
  return Math.atan2(direction.x,direction.z)+(clipDirection==='backward'?Math.PI:0);
}

export function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Facing convention matches generated rigs: local +Z is forward. */
export function facesTarget(actor, target, arc = Math.PI * 0.85) {
  const direction = normalized({ x: target.x - actor.x, z: target.z - actor.z });
  if (length(direction) === 0) return true;
  return Math.sin(actor.yaw) * direction.x + Math.cos(actor.yaw) * direction.z >= Math.cos(arc / 2);
}

export class MotionState {
  constructor({ bounds = { minX: -10, maxX: 10, minZ: -16, maxZ: 16 }, approachDistance = 3.2, animationMetadata = {}, groundColliders = [] } = {}) {
    this.bounds = { ...bounds };
    this.approachDistance = approachDistance;
    this.animationMetadata = animationMetadata;
    this.rangedBoss=[1,2].some(phase=>bossEngagement(animationMetadata.boss,phase).ranged);
    this.playerTimings=createActionTimings(animationMetadata.player);
    for(const spec of Object.values(this.playerTimings))if(spec.travelCurve){
      compileTravelCurve(spec.travelCurve);facingTravelDirection(0,spec.direction);
      if(spec.travelCurve.at(-1)[0]>actionDuration(spec)+1e-6)throw new RangeError('travelCurve cannot extend beyond its action duration');
    }
    this.dimensions={player:actorDimensions(false,animationMetadata.player),boss:actorDimensions(true,animationMetadata.boss)};
    this.bodySeparation=this.dimensions.player.bodyRadius+this.dimensions.boss.bodyRadius+.05;
    this.groundColliders = groundColliders;
    this.reset();
  }

  reset() {
    this.player = { x: 0, z: 8, yaw: Math.PI };
    this.boss = { x: 0, z: -4, yaw: 0 };
    this.dodge = null;
    this.actionTravel = null;
    this.rollRecovery = 0;
    this.bossSpeed = 0;
    this.velocities = {player:{x:0,z:0},boss:{x:0,z:0}};
  }

  /** Call only after the encounter accepts a dodge action.
   * A held direction rolls that way, locked on or not: the body turns into the
   * camera-relative heading over about a tenth of a second and the authored roll
   * then travels along it. With nothing held the roll keeps its old behaviour --
   * the clip's own direction along the current facing, a step back without a clip.
   */
  beginDodge(input) {
    // A buffered dodge can be accepted in the same tick the prior one ends,
    // before step() has observed the intervening no-action state.
    const requested = cameraRelativeDirection(input);
    const authoredDirection=this.animationMetadata.player?.clips?.dodge?.direction;
    const clipDirection=authoredDirection==='backward'?'backward':'forward';
    let direction,heading;
    if (length(requested) > 0) {
      direction=requested;
      heading=rollHeading(direction,clipDirection);
    } else {
      direction=facingTravelDirection(this.player.yaw,authoredDirection==='forward'?'forward':'backward');
      heading=this.player.yaw;
    }
    this.actionTravel=null;
    const turn=Math.abs(Math.atan2(Math.sin(heading-this.player.yaw),Math.cos(heading-this.player.yaw)));
    const turnRate=turn>1e-4?clamp(turn/ROLL_TURN.seconds,ROLL_TURN.minRate,ROLL_TURN.maxRate):0;
    this.dodge = { direction, heading, turnRate, elapsed: 0 };
    return true;
  }

  /** Lock-on facing rate, eased in while the character recovers from a roll, and eased out
   * again over the last few degrees so the body settles onto the boss instead of arriving at
   * full speed and stopping dead in one frame. A turn of more than LOCK_ON_SWEEP (a back roll
   * ends 180 degrees out) is also allowed to come round faster, so the recovery is not slow.
   */
  lockOnTurnRate(error = Math.PI) {
    let rate = LOCK_ON_TURN_RATE;
    if (this.rollRecovery > 0) {
      const progress=1-this.rollRecovery/ROLL_RECOVERY.seconds;
      rate=ROLL_RECOVERY.startRate+(LOCK_ON_TURN_RATE-ROLL_RECOVERY.startRate)*progress;
    }
    const remaining=Math.abs(error);
    rate*=1+LOCK_ON_SWEEP.gain*clamp((remaining-LOCK_ON_SWEEP.from)/(Math.PI-LOCK_ON_SWEEP.from),0,1);
    return rate*(LOCK_ON_SETTLE.floor+(1-LOCK_ON_SETTLE.floor)*clamp(remaining/LOCK_ON_SETTLE.arc,0,1));
  }

  /** Signed angle from the actor's facing to `target`, in [-pi, pi]. */
  facingError(actor,target) {
    if (horizontalDistance(actor,target)<=1e-8) return 0;
    const desired=Math.atan2(target.x-actor.x,target.z-actor.z);
    return Math.atan2(Math.sin(desired-actor.yaw),Math.cos(desired-actor.yaw));
  }

  step(dt, input, encounter) {
    if (!Number.isFinite(dt) || dt < 0 || dt > 0.25) throw new RangeError('Use a step between 0 and 0.25 seconds');
    if (encounter.status !== 'fighting' || dt === 0) return;
    const bossStart={x:this.boss.x,z:this.boss.z};

    const action = encounter.player.action?.name;
    const spec=encounter.timings?.player?.[action]||this.playerTimings[action];
    // A finished roll hands the facing back to lock-on, which eases in over
    // ROLL_RECOVERY so standing up and turning read as two beats, not a snap.
    if (action !== 'dodge') { if (this.dodge) this.rollRecovery=ROLL_RECOVERY.seconds; this.dodge = null; }
    this.rollRecovery=Math.max(0,this.rollRecovery-dt);
    const direction = cameraRelativeDirection(input);
    if(spec?.travelCurve){
      // Uthana may strip root travel. Apply the measured displacement at the
      // same action time as the rendered pose, with no rigid-body rotation.
      // A directional roll travels along its own heading, not the pre-roll facing.
      const token=encounter.player.action;
      if(this.actionTravel?.action!==token)this.actionTravel={action:token,time:0,direction:action==='dodge'&&this.dodge?this.dodge.direction:facingTravelDirection(this.player.yaw,spec.direction)};
      const travel=this.actionTravel,now=Number.isFinite(token.elapsed)?Math.max(travel.time,token.elapsed):travel.time+dt;
      this.move(this.player,travel.direction,actionTravelAt(spec,now)-actionTravelAt(spec,travel.time),this.dimensions.player.groundRadius);
      // Consume blocked travel too: releasing a wall must never replay it.
      travel.time=now;this.velocities.player={x:0,z:0};
    } else if (this.dodge) {
      this.actionTravel=null;
      // Integrate the displacement curve analytically for stable dodge distance.
      const spec=encounter.timings?.player.dodge||this.playerTimings.dodge;
      const previous = actionTravelAt(spec,this.dodge.elapsed);
      this.dodge.elapsed += dt;
      const distance = actionTravelAt(spec,this.dodge.elapsed)-previous;
      this.move(this.player, this.dodge.direction, distance, this.dimensions.player.groundRadius);
      this.velocities.player={x:0,z:0};
    } else {
      this.actionTravel=null;
      const runningSpeed=input.lockOn?runSpeedForDirection(direction,this.player.yaw,this.animationMetadata.player):this.animationMetadata.player?.locomotionSpeed??4.2;
      // These full-body actions have authored planted feet. Continuing a walk
      // underneath them made the model glide; only the incoming velocity settles.
      const speed = !action ? (encounter.player.blocking ? this.animationMetadata.player?.guardSpeed??1.45 : runningSpeed) : 0;
      this.moveWithAcceleration(this.player,this.velocities.player,direction,speed,dt,this.dimensions.player.groundRadius);
    }

    // Allow aiming during anticipation, then commit the planted strike.
    const playerTiming=encounter.timings?.player?.[action];
    const canSteer=!spec?.travelCurve&&(!action||(playerTiming?.windup&&encounter.player.action.elapsed<playerTiming.windup*.65));
    // The roll owns the facing while it plays: turn into the requested heading and hold
    // it, so the authored tumble runs straight down the direction the stick asked for.
    if (action==='dodge'&&this.dodge?.turnRate>0) {
      this.turn(this.player,this.dodge.heading,dt,this.dodge.turnRate);
    } else if (canSteer) {
      if (input.lockOn) this.face(this.player, this.boss,dt,this.lockOnTurnRate(this.facingError(this.player,this.boss)));
      else if (length(direction) > 0) this.turn(this.player, Math.atan2(direction.x, direction.z),dt,8);
    }

    if (!encounter.boss.action) {
      this.face(this.boss, this.player,dt,this.animationMetadata.boss?.idleTurnRate??1.7);
      const delta = { x: this.player.x - this.boss.x, z: this.player.z - this.boss.z };
      const distance = length(delta);
      const baseSpeed=this.animationMetadata.boss?.locomotionSpeed??.9;
      // The walk has its own phase-two multiplier: the clip rate is clamped at 1.4x, so the attack speed-up must not drag the gait into sliding.
      const phaseRate=encounter.boss.phase===2?(this.animationMetadata.boss?.phaseTwoWalkMultiplier??this.animationMetadata.boss?.phaseTwoSpeedMultiplier??1.08):1;
      const heading={x:Math.sin(this.boss.yaw),z:Math.cos(this.boss.yaw)};
      const toward=normalized(delta),alignment=Math.max(0,heading.x*toward.x+heading.z*toward.z);
      // Same selection state as the fight (recent attacks, punishment, forced opener), so an attack the
      // fight will refuse never reads as "usable here" and leaves the boss standing out of range.
      const engagement=bossEngagement(this.animationMetadata.boss,encounter.boss.phase,distance,encounter.attackIndex??0,encounter.selectionContext?.()??{});
      const target=engagement.ranged?engagement.targetDistance:this.approachDistance;
      const speed=target!==null&&distance>target?baseSpeed*phaseRate*alignment:0;
      const step=this.acceleratedDisplacement(this.velocities.boss,heading,speed,dt,6);
      // On entering a useful band, decelerate within it rather than sliding
      // backwards or oscillating between the band edges. The lower limit
      // protects eligibility while the small incoming velocity settles.
      const stopAt=engagement.ranged?(engagement.eligible.length?Math.max(...engagement.eligible.map(entry=>entry.range[0])):target??distance):this.approachDistance;
      this.move(this.boss,normalized(step),Math.min(length(step),Math.max(0,distance-stopAt)),this.dimensions.boss.groundRadius);
    } else {
      this.velocities.boss={x:0,z:0};
    }

    const tell = (encounter.timings?.boss||BOSS_TIMING)[encounter.boss.action?.name];
    if (tell?.windup && encounter.boss.action.elapsed < tell.windup * .65) {
      const desired = Math.atan2(this.player.x - this.boss.x, this.player.z - this.boss.z);
      const delta = Math.atan2(Math.sin(desired - this.boss.yaw), Math.cos(desired - this.boss.yaw));
      this.boss.yaw += clamp(delta, -2.4 * dt, 2.4 * dt);
    }

    // Resolve body overlap without allowing either actor through arena bounds.
    for (let pass = 0; pass < 3; pass++) {
      const delta = { x: this.player.x - this.boss.x, z: this.player.z - this.boss.z };
      const distance = length(delta);
      if (distance >= this.bodySeparation) break;
      const axis = distance > 1e-8 ? normalized(delta) : { x: 0, z: 1 };
      // A committed boss is not pushed across the arena by forward player input.
      // Only move it if the arena edge prevents the player from separating.
      this.move(this.player, axis, this.bodySeparation - distance, this.dimensions.player.groundRadius);
      const remaining=Math.max(0,this.bodySeparation-horizontalDistance(this.player,this.boss));
      if(remaining>1e-6)this.move(this.boss,{x:-axis.x,z:-axis.z},remaining,this.dimensions.boss.groundRadius);
    }
    this.bossSpeed=horizontalDistance(bossStart,this.boss)/dt;
  }

  move(actor, direction, distance, radius) {
    slideGround(actor,{x:direction.x*distance,z:direction.z*distance},radius,this.bounds,this.groundColliders);
  }

  acceleratedDisplacement(velocity,direction,speed,dt,response=12) {
    const decay=Math.exp(-response*dt),step={x:0,z:0};
    for(const axis of ['x','z']){
      const target=direction[axis]*speed;
      step[axis]=target*dt+(velocity[axis]-target)*(1-decay)/response;
      velocity[axis]=target+(velocity[axis]-target)*decay;
    }
    return step;
  }

  moveWithAcceleration(actor,velocity,direction,speed,dt,radius){
    const step=this.acceleratedDisplacement(velocity,direction,speed,dt,length(direction)>0?12:18);
    this.move(actor,normalized(step),length(step),radius);
  }

  turn(actor,desired,dt,maxRate){
    const delta=Math.atan2(Math.sin(desired-actor.yaw),Math.cos(desired-actor.yaw));
    actor.yaw+=clamp(delta,-maxRate*dt,maxRate*dt);
  }

  face(actor, target,dt=1,maxRate=Infinity) {
    if (horizontalDistance(actor, target) > 1e-8) this.turn(actor,Math.atan2(target.x - actor.x, target.z - actor.z),dt,maxRate);
  }

  geometry() {
    // The player's position in the boss's facing frame (round 3, the fissure): `along` metres ahead of the boss
    // down its facing, `lateral` metres to its left (+) or right (-). Rigs face +Z, so the heading is (sin, cos).
    const dx=this.player.x-this.boss.x,dz=this.player.z-this.boss.z,hx=Math.sin(this.boss.yaw),hz=Math.cos(this.boss.yaw);
    return {
      distance: horizontalDistance(this.player, this.boss),
      playerFacing: facesTarget(this.player, this.boss),
      bossFacing: facesTarget(this.boss, this.player, this.rangedBoss?Math.PI/3:Math.PI),
      bossSpeed: this.bossSpeed,
      along: dx*hx+dz*hz,
      lateral: dx*hz-dz*hx,
      playerRadius: this.dimensions.player.bodyRadius,
    };
  }
}

import {AnimationMixer, LoopOnce, LoopRepeat, MathUtils} from 'three';

const locomotion = name => /^(walk|run)-/.test(name);
const smooth = t => t * t * (3 - 2 * t);

/** One normalized blend, even when input changes again before a fade finishes.
 * Gameplay owns action time; loop clocks are independent and preserve foot phase.
 */
export class ActorAnimation {
  constructor(root, clips, metadata = {}) {
    this.mixer = new AnimationMixer(root);
    this.metadata = metadata;
    this.actions = new Map(clips.map(clip => [clip.name, this.mixer.clipAction(clip)]));
    this.reset();
  }

  reset() {
    this.mixer.stopAllAction();
    this.layers = new Map();
    this.current = null;
    this.token = null;
    this.transition = null;
    this.rate = 1;
    this.yawOffset = 0;
  }

  update(dt, requestedName, {action = null, duration, speed = 0, token = action} = {}) {
    const name = this.actions.has(requestedName) ? requestedName : 'idle';
    const target = this.actions.get(name);
    if (!target) return;
    const meta = this.metadata.clips?.[name] || {};
    const changed = name !== this.current;
    const restarted = !!action && token !== this.token && !action.directClipTime;
    if (changed || restarted) {
      const old = this.layers.get(this.current);
      const phase = old && locomotion(this.current) && locomotion(name)
        ? old.time / old.action.getClip().duration : 0;
      let layer = this.layers.get(name);
      if (!layer) {
        target.reset().setLoop(action ? LoopOnce : LoopRepeat, action ? 1 : Infinity).play();
        target.clampWhenFinished = true;
        target.paused = true;
        // A clip captured with the performer turned away from camera carries its own
        // stance yaw; blending it with the weights keeps transitions free of snaps.
        layer = {action: target, weight: 0, time: phase * target.getClip().duration, rate: meta.rate ?? 1, oneShot: !!action, yaw: MathUtils.degToRad(meta.facingYawDegrees ?? 0)};
        this.layers.set(name, layer);
      }
      if (restarted) layer.time = 0;
      layer.oneShot = !!action;
      const blend = Math.max(.025, meta.blendIn ?? (action ? .12 : .24));
      this.transition = {elapsed: 0, duration: blend, starts: new Map([...this.layers].map(([key, value]) => [key, value.weight]))};
      // The first pose should have full weight, rather than fade out of the bind pose.
      if (!this.current) { layer.weight = 1; this.transition = null; }
      this.current = name;
      this.token = token;
    }
    if (this.transition) {
      this.transition.elapsed += action?.directClipTime ? this.transition.duration : dt;
      const progress = Math.min(1, this.transition.elapsed / this.transition.duration);
      const alpha = smooth(progress);
      for (const [key, layer] of this.layers) {
        layer.weight = MathUtils.lerp(this.transition.starts.get(key) || 0, key === name ? 1 : 0, alpha);
      }
      if (progress === 1) this.transition = null;
    }
    const sourceSpeed = meta.sourceSpeed ?? this.metadata.locomotionSpeed;
    const desiredRate = locomotion(name) && sourceSpeed > 0
      ? MathUtils.clamp(speed / sourceSpeed, .5, 1.4) * (meta.rate ?? 1) : (meta.rate ?? 1);
    this.rate = MathUtils.damp(this.rate, desiredRate, 10, dt);
    this.yawOffset = 0;
    for (const layer of this.layers.values()) this.yawOffset += layer.weight * layer.yaw;
    for (const [key, layer] of this.layers) {
      if (!this.transition && key !== name) {
        layer.action.stop();
        this.layers.delete(key);
        continue;
      }
      const clipDuration = layer.action.getClip().duration;
      if (key === name && action) {
        // A baked slow clip is already timed. Never multiply the approved idle by .25 again.
        const actionDuration = duration ?? meta.duration ?? clipDuration / (meta.rate ?? 1);
        layer.time = Math.min(clipDuration, Math.max(0, action.directClipTime ? action.elapsed : action.elapsed / actionDuration * clipDuration));
      } else {
        layer.rate = key === name ? this.rate : layer.rate;
        layer.time += dt * layer.rate;
        layer.time = layer.oneShot ? Math.min(layer.time, clipDuration) : layer.time % clipDuration;
      }
      layer.action.time = layer.time;
      layer.action.enabled = true;
      layer.action.setEffectiveWeight(layer.weight);
    }
    this.mixer.update(0);
  }

  debugState() {
    return {current: this.current, yawOffset: this.yawOffset, layers: [...this.layers].map(([name, layer]) => ({name, weight: layer.weight, time: layer.time, rate: layer.rate}))};
  }
}

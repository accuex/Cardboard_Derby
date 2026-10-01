import { damageConfig } from '../config/damage';
import { cpuLevels, pacingConfig, styleTuning, type HorseProfile } from '../config/horses';
import { physicsConfig as P } from '../config/physics';
import { clamp, Rng } from '../core/rng';
import type { Course } from './Course';
import { damageEffects } from './damage';
import { cornerLimitOf, topSpeedOf } from './HorsePhysics';
import type { HorseInput } from './input';
import type { HorsePerformance } from './performance';
import type { HorseState, RaceState } from './types';

const HORSE_LENGTH = 2.4;
const HORSE_WIDTH = 1.15;
const MIN_LATERAL = 0.8;

/**
 * CPU jockey. Reads the race like a player would and produces the same HorseInput:
 * paces by running style, brakes for corners, steers around traffic,
 * and braces when the horse starts to tip.
 */
export class CpuRider {
  readonly profile: HorseProfile;
  /** Seconds after the gate opens before the horse breaks. */
  readonly reactionDelay: number;
  private readonly form: number;
  private readonly preferredLateral: number;
  private readonly rng: Rng;
  private lastSegment = -1;
  private cornerFactor = 1;
  private dangerTime = 0;
  private bracing = false;
  private pitAsked = false;

  constructor(profile: HorseProfile, rng: Rng) {
    this.profile = profile;
    this.rng = rng;
    this.form = rng.range(-pacingConfig.formSpread, pacingConfig.formSpread);
    this.preferredLateral = styleTuning[profile.style].preferredLateral + rng.range(-0.2, 0.6);
    this.reactionDelay = rng.chance(pacingConfig.slowStartChance) ? rng.range(0.6, 1.2) : rng.range(0, 0.25);
  }

  decide(h: HorseState, perf: HorsePerformance, state: RaceState, course: Course, dt: number): HorseInput {
    if (h.status !== 'running') {
      this.bracing = false;
      this.pitAsked = false;
      return { throttle: 0, brake: 0, steer: 0, brace: false };
    }
    if (state.time < this.reactionDelay) return { throttle: 0, brake: 0, steer: 0, brace: false };

    const vmax = topSpeedOf(h, perf);
    const remaining = state.distance - h.progress;

    // Badly damaged: pull over for repairs on a straight, if there is enough race left to make it worthwhile.
    if (!h.finished && !this.pitAsked && !h.pitRequested && remaining > damageConfig.cpuPitMinRemaining && course.segmentAt(h.courseS).kind === 'straight') {
      if (damageEffects(h).minLegHealth < damageConfig.cpuPitLegHealth) {
        this.pitAsked = true;
        return { throttle: 0, brake: 0, steer: 0, brace: false, pit: true };
      }
    }
    if (h.pitRequested) return { throttle: 0, brake: 0, steer: 0, brace: false };
    const tune = styleTuning[this.profile.style];

    let throttle: number;
    if (h.finished) {
      throttle = (pacingConfig.cooldownSpeed / vmax) ** 2;
    } else {
      const lv = cpuLevels[pacingConfig.level];
      throttle = remaining <= tune.spurtDistance * lv.spurt ? 1 : clamp(tune.cruiseThrottle + this.form + lv.cruise, 0, 1);
    }
    let cap = Math.sqrt(throttle) * vmax + 1;

    // Corner speed planning
    const seg = course.segmentAt(h.courseS);
    if (seg.index !== this.lastSegment) {
      this.lastSegment = seg.index;
      if (seg.kind === 'straight') {
        // Judge the coming corner now. Riders misjudge, more often too fast than too slow.
        const err = this.profile.rider.cornerError * pacingConfig.cornerErrorScale * cpuLevels[pacingConfig.level].error;
        this.cornerFactor = 1 + this.rng.range(-0.5 * err, 1.2 * err);
      }
    }
    const R = course.config.cornerRadius;
    const safeSpeed = (lateral: number, factor: number) =>
      Math.sqrt(cornerLimitOf(h, perf, false) * (R + lateral)) * this.profile.rider.cornerMargin * cpuLevels[pacingConfig.level].margin * factor;
    if (seg.kind === 'corner') {
      cap = Math.min(cap, safeSpeed(h.lateral, this.cornerFactor));
      // Drifting wide (bumped, bent legs): ease off a little to get grip back for steering.
      if (h.lateralVelocity > 0.4) cap = Math.min(cap, safeSpeed(h.lateral, 0.95));
    } else {
      const toCorner = seg.start + seg.length - course.wrap(h.courseS);
      const entry = safeSpeed(h.lateral, this.cornerFactor);
      cap = Math.min(cap, Math.sqrt(entry * entry + 2 * pacingConfig.cornerPlanDecel * Math.max(0, toCorner - 5)));
    }

    // Danger: ease off (after a short reaction time) and maybe brace
    const traits = this.profile.rider;
    if (h.tipRisk > traits.reactRisk) this.dangerTime += dt;
    else this.dangerTime = 0;
    const lvl = cpuLevels[pacingConfig.level];
    if (this.dangerTime > traits.reactionTime * lvl.reaction) cap = Math.min(cap, h.speed * 0.95);
    if (!this.bracing && h.tipRisk > traits.reactRisk * 0.9 && this.rng.chance(traits.braceTendency * lvl.brace * dt)) this.bracing = true;
    if (this.bracing && h.tipRisk < 0.15) this.bracing = false;

    // Racing line / traffic
    let targetLateral = this.preferredLateral;
    if (!h.finished) {
      const line = this.chooseLine(h, state, Math.sqrt(throttle) * vmax);
      targetLateral = line.lateral;
      if (line.speedCap !== null) cap = Math.min(cap, line.speedCap);
    }

    let brake = 0;
    if (h.speed > cap + 0.3) {
      brake = clamp((h.speed - cap) * 0.35, 0, 1);
      throttle = 0;
    } else {
      throttle = clamp(Math.min(throttle, (cap / vmax) ** 2 + 0.2 * (cap - h.speed)), 0, 1);
    }
    // Counter-steer against the pull of bent legs (players have to do this themselves).
    let steer = clamp((targetLateral - h.lateral) * 0.9 - h.lateralVelocity * 0.6 - damageEffects(h).steerBias, -1, 1);
    if (seg.kind === 'corner') {
      // Any inward lateral acceleration adds to the cornering load: only use the headroom that is left.
      const centripetal = (h.speed * h.speed) / (R + h.lateral);
      const headroom = Math.max(0, cornerLimitOf(h, perf, false) * 0.99 - centripetal);
      const latCap = P.maxLateralSpeed * clamp(h.speed / 6, 0.3, 1);
      steer = Math.max(steer, (h.lateralVelocity - headroom / P.lateralResponse) / latCap);
    }
    return { throttle, brake, steer, brace: this.bracing };
  }

  /** Follow the preferred line, go around slower or fallen horses, get boxed in otherwise. */
  private chooseLine(h: HorseState, state: RaceState, desiredSpeed: number): { lateral: number; speedCap: number | null } {
    const blocker = this.findAhead(h, state);
    if (blocker && (desiredSpeed > blocker.speed + 0.05 || blocker.status !== 'running')) {
      const inside = blocker.lateral - HORSE_WIDTH * 1.35;
      const outside = blocker.lateral + HORSE_WIDTH * 1.35;
      if (inside >= MIN_LATERAL && this.laneFree(h, state, inside)) return { lateral: inside, speedCap: null };
      if (this.laneFree(h, state, outside)) return { lateral: outside, speedCap: null };
      // Boxed in: brake so we arrive behind the blocker at its speed.
      return { lateral: h.lateral, speedCap: this.arrivalCap(h, blocker) };
    }
    const step = clamp(this.preferredLateral - h.lateral, -1.5, 1.5);
    if (Math.abs(step) > 0.05 && !this.laneFree(h, state, h.lateral + step)) return { lateral: h.lateral, speedCap: null };
    return { lateral: this.preferredLateral, speedCap: null };
  }

  /** Speed we could still arrive at behind `o` if we braked now. */
  private arrivalCap(h: HorseState, o: HorseState): number {
    const gap = o.progress - h.progress - HORSE_LENGTH * 1.2;
    return Math.sqrt(o.speed ** 2 + 2 * 4 * Math.max(0, gap));
  }

  /** How far ahead `o` matters: further the faster we are closing on it. */
  private lookAhead(h: HorseState, o: HorseState): number {
    return Math.max(HORSE_LENGTH * 2, (h.speed - o.speed) * 2.5 + 4);
  }

  /** The most constraining horse in our lane ahead (a stopped horse far away can matter more than a near one). */
  private findAhead(h: HorseState, state: RaceState): HorseState | null {
    let best: HorseState | null = null;
    let bestCap = Infinity;
    for (const o of state.horses) {
      if (o === h || o.finished || o.status === 'repairing') continue;
      const gap = o.progress - h.progress;
      if (gap <= 0 || gap > Math.max(7, this.lookAhead(h, o)) || Math.abs(o.lateral - h.lateral) >= HORSE_WIDTH) continue;
      const cap = this.arrivalCap(h, o);
      if (cap < bestCap) {
        best = o;
        bestCap = cap;
      }
    }
    return best;
  }

  private laneFree(h: HorseState, state: RaceState, lateral: number): boolean {
    for (const o of state.horses) {
      if (o === h || o.finished || o.status === 'repairing') continue;
      const gap = o.progress - h.progress;
      if (gap > -HORSE_LENGTH * 1.1 && gap < this.lookAhead(h, o) && Math.abs(o.lateral - lateral) < HORSE_WIDTH) return false;
    }
    return true;
  }
}


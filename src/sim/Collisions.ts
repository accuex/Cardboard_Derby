import { physicsConfig as P } from '../config/physics';
import { damageConfig } from '../config/damage';
import type { DamageZone } from './damage';
import { hit, updateTipState, type SimContext } from './HorsePhysics';
import type { HorsePerformance } from './performance';
import type { HorseState } from './types';

const C = P.collision;

/**
 * Horse-vs-horse and horse-vs-rail contact, solved in course space
 * (progress along the track, lateral offset). Each horse is a box of
 * 2*halfLength x 2*halfWidth. Impacts cost speed, add roll and wear the structure.
 */
export class CollisionSolver {
  /** Cooldown per pair so one scrape is reported once. */
  private readonly pairCooldown = new Map<number, number>();

  constructor(private readonly ctx: SimContext) {}

  solve(horses: HorseState[], perfs: HorsePerformance[], time: number): void {
    for (let i = 0; i < horses.length; i++) {
      for (let j = i + 1; j < horses.length; j++) {
        this.pair(horses[i], horses[j], perfs[i], perfs[j], time);
      }
    }
    for (let i = 0; i < horses.length; i++) this.rails(horses[i], perfs[i]);
  }

  /** Global wear + damage to the struck parts. */
  private struck(h: HorseState, perf: HorsePerformance, zone: DamageZone, impact: number, share: number): void {
    const e = impact * impact * share;
    h.structuralFatigue = Math.min(1, h.structuralFatigue + P.fatigue.impact * e * perf.fragility);
    const I = damageConfig.impact;
    hit(h, perf, this.ctx, zone, I.joint * e, I.integrity * e, I.deform * e);
  }

  private pair(a: HorseState, b: HorseState, pa: HorsePerformance, pb: HorsePerformance, time: number): void {
    const emit = this.ctx.emit;
    if (a.finished !== b.finished) return;
    // Horses under repair have been pulled off the racing line by the crew.
    if (a.status === 'repairing' || b.status === 'repairing') return;
    const dx = b.progress - a.progress;
    const dl = b.lateral - a.lateral;
    const penX = 2 * C.halfLength - Math.abs(dx);
    const penL = 2 * C.halfWidth - Math.abs(dl);
    if (penX <= 0 || penL <= 0) return;

    const ma = pa.mass * (a.status !== 'running' ? C.fallenMassMul : 1);
    const mb = pb.mass * (b.status !== 'running' ? C.fallenMassMul : 1);
    const inv = 1 / ma + 1 / mb;
    let impact = 0;
    let zoneA: DamageZone = 'front';
    let zoneB: DamageZone = 'rear';

    if (penX / C.halfLength < penL / C.halfWidth) {
      // Nose-to-tail
      const back = dx > 0 ? a : b;
      const front = dx > 0 ? b : a;
      const mBack = dx > 0 ? ma : mb;
      const mFront = dx > 0 ? mb : ma;
      const closing = back.speed - front.speed;
      if (closing > 0) {
        const J = ((1 + C.restitution) * closing) / inv;
        back.speed = Math.max(0, back.speed - J / mBack);
        front.speed += J / mFront;
        impact = closing;
      }
      zoneA = back === a ? 'front' : 'rear';
      zoneB = back === b ? 'front' : 'rear';
      back.progress -= penX * (mFront / (mBack + mFront));
      front.progress += penX * (mBack / (mBack + mFront));
    } else {
      // Side by side
      const n = dl >= 0 ? 1 : -1; // direction from a to b
      // + lateral is the horse's right side
      zoneA = n > 0 ? 'right' : 'left';
      zoneB = n > 0 ? 'left' : 'right';
      const closing = (a.lateralVelocity - b.lateralVelocity) * n;
      if (closing > 0) {
        const J = ((1 + C.restitution) * closing) / inv;
        a.lateralVelocity -= (J / ma) * n;
        b.lateralVelocity += (J / mb) * n;
        impact = closing;
        // Scraping costs speed and shoves the body sideways (roll impulse)
        a.speed *= 1 - C.scrape * closing;
        b.speed *= 1 - C.scrape * closing;
        if (a.status === 'running') a.roll -= n * P.impactRoll * closing * (mb / (ma + mb)) * 2;
        if (b.status === 'running') b.roll += n * P.impactRoll * closing * (ma / (ma + mb)) * 2;
      }
      a.lateral -= penL * n * (mb / (ma + mb));
      b.lateral += penL * n * (ma / (ma + mb));
    }

    if (impact > 0) {
      // Hitting a fallen horse can also unsettle the runner
      for (const [h, other] of [[a, b], [b, a]] as const) {
        if (h.status === 'running' && other.status !== 'running') h.roll += (this.ctx.rng.chance(0.5) ? -1 : 1) * P.impactRoll * impact;
      }
      this.struck(a, pa, zoneA, impact, (mb / (ma + mb)) * 2);
      this.struck(b, pb, zoneB, impact, (ma / (ma + mb)) * 2);
      updateTipState(a, emit);
      updateTipState(b, emit);
      const key = a.id * 64 + b.id;
      if (impact >= C.reportImpact && (this.pairCooldown.get(key) ?? -1) < time) {
        this.pairCooldown.set(key, time + 1.5);
        a.collisions++;
        b.collisions++;
        emit('collision', a.id, { value: impact, otherId: b.id });
      }
    }
  }

  private rails(h: HorseState, perf: HorsePerformance): void {
    const minL = C.halfWidth + 0.1;
    const maxL = this.ctx.course.config.trackWidth - C.halfWidth - 0.1;
    let impact = 0;
    let zone: DamageZone = 'left';
    if (h.lateral < minL) {
      h.lateral = minL;
      if (h.lateralVelocity < 0) {
        impact = -h.lateralVelocity;
        h.lateralVelocity = impact * C.railRestitution;
      }
    } else if (h.lateral > maxL) {
      h.lateral = maxL;
      if (h.lateralVelocity > 0) {
        impact = h.lateralVelocity;
        h.lateralVelocity = -impact * C.railRestitution;
        zone = 'right';
      }
    }
    if (impact > 0) {
      h.speed *= 1 - C.railScrape * impact;
      this.struck(h, perf, zone, impact, 1);
      if (impact >= C.reportImpact * 1.5) this.ctx.emit('rail', h.id, { value: impact });
    }
  }
}

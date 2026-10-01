import { damageConfig as D } from '../config/damage';
import type { Rng } from '../core/rng';
import type { HorsePerformance } from './performance';
import type { HorseState, PartId, PartState } from './types';

export const PART_IDS: PartId[] = ['legFR', 'legFL', 'legHR', 'legHL', 'neck', 'tail', 'body'];
export const LEG_IDS: PartId[] = ['legFR', 'legFL', 'legHR', 'legHL'];
export const RIGHT_LEGS: PartId[] = ['legFR', 'legHR'];
export const LEFT_LEGS: PartId[] = ['legFL', 'legHL'];

export const partLabel: Record<PartId, string> = {
  legFR: '右前脚',
  legFL: '左前脚',
  legHR: '右後脚',
  legHL: '左後脚',
  neck: '首',
  tail: '尻尾',
  body: '胴体',
};

/** Which parts a hit lands on. Right = the horse's right = outward on a left-handed course. */
export type DamageZone = 'legs' | 'right' | 'left' | 'front' | 'rear' | 'outerLegs';

const ZONES: Record<DamageZone, PartId[]> = {
  legs: LEG_IDS,
  right: ['legFR', 'legHR', 'body'],
  left: ['legFL', 'legHL', 'body'],
  front: ['legFR', 'legFL', 'neck'],
  rear: ['legHR', 'legHL', 'tail'],
  outerLegs: RIGHT_LEGS,
};

export const newPart = (): PartState => ({ integrity: 1, maxIntegrity: 1, joint: 1, deform: 0, detached: false, tape: 0 });

export function createParts(): Record<PartId, PartState> {
  const parts = {} as Record<PartId, PartState>;
  for (const id of PART_IDS) parts[id] = newPart();
  return parts;
}

/** Health of one part, 0 (gone) .. 1. */
export function partHealth(p: PartState): number {
  if (p.detached) return 0;
  return p.integrity * (0.5 + 0.5 * p.joint) * (1 - 0.4 * p.deform);
}

export interface DamageEffects {
  topSpeedMul: number;
  cornerLimitMul: number;
  /** Constant sideways drift from bent legs (+ = outward). */
  steerBias: number;
  detachedLegs: number;
  minLegHealth: number;
}

export function damageEffects(h: HorseState): DamageEffects {
  let sum = 0;
  let min = 1;
  let detached = 0;
  for (const id of LEG_IDS) {
    const p = h.parts[id];
    const hp = partHealth(p);
    sum += hp;
    min = Math.min(min, hp);
    if (p.detached) detached++;
  }
  const avg = sum / LEG_IDS.length;
  const body = partHealth(h.parts.body);
  const deformR = RIGHT_LEGS.reduce((s, id) => s + (h.parts[id].detached ? 0 : h.parts[id].deform), 0);
  const deformL = LEFT_LEGS.reduce((s, id) => s + (h.parts[id].detached ? 0 : h.parts[id].deform), 0);
  return {
    topSpeedMul: (D.speedBase + (1 - D.speedBase) * avg) * D.detachedLegSpeed[Math.min(detached, D.detachedLegSpeed.length - 1)],
    cornerLimitMul: (D.cornerBase + (1 - D.cornerBase) * min) * (D.bodyCornerBase + (1 - D.bodyCornerBase) * body),
    steerBias: (deformR - deformL) * D.deformSteerBias,
    detachedLegs: detached,
    minLegHealth: min,
  };
}

export type PartEventSink = (type: 'tapePeel' | 'partLost' | 'deform', part: PartId) => void;

/**
 * Applies damage to a part, reporting threshold crossings.
 * `scale` already includes fragility and 疲労度UP multipliers.
 */
export function damagePart(
  h: HorseState,
  id: PartId,
  joint: number,
  integrity: number,
  deform: number,
  sink: PartEventSink,
): void {
  const p = h.parts[id];
  if (p.detached) return;
  const prevJoint = p.joint;
  const prevDeform = p.deform;
  p.joint = Math.max(0, p.joint - joint);
  p.integrity = Math.max(0, p.integrity - integrity);
  p.deform = id === 'body' ? 0 : Math.min(1, p.deform + deform);
  if (prevJoint >= D.peelAt && p.joint < D.peelAt) sink('tapePeel', id);
  if (prevDeform < D.deformAt && p.deform >= D.deformAt) sink('deform', id);
  // Body never falls off; anything else goes when the tape gives up or the cardboard is gone.
  if (id !== 'body' && (p.joint <= 0 || p.integrity <= 0)) {
    p.detached = true;
    sink('partLost', id);
  }
}

/** Spread an amount of damage over a zone, with some randomness per part. */
export function damageZone(
  h: HorseState,
  zone: DamageZone,
  joint: number,
  integrity: number,
  deform: number,
  rng: Rng,
  sink: PartEventSink,
): void {
  const ids = ZONES[zone];
  for (const id of ids) {
    const r = 1 + rng.range(-D.spread, D.spread);
    damagePart(h, id, (joint * r) / ids.length * 2, (integrity * r) / ids.length * 2, deform * r, sink);
  }
}

/** Seconds a repair will take. Light simple horses are quick, heavy reinforced ones slow. */
export function repairSeconds(h: HorseState, perf: HorsePerformance): number {
  const R = D.repair;
  let t = perf.repairBase + R.perPreviousRepair * h.repairs;
  for (const id of PART_IDS) {
    const p = h.parts[id];
    t += p.detached ? R.perDetached : R.perPartDamage * (1 - partHealth(p));
  }
  return t;
}

/** Tape it all back together. Never as good as new (修理後劣化). */
export function applyRepair(h: HorseState): void {
  const R = D.repair;
  for (const id of PART_IDS) {
    const p = h.parts[id];
    const damaged = p.detached || partHealth(p) < 0.95;
    if (!damaged) continue;
    p.maxIntegrity = Math.max(0.3, p.maxIntegrity - R.maxIntegrityLoss);
    if (p.detached) {
      p.detached = false;
      p.integrity = p.maxIntegrity * R.reattachedIntegrity;
      p.tape += 2;
    } else {
      p.integrity = p.maxIntegrity;
      p.tape += 1;
    }
    p.joint = Math.min(1, R.jointQuality ** (p.tape));
    p.deform *= R.deformKept;
  }
  h.structuralFatigue *= R.fatigueKept;
  h.repairs++;
}

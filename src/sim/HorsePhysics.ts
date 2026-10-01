import { damageConfig as D } from '../config/damage';
import { physicsConfig as P } from '../config/physics';
import { clamp, type Rng } from '../core/rng';
import type { Course } from './Course';
import {
  applyRepair,
  damageEffects,
  damagePart,
  damageZone,
  LEG_IDS,
  partHealth,
  repairSeconds,
  type DamageEffects,
  type DamageZone,
  type PartEventSink,
} from './damage';
import type { HorseInput } from './input';
import type { HorsePerformance } from './performance';
import type { HorseState, PartId, RaceEventType } from './types';

export interface EventExtra {
  value?: number;
  otherId?: number;
  part?: PartId;
}
export type EmitEvent = (type: RaceEventType, horseId: number, extra?: EventExtra) => void;

/** Shared services for physics/damage code. */
export interface SimContext {
  course: Course;
  rng: Rng;
  emit: EmitEvent;
}

/** Per-horse private physics memory that is not part of the shared state. */
export interface PhysicsMemory {
  braceHeld: number;
  braceIdle: number;
  wasBracing: boolean;
  lastPit: boolean;
  /** Speed at the moment of the last fall (decides crash vs. just getting up). */
  fallSpeed: number;
  /** A leg came off this tick. */
  legLost: boolean;
}

export const newPhysicsMemory = (): PhysicsMemory => ({
  braceHeld: 0,
  braceIdle: 0,
  wasBracing: false,
  lastPit: false,
  fallSpeed: 0,
  legLost: false,
});

/** Effective cornering limit including bracing, wear and damaged legs. */
export function cornerLimitOf(h: HorseState, perf: HorsePerformance, bracing = h.bracing, fx: DamageEffects = damageEffects(h)): number {
  return (
    perf.cornerLimit *
    (1 - P.fatigue.cornerLimitLoss * h.structuralFatigue) *
    fx.cornerLimitMul *
    (bracing ? P.brace.cornerLimitMul : 1)
  );
}

export function topSpeedOf(h: HorseState, perf: HorsePerformance, fx: DamageEffects = damageEffects(h)): number {
  return perf.topSpeed * (1 - P.fatigue.topSpeedLoss * h.structuralFatigue) * fx.topSpeedMul;
}

/** Gain multiplier from 疲労度UP stacks. */
export const fatigueMultiplier = (h: HorseState): number => 1 + P.brace.fatiguePerStack * h.fatigueStacks;

function partSink(h: HorseState, ctx: SimContext, mem: PhysicsMemory | null): PartEventSink {
  return (type, part) => {
    ctx.emit(type, h.id, { part });
    if (type === 'partLost' && LEG_IDS.includes(part) && mem) mem.legLost = true;
  };
}

/**
 * Wear: raises 構造疲労 and spreads the same amount over the parts in `zone`
 * (tape peels, cardboard softens). Scaled by fragility and 疲労度UP.
 */
export function wear(h: HorseState, perf: HorsePerformance, ctx: SimContext, amount: number, zone: DamageZone, mem: PhysicsMemory | null = null): void {
  const scaled = amount * perf.fragility * fatigueMultiplier(h);
  h.structuralFatigue = Math.min(1, h.structuralFatigue + scaled);
  damageZone(h, zone, scaled * D.wearToJoint * perf.jointWearMul, scaled * D.wearToIntegrity * perf.integrityWearMul, 0, ctx.rng, partSink(h, ctx, mem));
}

/** A direct hit on parts (collisions, falls). Amounts are before fragility/stack scaling. */
export function hit(h: HorseState, perf: HorsePerformance, ctx: SimContext, zone: DamageZone, joint: number, integrity: number, deform: number, mem: PhysicsMemory | null = null): void {
  const k = perf.fragility * fatigueMultiplier(h);
  damageZone(h, zone, joint * k * perf.jointWearMul, integrity * k * perf.integrityWearMul, deform * k, ctx.rng, partSink(h, ctx, mem));
}

/**
 * One fixed-step update of a single horse: drive, steering, cornering load, roll, tipping,
 * bracing debuffs, wear and part damage, pit stops. Collisions are handled separately.
 */
export function stepHorse(h: HorseState, perf: HorsePerformance, mem: PhysicsMemory, input: HorseInput, ctx: SimContext, dt: number): void {
  const course = ctx.course;
  h.statusTime += dt;
  if (h.status === 'repairing') {
    stepRepair(h, ctx, dt);
    return;
  }
  if (h.status !== 'running') {
    stepDown(h, perf, mem, ctx, dt);
    return;
  }

  const fx = damageEffects(h);
  const vmax = topSpeedOf(h, perf, fx);
  h.topSpeed = vmax;

  // ---- Pit request (edge-triggered toggle) ----
  const pit = !!input.pit;
  if (pit && !mem.lastPit && !h.finished) {
    h.pitRequested = !h.pitRequested;
  }
  mem.lastPit = pit;
  if (h.pitRequested) {
    // Pull over to the outside rail and stop.
    const target = course.config.trackWidth - 1.2;
    const steer = clamp((target - h.lateral) * 0.8 - h.lateralVelocity * 0.8, -1, 1);
    // Coast over at a walking pace, then stop once alongside the outside rail.
    const there = h.lateral >= target - 0.3;
    const slow = there || h.speed > 4;
    input = { throttle: slow ? 0 : 0.15, brake: slow ? 0.6 : 0, steer, brace: false };
    if (h.lateral >= course.config.trackWidth - 1.4 && h.speed < 1.2) {
      startRepair(h, perf, ctx);
      return;
    }
  }

  // ---- Longitudinal: dv/dt = a * (throttle - (v/vmax)^2) - brake ----
  const throttle = clamp(input.throttle ?? P.cruiseThrottle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  h.throttle = brake > 0 ? 0 : throttle;
  h.brake = brake;
  const ratio = h.speed / vmax;
  let dv = perf.acceleration * (h.throttle - ratio * ratio) - perf.brakeDecel * brake;
  if (h.speed < 0.5 && h.throttle === 0) dv = -P.idleDecel;
  h.speed = Math.max(0, h.speed + dv * dt);

  // ---- Lateral steering (bent legs make the horse drift) ----
  const steer = clamp(input.steer + (h.speed > 2 ? fx.steerBias : 0), -1, 1);
  const latSpeedCap = P.maxLateralSpeed * clamp(h.speed / 6, 0.3, 1);
  const latAccel = clamp((steer * latSpeedCap - h.lateralVelocity) * P.lateralResponse, -P.maxLateralAccel, P.maxLateralAccel);
  h.lateralVelocity += latAccel * dt;
  h.lateral += h.lateralVelocity * dt;

  // ---- 踏ん張る & 疲労度UP stacks ----
  updateBrace(h, mem, input.brace && !h.pitRequested, dt, ctx.emit);

  // ---- Cornering load (signed: + = pushed outward, i.e. would tip outward) ----
  const seg = course.segmentAt(h.courseS);
  const radius = course.config.cornerRadius + Math.max(0, h.lateral);
  const centripetal = seg.kind === 'corner' ? (h.speed * h.speed) / radius : 0;
  // Accelerating outward relieves the load in a left-hand corner; cutting inward adds to it.
  const lateralLoad = centripetal - latAccel;
  const limit = cornerLimitOf(h, perf, h.bracing, fx);
  h.loadRatio = lateralLoad / limit;

  // ---- Roll dynamics ----
  const mag = Math.abs(h.loadRatio);
  const sign = Math.sign(h.loadRatio) || 1;
  const lean = clamp(h.loadRatio, -1, 1) * P.leanAtLimit;
  if (mag > 1) {
    const excess = mag - 1;
    const gain = P.rollGain * (h.bracing ? P.brace.rollGainMul : 1);
    h.roll += sign * gain * (excess + P.rollGainQuadratic * excess * excess) * dt;
  } else {
    const d = lean - h.roll;
    h.roll += clamp(d, -P.rollRecovery * dt, P.rollRecovery * dt);
  }
  updateTipState(h, ctx.emit);

  // ---- Wear: vibration hits all legs, cornering mostly the loaded side ----
  const F = P.fatigue;
  const r = h.speed / perf.topSpeed;
  let legWear = F.running * r ** 4;
  if (r > F.vibrationThreshold) legWear += F.vibration * ((r - F.vibrationThreshold) / (1 - F.vibrationThreshold)) ** 2;
  wear(h, perf, ctx, legWear * dt, 'legs', mem);
  if (mag > F.cornerFrom) {
    const cw = F.cornering * (mag - F.cornerFrom) ** 2 * dt;
    const loaded: DamageZone = h.loadRatio > 0 ? 'outerLegs' : 'left';
    wear(h, perf, ctx, cw * D.outerLegShare, loaded, mem);
    wear(h, perf, ctx, cw * (1 - D.outerLegShare), 'legs', mem);
    if (mag > 1) hit(h, perf, ctx, loaded, 0, 0, (mag - 1) * D.deformRate * dt, mem);
  }

  if (Math.abs(h.roll) >= P.tipRoll || mem.legLost) fall(h, perf, ctx, mem);
}

function updateBrace(h: HorseState, mem: PhysicsMemory, wants: boolean, dt: number, emit: EmitEvent): void {
  const B = P.brace;
  h.bracing = wants;
  if (wants) {
    if (!mem.wasBracing) {
      // Every new brace costs a stack immediately.
      h.fatigueStacks = Math.min(B.maxStacks, h.fatigueStacks + 1);
      mem.braceHeld = 0;
      emit('brace', h.id, { value: h.fatigueStacks });
    }
    mem.braceHeld += dt;
    if (mem.braceHeld >= B.secondsPerStack) {
      mem.braceHeld -= B.secondsPerStack;
      if (h.fatigueStacks < B.maxStacks) {
        h.fatigueStacks++;
        emit('brace', h.id, { value: h.fatigueStacks });
      }
    }
    mem.braceIdle = 0;
  } else {
    mem.braceIdle += dt;
    if (h.fatigueStacks > 0 && mem.braceIdle >= B.stackDecaySeconds) {
      h.fatigueStacks--;
      mem.braceIdle = 0;
    }
  }
  mem.wasBracing = wants;
}

/** Updates tip risk / leg lift flags and reports the moment the legs leave the ground. */
export function updateTipState(h: HorseState, emit: EmitEvent): void {
  h.tipRisk = clamp(Math.abs(h.roll) / P.tipRoll, 0, 1);
  const lifted = Math.abs(h.roll) > P.legLiftRoll;
  if (lifted && !h.legsLifted) emit('legLift', h.id, { value: h.tipRisk });
  h.legsLifted = lifted;
}

export function fall(h: HorseState, perf: HorsePerformance, ctx: SimContext, mem: PhysicsMemory): void {
  if (h.status !== 'running') return;
  mem.legLost = false;
  mem.fallSpeed = h.speed;
  h.status = 'fallen';
  h.statusTime = 0;
  h.falls++;
  h.bracing = false;
  h.legsLifted = false;
  h.pitRequested = false;
  h.roll = Math.sign(h.roll || 1) * P.tipRoll;
  ctx.emit('fall', h.id, { value: h.speed });
  // Landing damage on the side it falls onto, plus the head/neck hitting the turf.
  const sev = clamp(h.speed / 15, 0.3, 1.2);
  const F = D.fall;
  h.structuralFatigue = Math.min(1, h.structuralFatigue + P.fatigue.fall * perf.fragility);
  hit(h, perf, ctx, h.roll > 0 ? 'right' : 'left', F.joint * sev, F.integrity * sev, F.deform * sev);
  const sink = partSink(h, ctx, null);
  damagePart(h, 'neck', F.headJoint * sev * ctx.rng.range(0.3, 1.7) * perf.jointWearMul, F.integrity * sev * 0.5 * perf.integrityWearMul, 0, sink);
}

function needsRepair(h: HorseState, mem: PhysicsMemory): boolean {
  if (mem.fallSpeed >= D.crashSpeed) return true;
  for (const id of LEG_IDS) {
    if (h.parts[id].detached || partHealth(h.parts[id]) < D.repairLegHealth) return true;
  }
  return partHealth(h.parts.body) < D.repairLegHealth;
}

export function startRepair(h: HorseState, perf: HorsePerformance, ctx: SimContext): void {
  h.status = 'repairing';
  h.statusTime = 0;
  h.speed = 0;
  h.throttle = 0;
  h.brake = 0;
  h.bracing = false;
  h.pitRequested = false;
  h.loadRatio = 0;
  h.repairTotal = repairSeconds(h, perf);
  ctx.emit('repairStart', h.id, { value: h.repairTotal });
}

/** Repair crew drags the horse to the outside of the course and tapes it back together. */
function stepRepair(h: HorseState, ctx: SimContext, dt: number): void {
  const outside = ctx.course.config.trackWidth - 0.7;
  h.speed = 0;
  h.lateralVelocity = 0;
  h.lateral = Math.min(outside, h.lateral + D.repair.dragSpeed * dt);
  // stand the horse back up during the first second
  h.roll *= Math.max(0, 1 - 3 * dt);
  h.tipRisk = 0;
  h.legsLifted = false;
  if (h.statusTime >= h.repairTotal) {
    applyRepair(h);
    h.status = 'running';
    h.statusTime = 0;
    h.roll = 0;
    ctx.emit('repairEnd', h.id, { value: h.repairs });
  }
}

/** Fallen: slide to a stop on its side, then get back up or go for repairs. */
function stepDown(h: HorseState, perf: HorsePerformance, mem: PhysicsMemory, ctx: SimContext, dt: number): void {
  h.throttle = 0;
  h.brake = 0;
  h.loadRatio = 0;
  h.speed = Math.max(0, h.speed - P.fall.slideDecel * dt);
  h.lateralVelocity *= Math.max(0, 1 - 3 * dt);
  h.lateral = clamp(h.lateral + h.lateralVelocity * dt, 0.5, ctx.course.config.trackWidth - 0.5);
  const side = Math.sign(h.roll) || 1;
  if (h.status === 'fallen') {
    // topple the rest of the way over
    h.roll = side * Math.min(Math.PI / 2, Math.abs(h.roll) + 4 * dt);
    if (h.statusTime >= perf.fallDuration && h.speed === 0) {
      if (needsRepair(h, mem)) {
        startRepair(h, perf, ctx);
        return;
      }
      h.status = 'recovering';
      h.statusTime = 0;
    }
  } else {
    const t = clamp(h.statusTime / P.fall.getUpSeconds, 0, 1);
    h.roll = side * (Math.PI / 2) * (1 - t);
    if (t >= 1) {
      h.status = 'running';
      h.statusTime = 0;
      h.roll = 0;
      h.speed = 0;
      ctx.emit('recover', h.id);
    }
  }
  h.tipRisk = h.status === 'fallen' ? 1 : clamp(Math.abs(h.roll) / P.tipRoll, 0, 1);
}

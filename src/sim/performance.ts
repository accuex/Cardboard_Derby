import { massConfig } from '../config/build';
import { damageConfig } from '../config/damage';
import type { HorseBody } from '../config/horses';
import { physicsConfig as P } from '../config/physics';

/** Static performance derived from a horse body. */
export interface HorsePerformance {
  mass: number;
  topSpeed: number;
  acceleration: number;
  brakeDecel: number;
  cgHeight: number;
  /** Lateral acceleration (m/s^2) at which the horse starts to tip. */
  cornerLimit: number;
  /** Multiplier on structural fatigue gain. */
  fragility: number;
  /** Multipliers on part damage: joints (tape) and cardboard. */
  jointWearMul: number;
  integrityWearMul: number;
  fallDuration: number;
  /** Repair time before part damage is added (s). */
  repairBase: number;
  reinforcement: number;
}

export function computeMass(body: HorseBody): number {
  const M = massConfig;
  const ballast = Math.max(0, -body.cgAdjust) * M.ballastPerMetre;
  const saving = Math.max(0, body.cgAdjust) * M.raisedSavingPerMetre;
  return (
    M.headNeckTail +
    M.torsoPerPly * body.ply +
    M.legsPerPlyAndLength * body.ply * body.legLength +
    M.perReinforcement * body.reinforcement +
    M.perTape * body.tape +
    ballast -
    saving
  );
}

/**
 * Turns body parameters into performance with natural trade-offs:
 * long legs = fast but high CG, light = quick but fragile, reinforcement = tough but heavy,
 * wide = stable but draggy, ballast = low CG but heavy.
 */
export function computePerformance(body: HorseBody): HorsePerformance {
  const mass = computeMass(body);
  const massRatio = P.refMass / mass;
  const hipHeight = 1.25 * body.legLength;
  const cgHeight = hipHeight + P.cgAboveHips + body.cgAdjust;
  const staticLimit = (P.gravity * (body.stanceWidth / 2)) / cgHeight;
  const R = damageConfig.repair;
  return {
    mass,
    topSpeed:
      P.baseTopSpeed *
      body.legLength ** P.legSpeedExponent *
      massRatio ** P.massSpeedExponent *
      (1 - P.stanceDrag * Math.max(0, body.stanceWidth - 0.5)) *
      (1 + P.raisedSpeedBonus * Math.max(0, body.cgAdjust)),
    acceleration: P.baseAcceleration * massRatio ** P.massAccelExponent,
    brakeDecel: P.baseBrakeDecel,
    cgHeight,
    cornerLimit: staticLimit * P.cornerGrip * (1 + P.reinforcementCornerBonus * (body.reinforcement - 1)),
    fragility: (1 / body.reinforcement) * massRatio ** 0.3 * (1 / body.ply) ** P.plyFragilityExponent,
    jointWearMul: (1 / body.tape) ** P.tapeJointExponent,
    integrityWearMul: (1 / body.ply) ** 0.5,
    fallDuration: P.fall.baseDuration + P.fall.perKg * mass,
    repairBase: R.baseSeconds + R.perKg * mass + R.perReinforcement * body.reinforcement + R.perTape * body.tape,
    reinforcement: body.reinforcement,
  };
}

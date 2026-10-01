/** Part damage and repair tuning (Phase 3). */
export const damageConfig = {
  /** How general wear (the same amount that feeds 構造疲労) is turned into part damage. */
  wearToJoint: 1.0,
  wearToIntegrity: 0.35,
  /** Share of wear taken by the loaded (outer) legs while cornering. */
  outerLegShare: 0.6,
  /** Deformation gained per second per unit of load ratio above 1 (outer legs). */
  deformRate: 0.12,
  /** Damage dealt by a fall, scaled by severity (speed / 15). */
  fall: { joint: 0.4, integrity: 0.25, deform: 0.15, headJoint: 0.45 },
  /** Damage per (m/s)^2 of impact speed on the struck parts. */
  impact: { joint: 0.012, integrity: 0.008, deform: 0.004 },
  /** Random spread on every hit (±). */
  spread: 0.5,

  // ---- Event thresholds ----
  peelAt: 0.5,
  deformAt: 0.3,

  // ---- Effects ----
  /** Top speed = (base + (1-base) * avgLegHealth) * detachedPenalty[detachedLegs]. */
  speedBase: 0.95,
  detachedLegSpeed: [1, 0.7, 0.45, 0.25, 0.15],
  /** Corner limit = base + (1-base) * minLegHealth, times body factor. */
  cornerBase: 0.93,
  bodyCornerBase: 0.9,
  /** Lateral drift (steer units) per unit of deformation difference between right and left legs. */
  deformSteerBias: 0.05,

  // ---- Crash -> repair ----
  /** A fall faster than this (m/s) is a crash that needs repair. */
  crashSpeed: 9,
  /** Any leg below this health after a fall needs repair. */
  repairLegHealth: 0.3,
  repair: {
    baseSeconds: 3,
    perKg: 0.12,
    perReinforcement: 2.5,
    perTape: 1.5,
    /** Extra seconds per part, scaled by how damaged it is. */
    perPartDamage: 1.4,
    perDetached: 3,
    /** Every previous repair makes the next one slower (more tape to deal with). */
    perPreviousRepair: 1,
    /** 修理後劣化: each repair lowers the part's max integrity and joint quality. */
    maxIntegrityLoss: 0.1,
    jointQuality: 0.85,
    /** Deformation left after straightening. */
    deformKept: 0.35,
    /** Re-attached parts come back at this fraction of max integrity. */
    reattachedIntegrity: 0.6,
    /** Structural fatigue kept after repair (tape doesn't fix tired cardboard). */
    fatigueKept: 0.85,
    /** Speed (m/s) at which the crew drags a crashed horse to the outside. */
    dragSpeed: 3,
  },
  /** CPU riders pit when their worst leg falls below this (and enough race remains). */
  cpuPitLegHealth: 0.28,
  cpuPitMinRemaining: 350,
};

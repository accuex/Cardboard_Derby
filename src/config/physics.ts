/**
 * Gameplay physics tuning (Phase 2). Everything that decides how horses
 * accelerate, corner, tip over, collide and wear out lives here.
 */
export const physicsConfig = {
  gravity: 9.81,

  // ---- Performance derivation from the horse body ----
  /** Top speed (m/s) of the reference body (legLength 1.0, mass 20kg). */
  baseTopSpeed: 17.2,
  /** Top speed ∝ legLength^legSpeedExponent. */
  legSpeedExponent: 0.35,
  /** Top speed ∝ (refMass/mass)^massSpeedExponent. */
  massSpeedExponent: 0.03,
  baseAcceleration: 3.0,
  massAccelExponent: 0.7,
  refMass: 20,
  baseBrakeDecel: 6.5,
  /** Height of the centre of gravity above the hips (m). */
  cgAboveHips: 0.3,
  /** Grip/rigidity fudge applied to the static rollover threshold g*(stance/2)/cgHeight. */
  cornerGrip: 1.27,
  /** Reinforcement adds rigidity, which slightly raises the cornering limit. */
  reinforcementCornerBonus: 0.08,
  /** Wider than 0.5m = more drag: top speed × (1 - stanceDrag × (stance - 0.5)). */
  stanceDrag: 0.18,
  /** Raised body: top speed bonus per metre (longer, freer stride). */
  raisedSpeedBonus: 0.12,
  /** Thin cardboard is fragile: fragility ∝ (1/ply)^plyFragilityExponent. */
  plyFragilityExponent: 0.6,
  /** More tape = joints peel slower: joint wear ∝ (1/tape)^tapeJointExponent. */
  tapeJointExponent: 0.7,

  // ---- Longitudinal ----
  /** Throttle used when the player gives no input. */
  cruiseThrottle: 0.85,
  /** Rolling decel when standing still with no throttle. */
  idleDecel: 1.0,

  // ---- Lateral / steering ----
  maxLateralSpeed: 2.0,
  lateralResponse: 2.5,
  maxLateralAccel: 1.1,

  // ---- Roll / tipping ----
  /** Visual lean (rad) at load ratio 1.0. */
  leanAtLimit: 0.12,
  /** Roll build-up rate (rad/s) per unit of load ratio above 1. */
  rollGain: 1.8,
  /** Extra quadratic roll gain so large overshoots tip quickly. */
  rollGainQuadratic: 4,
  /** Roll recovery rate (rad/s) once back under the limit. */
  rollRecovery: 1.3,
  /** Inner legs leave the ground beyond this roll. */
  legLiftRoll: 0.2,
  /** The horse falls beyond this roll. */
  tipRoll: 0.6,
  /** Roll impulse (rad per m/s of side impact). */
  impactRoll: 0.09,

  // ---- 踏ん張る ----
  brace: {
    cornerLimitMul: 1.25,
    rollGainMul: 0.55,
    /** Seconds of bracing per 疲労度UP stack (the first stack is added on press). */
    secondsPerStack: 1.5,
    maxStacks: 5,
    /** Seconds without bracing to shed one stack. */
    stackDecaySeconds: 25,
    /** Structural fatigue gain multiplier per stack. */
    fatiguePerStack: 0.3,
  },

  // ---- 構造疲労 (0..1) ----
  fatigue: {
    /** Per second at top speed, ∝ (v/vmax)^4. */
    running: 0.0016,
    /** Extra per second when above vibrationThreshold of top speed. */
    vibration: 0.02,
    vibrationThreshold: 0.88,
    /** Per second at load ratio 1.0 (∝ (ratio-cornerFrom)^2). */
    cornering: 0.03,
    cornerFrom: 0.7,
    /** Per (m/s)^2 of impact speed. */
    impact: 0.004,
    fall: 0.06,
    /** Effects of full fatigue. */
    topSpeedLoss: 0.12,
    cornerLimitLoss: 0.2,
  },

  // ---- Falls ----
  fall: {
    slideDecel: 7,
    /** Seconds on the ground: base + per kg. */
    baseDuration: 1.8,
    perKg: 0.08,
    getUpSeconds: 1.2,
  },

  // ---- Collisions ----
  collision: {
    halfLength: 1.1,
    halfWidth: 0.42,
    restitution: 0.3,
    /** Fraction of speed lost per m/s of side impact (scraping). */
    scrape: 0.03,
    /** Fallen horses are heavy obstacles. */
    fallenMassMul: 3,
    railRestitution: 0.35,
    railScrape: 0.04,
    /** Minimum impact (m/s) for an event to be reported. */
    reportImpact: 0.7,
  },
};

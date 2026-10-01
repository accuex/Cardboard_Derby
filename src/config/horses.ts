export type RunningStyle = 'nige' | 'senkou' | 'sashi' | 'oikomi';

export const runningStyleLabel: Record<RunningStyle, string> = {
  nige: '逃げ',
  senkou: '先行',
  sashi: '差し',
  oikomi: '追込',
};

/**
 * Physical make-up of a cardboard horse (the build). Mass and performance are derived
 * from this (see sim/performance.ts), so every choice has a natural trade-off.
 */
export interface HorseBody {
  /** Leg length relative to the reference horse (1.0 ≈ 1.25m). */
  legLength: number;
  /** Distance between left and right feet (m). 車幅 */
  stanceWidth: number;
  /** Cardboard thickness multiplier. Low = 軽量化. */
  ply: number;
  /** Structural braces multiplier. 補強 */
  reinforcement: number;
  /** Amount of duct tape on the joints. ガムテープ量 */
  tape: number;
  /** Centre of gravity shift (m). Negative = ballast low down, positive = body raised. */
  cgAdjust: number;
}

/** CPU jockey personality. */
export interface RiderTraits {
  /** Fraction of the theoretical corner speed the rider aims for. */
  cornerMargin: number;
  /** Random per-corner misjudgement (±). */
  cornerError: number;
  /** Tip risk at which the rider reacts by easing off. */
  reactRisk: number;
  /** Probability per second of bracing while in danger. */
  braceTendency: number;
  /** Seconds before the rider notices the horse is tipping. */
  reactionTime: number;
}

export interface HorseProfile {
  name: string;
  /** Rider name for human players. */
  jockey?: string;
  /** Jockey silks colour (CSS colour). */
  silkColor: string;
  style: RunningStyle;
  body: HorseBody;
  rider: RiderTraits;
}

/** Tuning for how the CPU riders pace a race per running style. */
export interface StyleTuning {
  /** Throttle while cruising. Equilibrium speed ≈ sqrt(throttle) * topSpeed. */
  cruiseThrottle: number;
  /** Remaining distance at which the rider goes flat out. */
  spurtDistance: number;
  preferredLateral: number;
}

export const styleTuning: Record<RunningStyle, StyleTuning> = {
  nige: { cruiseThrottle: 0.9, spurtDistance: 350, preferredLateral: 1.0 },
  senkou: { cruiseThrottle: 0.87, spurtDistance: 450, preferredLateral: 1.7 },
  sashi: { cruiseThrottle: 0.84, spurtDistance: 550, preferredLateral: 2.3 },
  oikomi: { cruiseThrottle: 0.81, spurtDistance: 650, preferredLateral: 2.9 },
};

export type CpuLevel = 'easy' | 'normal' | 'hard';

/** CPU strength (Admin → CPUの強さ). Multipliers on the riders' traits. */
/**
 * Aggression alone backfires (corner load wears the cardboard), so stronger CPUs ride cleaner
 * and their horses are slightly better "trained" (`speed` multiplies CPU top speed).
 */
export const cpuLevels: Record<CpuLevel, { label: string; cruise: number; spurt: number; margin: number; error: number; reaction: number; brace: number; speed: number }> = {
  easy: { label: 'やさしい', cruise: -0.04, spurt: 0.85, margin: 0.95, error: 1.2, reaction: 1.6, brace: 0.5, speed: 0.975 },
  normal: { label: 'ふつう', cruise: 0, spurt: 1, margin: 1, error: 1, reaction: 1, brace: 1, speed: 1 },
  hard: { label: 'つよい', cruise: 0, spurt: 1.1, margin: 1, error: 0.35, reaction: 0.5, brace: 1.6, speed: 1.008 },
};

/** Global CPU tuning. */
export const pacingConfig = {
  level: 'normal' as CpuLevel,
  /** Random per-race throttle offset (±). */
  formSpread: 0.02,
  /** Random per-race top speed swing (±, 調子). 0 = none; the TV mode uses it so favourites can lose. */
  conditionSpread: 0,
  /** Chance of a slow start. */
  slowStartChance: 0.12,
  /** Scales every rider's cornerError (more = more crashes). */
  cornerErrorScale: 2.1,
  /** Planned deceleration when braking for a corner (m/s^2). */
  cornerPlanDecel: 2.0,
  /** Speed while pulling up after the finish. */
  cooldownSpeed: 7,
};

export const horseRoster: HorseProfile[] = [
  {
    name: 'ダンボールドリーム', silkColor: '#e04848', style: 'nige',
    body: { legLength: 1.1, stanceWidth: 0.46, ply: 0.8, reinforcement: 0.85, tape: 1.0, cgAdjust: 0 },
    rider: { cornerMargin: 0.97, cornerError: 0.08, reactRisk: 0.35, braceTendency: 1.2, reactionTime: 0.5 },
  },
  {
    name: 'ガムテープマスター', silkColor: '#3a62d8', style: 'senkou',
    body: { legLength: 0.99, stanceWidth: 0.56, ply: 1.2, reinforcement: 1.6, tape: 1.6, cgAdjust: 0 },
    rider: { cornerMargin: 0.98, cornerError: 0.05, reactRisk: 0.3, braceTendency: 0.6, reactionTime: 0.3 },
  },
  {
    name: 'ミカンバコキング', silkColor: '#f0a020', style: 'sashi',
    body: { legLength: 0.99, stanceWidth: 0.5, ply: 0.92, reinforcement: 1.0, tape: 0.95, cgAdjust: 0 },
    rider: { cornerMargin: 0.98, cornerError: 0.07, reactRisk: 0.3, braceTendency: 0.8, reactionTime: 0.45 },
  },
  {
    name: 'オリメタダシイ', silkColor: '#2fa36b', style: 'senkou',
    body: { legLength: 1.01, stanceWidth: 0.57, ply: 1.0, reinforcement: 1.3, tape: 1.0, cgAdjust: -0.05 },
    rider: { cornerMargin: 1.0, cornerError: 0.06, reactRisk: 0.35, braceTendency: 0.8, reactionTime: 0.35 },
  },
  {
    name: 'ハコイリムスメ', silkColor: '#d85aa8', style: 'oikomi',
    body: { legLength: 1.14, stanceWidth: 0.48, ply: 0.9, reinforcement: 1.0, tape: 1.0, cgAdjust: 0.02 },
    rider: { cornerMargin: 0.97, cornerError: 0.1, reactRisk: 0.4, braceTendency: 1.0, reactionTime: 0.6 },
  },
  {
    name: 'リサイクルスター', silkColor: '#8a5ad8', style: 'sashi',
    body: { legLength: 1.0, stanceWidth: 0.49, ply: 0.8, reinforcement: 0.8, tape: 1.2, cgAdjust: 0 },
    rider: { cornerMargin: 1.0, cornerError: 0.08, reactRisk: 0.45, braceTendency: 1.1, reactionTime: 0.55 },
  },
];

/** JRA style gate colours (枠色), indexed by gate number - 1. */
export const gateColors: { bg: string; fg: string }[] = [
  { bg: '#f4f4f4', fg: '#111111' },
  { bg: '#1c1c1c', fg: '#ffffff' },
  { bg: '#d42a2a', fg: '#ffffff' },
  { bg: '#2058d0', fg: '#ffffff' },
  { bg: '#f2d000', fg: '#111111' },
  { bg: '#159447', fg: '#ffffff' },
  { bg: '#f08a00', fg: '#111111' },
  { bg: '#f28cb8', fg: '#111111' },
];

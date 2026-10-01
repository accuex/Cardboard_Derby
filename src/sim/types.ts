import type { HorseBody, RunningStyle } from '../config/horses';

/**
 * Serializable race state. The simulation writes it, renderers/UI only read it.
 * Kept free of rendering types so it can later be sent over the network.
 */
export type RacePhase = 'waiting' | 'running' | 'finished';

/**
 * running: normal / fallen: on its side, sliding / recovering: getting back up /
 * repairing: stopped at the side of the course being taped back together.
 */
export type HorseStatus = 'running' | 'fallen' | 'recovering' | 'repairing';

export type PartId = 'legFR' | 'legFL' | 'legHR' | 'legHL' | 'neck' | 'tail' | 'body';

/** Condition of one cardboard part. */
export interface PartState {
  /** Cardboard condition 0..maxIntegrity. */
  integrity: number;
  /** Drops with every repair (修理後劣化). */
  maxIntegrity: number;
  /** Tape / joint bond 0..1 (接合強度). 0 = falls off. */
  joint: number;
  /** Bending 0..1 (変形). */
  deform: number;
  detached: boolean;
  /** Layers of repair tape applied. */
  tape: number;
}

export interface HorseState {
  id: number;
  gate: number;
  name: string;
  silkColor: string;
  style: RunningStyle;
  isPlayer: boolean;
  /** Rider's name for human players (騎手名). */
  jockey: string | null;
  /** A CPU rider is standing in for a disconnected player. */
  autopilot: boolean;
  /** The build (static). Drives performance and appearance. */
  body: HorseBody;
  mass: number;
  /** Auto-judged build nickname (異名), e.g. 直線番長. */
  nickname: string;

  /** Inner-rail-reference distance covered since the start. */
  progress: number;
  /** Course coordinate (wrapped). */
  courseS: number;
  /** Distance from the inner rail. */
  lateral: number;
  /** Ground speed along the course (m/s). */
  speed: number;
  /** Lateral velocity, + = outward (m/s). */
  lateralVelocity: number;
  /** Current effective top speed (after fatigue). */
  topSpeed: number;

  /** Last applied controls (for UI / animation). */
  throttle: number;
  brake: number;
  bracing: boolean;

  /** Lateral load / cornering limit. Signed: + pushes the horse outward. */
  loadRatio: number;
  /** Body roll (rad). + = leaning/tipping outward. */
  roll: number;
  /** |roll| / tip roll, 0..1. */
  tipRisk: number;
  legsLifted: boolean;
  /** 構造疲労 0..1. */
  structuralFatigue: number;
  /** 疲労度UP stacks. */
  fatigueStacks: number;
  status: HorseStatus;
  /** Seconds spent in the current status. */
  statusTime: number;

  falls: number;
  collisions: number;

  parts: Record<PartId, PartState>;
  repairs: number;
  /** Planned length of the current repair (s); progress is statusTime / repairTotal. */
  repairTotal: number;
  /** Rider asked to pull over for repairs. */
  pitRequested: boolean;

  /** World position and travel direction. */
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  rank: number;
  finished: boolean;
  finishTime: number | null;
  /** Time when the horse passed 600m to go (for 上がり3F). */
  last600Time: number | null;
}

export type RaceEventType =
  | 'fall'
  | 'recover'
  | 'collision'
  | 'rail'
  | 'legLift'
  | 'brace'
  | 'finish'
  | 'tapePeel'
  | 'partLost'
  | 'deform'
  | 'repairStart'
  | 'repairEnd';

export interface RaceEvent {
  seq: number;
  time: number;
  type: RaceEventType;
  horseId: number;
  otherId?: number;
  value?: number;
  part?: PartId;
  /** World position where it happened (used to drop debris). */
  x?: number;
  z?: number;
}

export interface RaceState {
  phase: RacePhase;
  /** Seconds since the gates opened. */
  time: number;
  distance: number;
  startS: number;
  horses: HorseState[];
  /** Horse ids ordered by current rank. */
  order: number[];
  /** Horse ids in the order they crossed the line. */
  finishOrder: number[];
  /** Recent notable events (bounded), newest last. */
  events: RaceEvent[];
  eventSeq: number;
}

/**
 * Wire protocol shared by the server and the browser client.
 * Static horse data is sent once per race (RaceSetup); dynamic state is sent
 * compactly in every Snapshot as arrays in a fixed field order.
 */
import type { CourseConfig } from '../config/course';
import type { HorseBody, RunningStyle } from '../config/horses';
import type { FlowPhase } from '../game/phase';
import type { HorseRaceStats } from '../game/RaceStats';
import type { ReplaySegment } from '../game/Replay';
import type { TournamentView } from '../game/Tournament';
import { PART_IDS } from '../sim/damage';
import type { HorseInput } from '../sim/input';
import type { HorseState, HorseStatus, RaceEvent, RacePhase, RaceState } from '../sim/types';

export const NET = {
  port: 3000,
  snapshotRate: 20,
  inputRate: 30,
  /** Client renders this far behind the newest snapshot so it can interpolate. */
  /** Client renders this far behind the newest snapshot (adapts to jitter within min..max). */
  interpolationDelayMs: 120,
  minInterpolationDelayMs: 80,
  maxInterpolationDelayMs: 350,
  /** How long the client may extrapolate when snapshots stop arriving. */
  maxExtrapolationMs: 300,
  /** Input heartbeat; changes are sent immediately. */
  inputHeartbeatHz: 10,
  pingIntervalMs: 2000,
  /** Seconds a disconnected player keeps their lobby slot. */
  lobbyGraceSeconds: 30,
  lobbyCountdownSeconds: 15,
  lobbyMinCountdownAfterJoin: 6,
  rematchCountdownSeconds: 8,
};

export interface PlayerBuildMsg {
  /** 騎手名 (player name). */
  jockey?: string;
  name: string;
  silkColor: string;
  body: HorseBody;
}

export interface RaceInfo {
  edition: number;
  name: string;
  grade: 'G1' | 'G2' | 'G3' | 'OP' | '';
  distance: number;
  weather: string;
}

export interface StaticHorse {
  id: number;
  gate: number;
  name: string;
  silkColor: string;
  style: RunningStyle;
  body: HorseBody;
  mass: number;
  nickname: string;
  /** Controlled by a human (any client). */
  human: boolean;
  /** Public id of the controlling player (never the secret token). */
  owner: string | null;
  jockey: string | null;
  /** Tournament entrant riding this gate (null = CPU filler / free play). */
  entrant: string | null;
}

export interface RaceSetup {
  raceId: number;
  seed: number;
  courseId: string;
  course: CourseConfig;
  race: RaceInfo;
  startS: number;
  horses: StaticHorse[];
}

export interface LobbyPlayer {
  /** Public id. */
  id: string;
  gate: number;
  name: string;
  jockey: string;
  connected: boolean;
}

export interface LobbyInfo {
  /** Seconds until the race starts automatically, or null when nobody has joined. */
  countdown: number | null;
  players: LobbyPlayer[];
  spectators: number;
  /** Players may press 発走 / もう一度 themselves (otherwise only the Admin can). */
  playersCanStart: boolean;
  mode: GameMode;
  /** Tournament race being prepared, e.g. 予選2組. */
  raceLabel: string | null;
}

export type GameMode = 'free' | 'tournament';

/** Which screen a connection is (for the Admin's overview). */
export type ClientRole = 'player' | 'play' | 'host' | 'commentary' | 'admin';

export interface AdminSettings {
  mode: GameMode;
  cpuLevel: 'easy' | 'normal' | 'hard';
  raceName: string;
  edition: number;
  grade: RaceInfo['grade'];
  weather: string;
  distance: number;
  courseId: string;
  /** Lobby countdown once someone joins (seconds), or null = Admin starts manually. */
  autoCountdown: number | null;
  playersCanStart: boolean;
  /** Bump 第N回 after every finished race. */
  autoEdition: boolean;
}

export interface AdminPlayer {
  /** Public id. */
  id: string;
  jockey: string;
  horse: string;
  gate: number | null;
  connected: boolean;
  visible: boolean;
  role: ClientRole;
}

export interface ResultRow {
  rank: number | null;
  gate: number;
  name: string;
  jockey: string | null;
  nickname: string;
  human: boolean;
  time: number | null;
  falls: number;
  repairs: number;
  stats?: HorseRaceStats;
}

export interface RaceRecord {
  id: string;
  at: number;
  title: string;
  grade: RaceInfo['grade'];
  distance: number;
  course: string;
  rows: ResultRow[];
  /** Tournament name + race label when run as part of a tournament. */
  tournament?: string;
}

/** Admin's view of the tournament (adds connection state per entrant). */
export interface TournamentAdminView extends TournamentView {
  config: { name: string; heatQualifiers: number; autoGrade: boolean };
  connected: Record<string, boolean>;
}

export interface AdminState {
  settings: AdminSettings;
  phase: FlowPhase;
  raceTime: number;
  countdown: number | null;
  players: AdminPlayer[];
  roles: Record<ClientRole, number>;
  courses: { id: string; label: string; distances: number[] }[];
  history: RaceRecord[];
  tournament: TournamentAdminView;
}

export type AdminCommand =
  | { type: 'start' }
  | { type: 'skip' }
  | { type: 'abort' }
  | { type: 'restart' }
  | { type: 'toLobby' }
  | { type: 'settings'; settings: Partial<AdminSettings> }
  | { type: 'kick'; id: string }
  | { type: 'setGate'; id: string; gate: number }
  | { type: 'tconfig'; name?: string; heatQualifiers?: number; autoGrade?: boolean }
  | { type: 'tdraw' }
  | { type: 'tmove'; entrantId: string; race: number }
  | { type: 'tstart' }
  | { type: 'treset'; keepEntrants: boolean }
  | { type: 'tadd'; count: number }
  | { type: 'tremove'; entrantId: string }
  | { type: 'deleteResult'; id: string }
  | { type: 'clearResults' };

export type HorseWire = (number | number[])[];

export interface Snapshot {
  raceId: number;
  seq: number;
  /** Server wall clock (ms) when the snapshot was taken. */
  serverTime: number;
  flow: { phase: FlowPhase; phaseTime: number; paddockIndex: number };
  race: { phase: RacePhase; time: number; order: number[]; finishOrder: number[] };
  horses: HorseWire[];
  events: RaceEvent[];
  /** Present while replays are playing. */
  replay: { segments: ReplaySegment[]; index: number } | null;
  lobby: LobbyInfo | null;
}

export interface ServerToClient {
  /** clientId is this browser's secret reconnect token; publicId is what others see. */
  welcome: (msg: { clientId: string; publicId: string }) => void;
  tournament: (view: TournamentView) => void;
  /** This browser's tournament entry (public entrant id), or null. */
  entry: (msg: { entrantId: string | null }) => void;
  /** Human-readable broadcast notice (joins, disconnects, takeovers). */
  notice: (text: string) => void;
  setup: (msg: RaceSetup) => void;
  snap: (msg: Snapshot) => void;
  assigned: (msg: { gate: number | null; reason?: string }) => void;
  'admin:state': (state: AdminState) => void;
}

export interface ClientToServer {
  join: (build: PlayerBuildMsg) => void;
  leave: () => void;
  input: (input: HorseInput) => void;
  start: () => void;
  skip: () => void;
  rematch: () => void;
  ping: (t: number, ack: (t: number) => void) => void;
  /** Page hidden (phone locked / app switched) or visible again. */
  presence: (visible: boolean) => void;
  'admin:auth': (pin: string, ack: (ok: boolean) => void) => void;
  'admin:command': (cmd: AdminCommand, ack: (result: { ok: boolean; message?: string }) => void) => void;
}

// ---------------------------------------------------------------- encoding

const NUM_FIELDS = [
  'progress', 'courseS', 'lateral', 'speed', 'lateralVelocity', 'topSpeed', 'throttle', 'brake', 'loadRatio', 'roll',
  'tipRisk', 'structuralFatigue', 'fatigueStacks', 'statusTime', 'falls', 'collisions', 'repairs', 'repairTotal',
  'x', 'z', 'dirX', 'dirZ', 'rank',
] as const satisfies readonly (keyof HorseState)[];
const BOOL_FIELDS = ['bracing', 'legsLifted', 'finished', 'pitRequested', 'autopilot'] as const satisfies readonly (keyof HorseState)[];
const NULLABLE_FIELDS = ['finishTime', 'last600Time'] as const satisfies readonly (keyof HorseState)[];
const STATUSES: HorseStatus[] = ['running', 'fallen', 'recovering', 'repairing'];

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Direction and roll need fine precision; positions and gauges are fine at 1cm / 1%. */
const FINE = new Set<string>(['dirX', 'dirZ', 'roll', 'courseS', 'progress']);

/** Compact part state; also used to detect changes. */
export function encodeParts(h: HorseState): number[][] {
  return PART_IDS.map((id) => {
    const p = h.parts[id];
    return [r2(p.integrity), r2(p.maxIntegrity), r2(p.joint), r2(p.deform), p.detached ? 1 : 0, p.tape];
  });
}

/**
 * `parts` = null sends a 0 instead of the 7 part arrays: parts change rarely, so the server
 * only includes them when they changed (plus a periodic keyframe for late joiners).
 */
export function encodeHorse(h: HorseState, parts: number[][] | null = encodeParts(h)): HorseWire {
  const out: HorseWire = [];
  for (const k of NUM_FIELDS) out.push(FINE.has(k) ? r3(h[k]) : r2(h[k]));
  for (const k of BOOL_FIELDS) out.push(h[k] ? 1 : 0);
  for (const k of NULLABLE_FIELDS) out.push(h[k] === null ? -1 : r3(h[k] as number));
  out.push(STATUSES.indexOf(h.status));
  if (parts) out.push(...parts);
  else out.push(0);
  return out;
}

export function decodeHorse(w: HorseWire, h: HorseState): void {
  let i = 0;
  const rec = h as unknown as Record<string, unknown>;
  for (const k of NUM_FIELDS) rec[k] = w[i++] as number;
  for (const k of BOOL_FIELDS) rec[k] = (w[i++] as number) === 1;
  for (const k of NULLABLE_FIELDS) {
    const v = w[i++] as number;
    rec[k] = v === -1 ? null : v;
  }
  h.status = STATUSES[w[i++] as number] ?? 'running';
  if (typeof w[i] === 'number') return; // parts unchanged: keep what we had
  for (const id of PART_IDS) {
    const a = w[i++] as number[];
    const p = h.parts[id];
    p.integrity = a[0];
    p.maxIntegrity = a[1];
    p.joint = a[2];
    p.deform = a[3];
    p.detached = a[4] === 1;
    p.tape = a[5];
  }
}

/** Fields of a snapshot that can be blended between two snapshots. */
export const LERP_FIELDS = ['progress', 'lateral', 'speed', 'lateralVelocity', 'roll', 'x', 'z', 'dirX', 'dirZ', 'loadRatio', 'tipRisk'] as const;

export function raceStateSkeleton(setup: RaceSetup, createParts: () => HorseState['parts']): RaceState {
  return {
    phase: 'waiting',
    time: 0,
    distance: setup.race.distance,
    startS: setup.startS,
    order: setup.horses.map((h) => h.id),
    finishOrder: [],
    events: [],
    eventSeq: 0,
    horses: setup.horses.map((s) => ({
      id: s.id, gate: s.gate, name: s.name, silkColor: s.silkColor, style: s.style, isPlayer: false,
      jockey: s.jockey, autopilot: false,
      body: s.body, mass: s.mass, nickname: s.nickname,
      progress: 0, courseS: setup.startS, lateral: 0, speed: 0, lateralVelocity: 0, topSpeed: 0,
      throttle: 0, brake: 0, bracing: false, loadRatio: 0, roll: 0, tipRisk: 0, legsLifted: false,
      structuralFatigue: 0, fatigueStacks: 0, status: 'running', statusTime: 0, falls: 0, collisions: 0,
      parts: createParts(), repairs: 0, repairTotal: 0, pitRequested: false,
      x: 0, z: 0, dirX: 1, dirZ: 0, rank: s.id + 1, finished: false, finishTime: null, last600Time: null,
    })),
  };
}

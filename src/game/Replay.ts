import type { RaceConfig } from '../config/race';
import type { HorseState, PartId, RaceState } from '../sim/types';

/** Dynamic per-horse values needed to redraw a moment of the race. */
interface HorseSnap {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  lateral: number;
  lateralVelocity: number;
  progress: number;
  courseS: number;
  roll: number;
  status: HorseState['status'];
  bracing: boolean;
  finished: boolean;
  rank: number;
  detached: PartId[];
}

interface Frame {
  t: number;
  horses: HorseSnap[];
  order: number[];
}

export type ReplayKind = 'goal' | 'crash';

export interface ReplaySegment {
  kind: ReplayKind;
  label: string;
  from: number;
  to: number;
  speed: number;
  /** Horse the replay is about (winner or crashed horse). */
  focusId: number;
}

const snap = (h: HorseState): HorseSnap => ({
  x: h.x,
  z: h.z,
  dirX: h.dirX,
  dirZ: h.dirZ,
  speed: h.speed,
  lateral: h.lateral,
  lateralVelocity: h.lateralVelocity,
  progress: h.progress,
  courseS: h.courseS,
  roll: h.roll,
  status: h.status,
  bracing: h.bracing,
  finished: h.finished,
  rank: h.rank,
  detached: (Object.keys(h.parts) as PartId[]).filter((k) => h.parts[k].detached),
});

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Records the race at a fixed rate and plays chosen moments back
 * (slow motion, interpolated). Works purely on RaceState data.
 */
export class ReplayRecorder {
  private frames: Frame[] = [];
  private lastT = -1;
  private highlights: { t: number; horseId: number }[] = [];
  private lastEventSeq = 0;

  constructor(private readonly cfg: RaceConfig['replay']) {}

  reset(): void {
    this.frames = [];
    this.lastT = -1;
    this.highlights = [];
    this.lastEventSeq = 0;
  }

  record(state: RaceState): void {
    if (state.phase === 'waiting') return;
    for (const ev of state.events) {
      if (ev.seq <= this.lastEventSeq) continue;
      this.lastEventSeq = ev.seq;
      if (ev.type === 'fall' || ev.type === 'partLost') {
        const near = this.highlights.find((h) => Math.abs(h.t - ev.time) < 4);
        if (!near) this.highlights.push({ t: ev.time, horseId: ev.horseId });
      }
    }
    if (state.time - this.lastT < 1 / this.cfg.recordRate) return;
    this.lastT = state.time;
    this.frames.push({ t: state.time, horses: state.horses.map(snap), order: [...state.order] });
  }

  /** Goal replay first, then up to N accidents (player's own first). */
  plan(state: RaceState): ReplaySegment[] {
    const c = this.cfg;
    const segs: ReplaySegment[] = [];
    const winner = state.finishOrder[0];
    const wt = winner !== undefined ? state.horses[winner].finishTime : null;
    if (wt !== null && this.frames.length) {
      segs.push({ kind: 'goal', label: 'ゴール前 リプレイ', from: Math.max(0, wt - c.goalBefore), to: wt + c.goalAfter, speed: c.goalSpeed, focusId: winner });
    }
    const crashes = [...this.highlights].sort((a, b) => Number(state.horses[b.horseId].isPlayer) - Number(state.horses[a.horseId].isPlayer) || b.t - a.t);
    for (const h of crashes.slice(0, c.maxCrashes)) {
      segs.push({ kind: 'crash', label: 'アクシデント リプレイ', from: Math.max(0, h.t - c.crashBefore), to: h.t + c.crashAfter, speed: c.crashSpeed, focusId: h.horseId });
    }
    return segs.filter((s) => s.to <= this.frames[this.frames.length - 1].t + 0.01);
  }

  /** Writes the moment `t` into `out` (a copy of the live state used as a template). */
  sample(t: number, out: RaceState): RaceState {
    const f = this.frames;
    if (!f.length) return out;
    let lo = 0;
    let hi = f.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (f[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = f[lo];
    const b = f[hi];
    const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    out.time = lerp(a.t, b.t, k);
    out.order = k < 0.5 ? a.order : b.order;
    out.horses.forEach((h, i) => {
      const s0 = a.horses[i];
      const s1 = b.horses[i];
      h.x = lerp(s0.x, s1.x, k);
      h.z = lerp(s0.z, s1.z, k);
      h.dirX = lerp(s0.dirX, s1.dirX, k);
      h.dirZ = lerp(s0.dirZ, s1.dirZ, k);
      h.speed = lerp(s0.speed, s1.speed, k);
      h.lateral = lerp(s0.lateral, s1.lateral, k);
      h.lateralVelocity = lerp(s0.lateralVelocity, s1.lateralVelocity, k);
      h.progress = lerp(s0.progress, s1.progress, k);
      h.courseS = k < 0.5 ? s0.courseS : s1.courseS;
      h.roll = lerp(s0.roll, s1.roll, k);
      const s = k < 0.5 ? s0 : s1;
      h.status = s.status;
      h.bracing = s.bracing;
      h.finished = s.finished;
      h.rank = s.rank;
      for (const id of Object.keys(h.parts) as PartId[]) h.parts[id].detached = s.detached.includes(id);
    });
    return out;
  }
}

/** Plays a list of segments one after another. */
export class ReplayPlayer {
  private index = 0;
  private t = 0;
  readonly state: RaceState;

  constructor(
    private readonly recorder: ReplayRecorder,
    readonly segments: ReplaySegment[],
    live: RaceState,
  ) {
    this.state = structuredClone(live);
    this.state.events = [];
    if (segments.length) this.t = segments[0].from;
    this.refresh();
  }

  get segment(): ReplaySegment | null {
    return this.segments[this.index] ?? null;
  }

  get done(): boolean {
    return this.index >= this.segments.length;
  }

  /** Seconds since the current segment started (in replay time). */
  get segmentTime(): number {
    const s = this.segment;
    return s ? (this.t - s.from) / s.speed : 0;
  }

  /** Advance by real seconds; returns true when the segment changed. */
  update(dt: number): boolean {
    const s = this.segment;
    if (!s) return false;
    this.t += dt * s.speed;
    if (this.t >= s.to) {
      this.index++;
      const next = this.segment;
      if (next) this.t = next.from;
      this.refresh();
      return true;
    }
    this.refresh();
    return false;
  }

  skip(): void {
    this.index = this.segments.length;
  }

  get segmentIndex(): number {
    return this.index;
  }

  /** Follow an external clock (the server) to a given segment. */
  jumpTo(index: number): void {
    if (index === this.index) return;
    this.index = index;
    const s = this.segment;
    if (s) this.t = s.from;
    this.refresh();
  }

  /** Advance without leaving the current segment (holds on its last frame). */
  advanceWithin(dt: number): void {
    const s = this.segment;
    if (!s) return;
    this.t = Math.min(s.to, this.t + dt * s.speed);
    this.refresh();
  }

  private refresh(): void {
    if (this.segment) this.recorder.sample(this.t, this.state);
  }
}

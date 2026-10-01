import { cpuLevels, pacingConfig, type HorseProfile } from '../config/horses';
import type { RaceConfig } from '../config/race';
import { Rng } from '../core/rng';
import { CollisionSolver } from './Collisions';
import { Course, type CourseSample } from './Course';
import { CpuRider } from './CpuRider';
import { judgeBuildType } from './buildType';
import { createParts } from './damage';
import { newPhysicsMemory, stepHorse, type EmitEvent, type PhysicsMemory, type SimContext } from './HorsePhysics';
import { neutralInput, type HorseInput } from './input';
import { computePerformance, type HorsePerformance } from './performance';
import type { HorseState, RaceEvent, RaceState } from './types';

const MAX_EVENTS = 60;

/**
 * Authoritative race simulation (rendering-agnostic).
 * Steps at a fixed rate. Each horse is driven either by a CpuRider or by external input
 * (`setInput`), and every horse goes through the same physics.
 */
export class RaceSimulation {
  readonly course: Course;
  readonly state: RaceState;
  readonly performance: HorsePerformance[];
  private readonly riders: (CpuRider | null)[];
  /** CPU stand-ins for disconnected players (kept so a rejoin can hand control back). */
  private readonly standIns: (CpuRider | null)[];
  private readonly roster: HorseProfile[];
  private readonly rng: Rng;
  private readonly inputs: HorseInput[];
  private readonly memory: PhysicsMemory[];
  private readonly collisions: CollisionSolver;
  private readonly scratch: CourseSample = { x: 0, z: 0, dirX: 1, dirZ: 0, normalX: 0, normalZ: 1 };
  private readonly emit: EmitEvent;
  private readonly ctx: SimContext;

  /** `externalIds`: horse ids controlled from outside (players). */
  constructor(course: Course, race: RaceConfig, roster: HorseProfile[], seed: number, externalIds: number[] = []) {
    this.course = course;
    const rng = new Rng(seed);
    const startS = course.wrap(course.finishS - race.distance);
    // CPU strength: CPU-ridden horses get the level's training bonus (players never do)
    const cpuSpeed = cpuLevels[pacingConfig.level].speed;
    // 調子: its own stream, so races without it replay exactly as before
    const condition = pacingConfig.conditionSpread > 0 ? new Rng(seed ^ 0x5eed) : null;
    this.performance = roster.map((p, i) => {
      const perf = computePerformance(p.body);
      if (!externalIds.includes(i)) perf.topSpeed *= cpuSpeed;
      if (condition) perf.topSpeed *= 1 + condition.range(-pacingConfig.conditionSpread, pacingConfig.conditionSpread);
      return perf;
    });
    this.riders = roster.map((p, i) => (externalIds.includes(i) ? null : new CpuRider(p, rng)));
    this.standIns = roster.map(() => null);
    this.roster = roster;
    this.rng = rng;
    this.inputs = roster.map(() => neutralInput());
    this.memory = roster.map(() => newPhysicsMemory());
    const horses: HorseState[] = roster.map((p, i) => ({
      id: i,
      gate: i + 1,
      name: p.name,
      silkColor: p.silkColor,
      style: p.style,
      isPlayer: externalIds.includes(i),
      jockey: p.jockey ?? null,
      autopilot: false,
      body: { ...p.body },
      mass: this.performance[i].mass,
      nickname: judgeBuildType(p.body, this.performance[i]).name,
      progress: 0,
      courseS: startS,
      lateral: race.gateFirstLateral + i * race.gateSpacing,
      speed: 0,
      lateralVelocity: 0,
      topSpeed: this.performance[i].topSpeed,
      throttle: 0,
      brake: 0,
      bracing: false,
      loadRatio: 0,
      roll: 0,
      tipRisk: 0,
      legsLifted: false,
      structuralFatigue: 0,
      fatigueStacks: 0,
      status: 'running',
      statusTime: 0,
      falls: 0,
      collisions: 0,
      parts: createParts(),
      repairs: 0,
      repairTotal: 0,
      pitRequested: false,
      x: 0,
      z: 0,
      dirX: 1,
      dirZ: 0,
      rank: i + 1,
      finished: false,
      finishTime: null,
      last600Time: null,
    }));
    this.state = {
      phase: 'waiting',
      time: 0,
      distance: race.distance,
      startS,
      horses,
      order: horses.map((h) => h.id),
      finishOrder: [],
      events: [],
      eventSeq: 0,
    };
    this.emit = (type, horseId, extra = {}) => {
      const h = this.state.horses[horseId];
      const ev: RaceEvent = { seq: ++this.state.eventSeq, time: this.state.time, type, horseId, ...extra, x: h.x, z: h.z };
      this.state.events.push(ev);
      if (this.state.events.length > MAX_EVENTS) this.state.events.shift();
    };
    this.ctx = { course, rng, emit: this.emit };
    this.collisions = new CollisionSolver(this.ctx);
    for (const h of horses) this.updateWorldPosition(h);
  }

  start(): void {
    if (this.state.phase === 'waiting') this.state.phase = 'running';
  }

  /** Let a CPU rider take over a player's horse (disconnect) or hand it back (rejoin). */
  setAutopilot(id: number, on: boolean): void {
    const h = this.state.horses[id];
    if (!h || !h.isPlayer || h.autopilot === on) return;
    if (on && !this.standIns[id]) this.standIns[id] = new CpuRider(this.roster[id], this.rng);
    h.autopilot = on;
  }

  /** Latest controls for an externally driven horse. */
  setInput(id: number, input: HorseInput): void {
    this.inputs[id] = input;
  }

  get allFinished(): boolean {
    return this.state.finishOrder.length === this.state.horses.length;
  }

  step(dt: number): void {
    const st = this.state;
    if (st.phase === 'waiting') return;
    st.time += dt;

    const prevProgress = st.horses.map((h) => h.progress);
    for (let i = 0; i < st.horses.length; i++) {
      const h = st.horses[i];
      const rider = this.riders[i] ?? (h.autopilot ? this.standIns[i] : null);
      const input = rider ? rider.decide(h, this.performance[i], st, this.course, dt) : this.inputs[i];
      stepHorse(h, this.performance[i], this.memory[i], input, this.ctx, dt);
      h.progress += h.speed * dt * this.course.progressRate(h.courseS, h.lateral);
      h.courseS = this.course.wrap(st.startS + h.progress);
    }

    this.collisions.solve(st.horses, this.performance, st.time);

    const mark600 = st.distance - 600;
    st.horses.forEach((h, i) => {
      const prev = prevProgress[i];
      h.courseS = this.course.wrap(st.startS + h.progress);
      const moved = h.progress - prev;
      if (h.last600Time === null && prev < mark600 && h.progress >= mark600 && moved > 0) {
        h.last600Time = st.time - dt + ((mark600 - prev) / moved) * dt;
      }
      if (!h.finished && h.progress >= st.distance && moved > 0) {
        h.finished = true;
        h.finishTime = st.time - dt + ((st.distance - prev) / moved) * dt;
        st.finishOrder.push(h.id);
        this.emit('finish', h.id, { value: st.finishOrder.length });
      }
      this.updateWorldPosition(h);
    });
    this.updateRanks();

    if (this.allFinished) st.phase = 'finished';
  }

  private updateWorldPosition(h: HorseState): void {
    const p = this.course.sample(h.courseS, h.lateral, this.scratch);
    h.x = p.x;
    h.z = p.z;
    h.dirX = p.dirX;
    h.dirZ = p.dirZ;
  }

  private updateRanks(): void {
    const st = this.state;
    const finishedIdx = new Map(st.finishOrder.map((id, i) => [id, i] as const));
    const ordered = [...st.horses].sort((a, b) => {
      const fa = finishedIdx.get(a.id);
      const fb = finishedIdx.get(b.id);
      if (fa !== undefined && fb !== undefined) return fa - fb;
      if (fa !== undefined) return -1;
      if (fb !== undefined) return 1;
      return b.progress - a.progress;
    });
    st.order = ordered.map((h) => h.id);
    ordered.forEach((h, i) => (h.rank = i + 1));
  }
}

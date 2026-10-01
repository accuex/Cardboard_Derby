import type { HorseProfile } from '../config/horses';
import type { RaceConfig } from '../config/race';
import type { Course } from '../sim/Course';
import type { HorseInput } from '../sim/input';
import { RaceSimulation } from '../sim/RaceSimulation';
import type { RaceState } from '../sim/types';
import { ReplayPlayer, ReplayRecorder } from './Replay';
import type { FlowPhase } from './phase';

export interface RaceFlowEvents {
  onPhase(phase: FlowPhase): void;
  /** A replay segment started (also called for the first one). */
  onReplaySegment?(player: ReplayPlayer): void;
}

/**
 * Race management: intro -> paddock (出走馬紹介) -> gate -> running -> finish -> replay -> results.
 * Owns the simulation and steps it at a fixed rate. No rendering here.
 */
export class RaceFlow {
  sim: RaceSimulation;
  phase: FlowPhase = 'intro';
  /** Seconds spent in the current phase. */
  phaseTime = 0;
  private accumulator = 0;
  private winnerTime = 0;
  private readonly recorder: ReplayRecorder;
  replay: ReplayPlayer | null = null;
  seed: number;

  constructor(
    private readonly course: Course,
    private readonly race: RaceConfig,
    private roster: HorseProfile[],
    seed: number,
    private readonly events: RaceFlowEvents,
    private readonly skipIntro = false,
    /** Horse ids driven by local players, and where their input comes from. */
    private players: { id: number; read: () => HorseInput }[] = [],
  ) {
    this.seed = seed;
    this.recorder = new ReplayRecorder(race.replay);
    this.sim = this.createSim(seed);
  }

  /** What to draw: the replay while one is playing, otherwise the live race. */
  get viewState(): RaceState {
    return this.phase === 'replay' && this.replay ? this.replay.state : this.sim.state;
  }

  /** Index of the horse being introduced during the paddock phase. */
  get paddockIndex(): number {
    return Math.min(this.sim.state.horses.length - 1, Math.floor(this.phaseTime / this.race.timing.paddockSecondsPerHorse));
  }

  /** Skip the title / introductions / replays. */
  skip(): void {
    if (this.phase === 'intro' || this.phase === 'paddock') this.setPhase('gate');
    else if (this.phase === 'replay') this.setPhase('results');
  }

  private createSim(seed: number): RaceSimulation {
    return new RaceSimulation(this.course, this.race, this.roster, seed, this.players.map((p) => p.id));
  }

  /** Replace the field (e.g. after the player edits their build). */
  setRoster(roster: HorseProfile[]): void {
    this.roster = roster;
  }

  /** Replace who drives which horse (takes effect on the next restart/prepare). */
  setPlayers(players: { id: number; read: () => HorseInput }[]): void {
    this.players = players;
  }

  /** New field, parked in the lobby ('build') until restart(). */
  prepare(seed: number): void {
    this.seed = seed;
    this.sim = this.createSim(seed);
    this.accumulator = 0;
    this.recorder.reset();
    this.replay = null;
    this.setPhase('build');
  }

  /** Park on the build screen; the race starts with restart(). */
  showBuild(): void {
    this.setPhase('build');
  }

  begin(): void {
    this.setPhase(this.skipIntro ? 'gate' : 'intro');
  }

  restart(seed: number): void {
    this.seed = seed;
    this.sim = this.createSim(seed);
    this.accumulator = 0;
    this.recorder.reset();
    this.replay = null;
    this.begin();
  }

  update(dt: number): void {
    const t = this.race.timing;
    this.phaseTime += dt;
    switch (this.phase) {
      case 'build':
        break;
      case 'intro':
        if (this.phaseTime >= t.introSeconds) this.setPhase('paddock');
        break;
      case 'paddock':
        if (this.phaseTime >= t.paddockSecondsPerHorse * this.sim.state.horses.length) this.setPhase('gate');
        break;
      case 'gate':
        if (this.phaseTime >= t.gateSeconds) {
          this.sim.start();
          this.setPhase('running');
        }
        break;
      case 'running':
        this.stepSim(dt);
        if (this.sim.state.finishOrder.length > 0) {
          this.winnerTime = this.sim.state.time;
          this.setPhase('finish');
        }
        break;
      case 'finish':
        this.stepSim(dt);
        if (this.phaseTime >= t.resultsDelaySeconds && (this.sim.allFinished || this.sim.state.time - this.winnerTime > t.finishTimeoutSeconds)) {
          const segments = this.recorder.plan(this.sim.state);
          if (segments.length) {
            this.replay = new ReplayPlayer(this.recorder, segments, this.sim.state);
            this.setPhase('replay');
            this.events.onReplaySegment?.(this.replay);
          } else {
            this.setPhase('results');
          }
        }
        break;
      case 'replay':
        this.stepSim(dt);
        if (this.replay) {
          const changed = this.replay.update(dt);
          if (this.replay.done) this.setPhase('results');
          else if (changed) this.events.onReplaySegment?.(this.replay);
        }
        break;
      case 'results':
        // Keep horses cantering behind the results board.
        this.stepSim(dt);
        break;
    }
  }

  private stepSim(dt: number): void {
    const step = 1 / this.race.simulation.tickRate;
    this.accumulator += dt * this.race.simulation.timeScale;
    let guard = 0;
    for (const p of this.players) this.sim.setInput(p.id, p.read());
    while (this.accumulator >= step && guard++ < 20) {
      this.sim.step(step);
      this.accumulator -= step;
    }
    if (guard >= 20) this.accumulator = 0;
    if (this.phase === 'running' || this.phase === 'finish') this.recorder.record(this.sim.state);
  }

  private setPhase(p: FlowPhase): void {
    this.phase = p;
    this.phaseTime = 0;
    this.events.onPhase(p);
  }
}

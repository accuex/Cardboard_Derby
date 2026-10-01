import { horseRoster, type HorseProfile } from '../config/horses';
import type { RaceConfig } from '../config/race';
import type { Course } from '../sim/Course';
import { neutralInput, type HorseInput } from '../sim/input';
import type { RaceState } from '../sim/types';
import type { PlayerBuild } from '../ui/BuildScreen';
import { RaceFlow } from './RaceFlow';
import type { FlowView, Session, SessionEvents } from './Session';

/** Everything runs in this tab (the Phase 1-5 mode). */
export class LocalSession implements Session {
  readonly online = false;
  private readonly raceFlow: RaceFlow;
  private input: HorseInput = neutralInput();
  private build: PlayerBuild | null;

  constructor(
    course: Course,
    race: RaceConfig,
    seed: number,
    readonly myGate: number | null,
    build: PlayerBuild | null,
    private readonly events: SessionEvents,
    skipIntro: boolean,
    /** The CPU field (TV mode draws a new one for every race). */
    private readonly field: HorseProfile[] = horseRoster,
  ) {
    this.build = myGate ? build : null;
    const players = myGate ? [{ id: myGate - 1, read: () => this.input }] : [];
    this.raceFlow = new RaceFlow(course, race, this.roster(), seed, events, skipIntro, players);
    const rf = this.raceFlow;
    this.flow = {
      get phase() { return rf.phase; },
      get phaseTime() { return rf.phaseTime; },
      get paddockIndex() { return rf.paddockIndex; },
      get viewState(): RaceState { return rf.viewState; },
      get liveState(): RaceState { return rf.sim.state; },
      get replay() { return rf.replay; },
    };
  }

  readonly flow: FlowView;

  /** The CPU field with the player's own build dropped into their gate. */
  private roster(): HorseProfile[] {
    return this.field.map((p, i) =>
      this.build && this.myGate === i + 1 ? { ...p, name: this.build.name, silkColor: this.build.silkColor, body: { ...this.build.body } } : p,
    );
  }

  /** Start without the build screen (watch mode / ?quick). */
  begin(): void {
    this.raceFlow.begin();
    this.events.onSetup();
  }

  /** Park in the build phase while the build screen is open. */
  showBuild(): void {
    this.raceFlow.showBuild();
  }

  update(dt: number, input: HorseInput | null): void {
    this.input = input ?? neutralInput();
    this.raceFlow.update(dt);
  }

  submitBuild(build: PlayerBuild): void {
    this.build = build;
    this.rematch();
  }

  startNow(): void {
    if (this.raceFlow.phase === 'build') this.rematch();
  }

  rematch(): void {
    this.raceFlow.setRoster(this.roster());
    this.raceFlow.restart(Math.floor(Math.random() * 1e9));
    this.events.onSetup();
  }

  skip(): void {
    this.raceFlow.skip();
  }
}

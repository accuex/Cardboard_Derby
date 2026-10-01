import type { LobbyInfo } from '../net/protocol';
import type { HorseInput } from '../sim/input';
import type { RaceState } from '../sim/types';
import type { PlayerBuild } from '../ui/BuildScreen';
import type { FlowPhase } from './phase';
import type { ReplayPlayer } from './Replay';

/** What the presentation layer needs to know about the race flow, wherever it runs. */
export interface FlowView {
  readonly phase: FlowPhase;
  readonly phaseTime: number;
  readonly paddockIndex: number;
  /** What to draw (replay state during replays). */
  readonly viewState: RaceState;
  /** The live race. */
  readonly liveState: RaceState;
  readonly replay: ReplayPlayer | null;
}

export interface SessionEvents {
  onPhase(phase: FlowPhase): void;
  onReplaySegment(player: ReplayPlayer): void;
  /** A new field was set up (new race or lobby change): rebuild views. */
  onSetup(): void;
  onLobby?(info: LobbyInfo | null): void;
  onNotice?(text: string): void;
}

/**
 * A game session: offline (LocalSession, simulation in this tab) or
 * online (NetSession, simulation on the server).
 */
export interface Session {
  readonly online: boolean;
  readonly flow: FlowView;
  /** Gate this browser plays, or null when only watching. */
  readonly myGate: number | null;
  update(dt: number, input: HorseInput | null): void;
  submitBuild(build: PlayerBuild): void;
  startNow(): void;
  rematch(): void;
  skip(): void;
}

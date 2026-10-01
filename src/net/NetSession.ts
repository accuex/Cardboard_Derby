import { io, type Socket } from 'socket.io-client';
import type { RaceConfig } from '../config/race';
import type { FlowPhase } from '../game/phase';
import { ReplayPlayer, ReplayRecorder } from '../game/Replay';
import type { FlowView, Session, SessionEvents } from '../game/Session';
import { createParts } from '../sim/damage';
import type { HorseInput } from '../sim/input';
import type { HorseState, RaceEvent, RaceState } from '../sim/types';
import type { TournamentView } from '../game/Tournament';
import type { PlayerBuild } from '../ui/BuildScreen';
import {
  decodeHorse,
  LERP_FIELDS,
  NET,
  raceStateSkeleton,
  type ClientRole,
  type ClientToServer,
  type LobbyInfo,
  type RaceSetup,
  type ServerToClient,
  type Snapshot,
} from './protocol';

/** Per tab: a reload or a phone waking up keeps the identity, a second tab is a second player. */
const TOKEN_KEY = 'cardboard-derby-token';
function loadToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}
const ENTRY_KEY = 'cardboard-derby-entry';
function loadEntry(): PlayerBuild | null {
  try {
    const raw = sessionStorage.getItem(ENTRY_KEY);
    return raw ? (JSON.parse(raw) as PlayerBuild) : null;
  } catch {
    return null;
  }
}
function saveEntry(b: PlayerBuild): void {
  try {
    sessionStorage.setItem(ENTRY_KEY, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}
function saveToken(t: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* private mode: reconnect works within this page only */
  }
}

interface Frame {
  snap: Snapshot;
  horses: HorseState[];
}

/**
 * Online session: the server runs the race; this side sends inputs and
 * interpolates between snapshots ~120ms in the past for smooth motion.
 */
export class NetSession implements Session {
  readonly online = true;
  readonly flow: FlowView;
  private readonly socket: Socket<ServerToClient, ClientToServer>;
  /** Public id (what other screens see as our owner id). */
  private publicId = '';
  tournament: TournamentView | null = null;
  /** Our tournament entry (public entrant id). */
  entrantId: string | null = null;
  onTournament: (() => void) | null = null;
  private setup: RaceSetup | null = null;
  private live: RaceState | null = null;
  private frames: Frame[] = [];
  /** serverTime - localTime estimate (ms). */
  private offset: number | null = null;
  private pendingEvents: { at: number; ev: RaceEvent }[] = [];
  private phase: FlowPhase = 'build';
  private phaseTime = 0;
  private paddockIndex = 0;
  private replayPlayer: ReplayPlayer | null = null;
  private replayIndex = -1;
  private readonly recorder: ReplayRecorder;
  private lastInputSent = 0;
  private lastInputKey = '';
  /** Adaptive interpolation delay (ms) from snapshot arrival jitter. */
  private delay = NET.interpolationDelayMs;
  private lastArrival = 0;
  private jitter = 0;
  /** Round-trip time to the server (ms). */
  rtt = 0;
  connected = false;
  private gate: number | null = null;
  lobby: LobbyInfo | null = null;
  private readyResolve: ((ok: boolean) => void) | null = null;
  /** Last submitted build, re-sent after a reconnect (e.g. server restart). */
  private lastBuild: PlayerBuild | null = loadEntry();

  constructor(
    race: RaceConfig,
    private readonly events: SessionEvents,
    role: ClientRole = 'play',
    url?: string,
  ) {
    this.recorder = new ReplayRecorder(race.replay);
    const auth = { token: loadToken(), role };
    this.socket = url ? io(url, { auth }) : io({ auth });
    const self = this;
    this.flow = {
      get phase() { return self.phase; },
      get phaseTime() { return self.phaseTime; },
      get paddockIndex() { return self.paddockIndex; },
      get viewState(): RaceState { return self.phase === 'replay' && self.replayPlayer ? self.replayPlayer.state : self.live!; },
      get liveState(): RaceState { return self.live!; },
      get replay() { return self.replayPlayer; },
    };
    this.socket.on('tournament', (v) => {
      this.tournament = v;
      this.onTournament?.();
    });
    this.socket.on('entry', (m) => {
      this.entrantId = m.entrantId;
      this.onTournament?.();
    });
    this.socket.on('welcome', (m) => {
      this.publicId = m.publicId;
      saveToken(m.clientId);
      auth.token = m.clientId;
    });
    this.socket.on('connect', () => (this.connected = true));
    // A hidden page can't steer: let the server hand the horse to a CPU until we're back
    document.addEventListener('visibilitychange', () => this.socket.emit('presence', document.visibilityState === 'visible'));
    this.socket.on('notice', (t) => this.events.onNotice?.(t));
    setInterval(() => {
      if (!this.socket.connected) return;
      this.socket.timeout(3000).emit('ping', performance.now(), (err: Error | null, t: number) => {
        if (!err) this.rtt = this.rtt ? this.rtt * 0.7 + (performance.now() - t) * 0.3 : performance.now() - t;
      });
    }, NET.pingIntervalMs);
    this.socket.on('setup', (s) => this.onSetup(s));
    this.socket.on('snap', (s) => this.onSnap(s));
    this.socket.on('assigned', (m) => {
      this.gate = m.gate;
      if (m.reason) this.events.onNotice?.(m.reason);
    });
    this.socket.on('disconnect', () => {
      this.connected = false;
      this.events.onNotice?.('サーバーとの接続が切れました。再接続しています…');
    });
    this.socket.io.on('reconnect', () => {
      this.events.onNotice?.('再接続しました');
      // The server remembers us by token; re-send the build in case it restarted
      if (this.lastBuild) this.socket.emit('join', this.lastBuild);
    });
  }

  /** Resolves true once the first race setup arrived, false if the server can't be reached. */
  ready(timeoutMs = 2500): Promise<boolean> {
    if (this.setup) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.readyResolve = resolve;
      setTimeout(() => {
        if (!this.setup) {
          this.readyResolve = null;
          this.socket.disconnect();
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  get raceInfo(): RaceSetup['race'] | null {
    return this.setup?.race ?? null;
  }

  get courseSetup(): { id: string; config: RaceSetup['course'] } | null {
    return this.setup ? { id: this.setup.courseId, config: this.setup.course } : null;
  }

  /** Raw socket for extra channels (Admin). */
  get rawSocket(): Socket<ServerToClient, ClientToServer> {
    return this.socket;
  }

  /** Our horse in the race on screen (not the queued one for the next race). */
  get myGate(): number | null {
    const h = this.setup?.horses.find((s) => s.owner === this.publicId);
    return h ? h.gate : null;
  }

  /** Tournament entrant id riding horse `id` in the current field. */
  entrantOfHorse(id: number): string | null {
    return this.setup?.horses[id]?.entrant ?? null;
  }

  get queuedGate(): number | null {
    return this.gate;
  }

  private onSetup(s: RaceSetup): void {
    const first = !this.setup;
    // The Admin switched venues: the 3D scene is built for one course, so start over (identity survives)
    if (this.setup && s.courseId !== this.setup.courseId) {
      location.reload();
      return;
    }
    this.setup = s;
    this.live = raceStateSkeleton(s, createParts);
    for (const h of this.live.horses) h.isPlayer = s.horses[h.id].owner === this.publicId;
    this.frames = [];
    this.pendingEvents = [];
    this.recorder.reset();
    this.replayPlayer = null;
    this.replayIndex = -1;
    if (first) {
      // The server forgot us (it restarted): enter again with the same horse
      if (this.lastBuild && !s.horses.some((h) => h.owner === this.publicId) && !this.entrantId) this.socket.emit('join', this.lastBuild);
      this.readyResolve?.(true);
    }
    this.events.onSetup();
  }

  private onSnap(s: Snapshot): void {
    if (!this.setup || s.raceId !== this.setup.raceId) return;
    const now = performance.now();
    // Jitter estimate drives the interpolation delay (more jitter = bigger buffer)
    if (this.lastArrival) {
      const dev = Math.abs(now - this.lastArrival - 1000 / NET.snapshotRate);
      this.jitter = this.jitter * 0.9 + dev * 0.1;
      const target = 1000 / NET.snapshotRate + 30 + this.jitter * 3;
      this.delay += (Math.min(NET.maxInterpolationDelayMs, Math.max(NET.minInterpolationDelayMs, target)) - this.delay) * 0.05;
    }
    this.lastArrival = now;
    const sample = s.serverTime - now;
    // Track the lowest-latency estimate; drift slowly so clock changes are followed
    this.offset = this.offset === null || sample > this.offset ? sample : this.offset * 0.98 + sample * 0.02;
    const template = this.live!;
    const horses = template.horses.map((h) => {
      const c = { ...h, parts: structuredClone(h.parts) };
      return c;
    });
    s.horses.forEach((w, i) => decodeHorse(w, horses[i]));
    this.frames.push({ snap: s, horses });
    if (this.frames.length > 40) this.frames.shift();
    for (const ev of s.events) this.pendingEvents.push({ at: s.serverTime, ev });
    this.lobby = s.lobby;
    this.events.onLobby?.(s.lobby);
  }

  update(dt: number, input: HorseInput | null): void {
    if (!this.live || !this.frames.length || this.offset === null) return;
    const now = performance.now();
    if (input && this.myGate !== null) {
      // Send immediately when something changed, otherwise a slow heartbeat
      const key = `${input.throttle}|${input.brake}|${input.steer.toFixed(2)}|${input.brace}|${input.pit}`;
      if (key !== this.lastInputKey || now - this.lastInputSent > 1000 / NET.inputHeartbeatHz) {
        this.lastInputKey = key;
        this.lastInputSent = now;
        this.socket.emit('input', input);
      }
    }
    const renderTime = now + this.offset - this.delay;
    const f = this.frames;
    let a = f[0];
    let b = f[f.length - 1];
    for (let i = f.length - 1; i > 0; i--) {
      if (f[i - 1].snap.serverTime <= renderTime) {
        a = f[i - 1];
        b = f[i];
        break;
      }
    }
    const span = b.snap.serverTime - a.snap.serverTime;
    const k = span > 0 ? Math.max(0, Math.min(1, (renderTime - a.snap.serverTime) / span)) : 1;
    this.applyFrame(a, b, k);
    // Starved (late packets): keep things moving briefly by extrapolating the newest frame
    const ahead = renderTime - b.snap.serverTime;
    if (ahead > 0 && b.snap.flow.phase === 'running') this.extrapolate(Math.min(ahead, NET.maxExtrapolationMs) / 1000);

    // flow phase follows the frame we are showing
    const shown = k < 1 ? a : b;
    const extra = Math.max(0, (renderTime - shown.snap.serverTime) / 1000);
    const nextPhase = shown.snap.flow.phase;
    this.paddockIndex = shown.snap.flow.paddockIndex;
    this.phaseTime = shown.snap.flow.phaseTime + extra;
    if (nextPhase !== this.phase) {
      this.phase = nextPhase;
      if (nextPhase !== 'replay') this.replayPlayer = null;
      this.events.onPhase(nextPhase);
    }

    // release events once their moment is on screen
    const due = this.pendingEvents.filter((p) => p.at <= renderTime);
    if (due.length) {
      this.pendingEvents = this.pendingEvents.filter((p) => p.at > renderTime);
      for (const { ev } of due) {
        this.live.events.push(ev);
        this.live.eventSeq = ev.seq;
      }
      if (this.live.events.length > 60) this.live.events.splice(0, this.live.events.length - 60);
    }

    if (this.phase === 'running' || this.phase === 'finish') this.recorder.record(this.live);
    this.updateReplay(shown.snap, dt);
  }

  private applyFrame(a: Frame, b: Frame, k: number): void {
    const live = this.live!;
    const src = k < 0.5 ? a : b;
    live.phase = src.snap.race.phase;
    live.time = a.snap.race.time + (b.snap.race.time - a.snap.race.time) * k;
    live.order = src.snap.race.order;
    live.finishOrder = b.snap.race.finishOrder;
    live.horses.forEach((h, i) => {
      const ha = a.horses[i];
      const hb = b.horses[i];
      const s = k < 0.5 ? ha : hb;
      const isPlayer = h.isPlayer;
      Object.assign(h, s, { parts: s.parts, isPlayer });
      const rec = h as unknown as Record<string, number>;
      for (const key of LERP_FIELDS) rec[key] = (ha[key] as number) + ((hb[key] as number) - (ha[key] as number)) * k;
      h.courseS = hb.courseS;
      h.finished = hb.finished;
      h.finishTime = hb.finishTime;
    });
  }

  private extrapolate(sec: number): void {
    for (const h of this.live!.horses) {
      if (h.status !== 'running') continue;
      h.x += h.dirX * h.speed * sec;
      h.z += h.dirZ * h.speed * sec;
      h.progress += h.speed * sec;
    }
  }

  /** Current interpolation delay, for diagnostics. */
  get interpolationDelay(): number {
    return this.delay;
  }

  private updateReplay(snap: Snapshot, dt: number): void {
    if (this.phase !== 'replay' || !snap.replay) return;
    if (!this.replayPlayer) {
      this.replayPlayer = new ReplayPlayer(this.recorder, snap.replay.segments, this.live!);
      this.replayIndex = -1;
    }
    if (snap.replay.index !== this.replayIndex) {
      this.replayIndex = snap.replay.index;
      this.replayPlayer.jumpTo(snap.replay.index);
      if (this.replayPlayer.segment) this.events.onReplaySegment(this.replayPlayer);
    } else {
      this.replayPlayer.advanceWithin(dt);
    }
  }

  /** This tab entered a horse earlier (survives reloads and server restarts). */
  get hasEntry(): boolean {
    return !!this.lastBuild;
  }

  submitBuild(build: PlayerBuild): void {
    this.lastBuild = build;
    saveEntry(build);
    this.socket.emit('join', build);
  }

  startNow(): void {
    this.socket.emit('start');
  }

  rematch(): void {
    this.socket.emit('rematch');
  }

  skip(): void {
    this.socket.emit('skip');
  }
}

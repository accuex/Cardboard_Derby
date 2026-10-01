import { courseConfig } from '../config/course';
import { raceConfig } from '../config/race';
import { horseRoster } from '../config/horses';
import { LocalSession } from '../game/LocalSession';
import { KeyboardInput } from '../game/PlayerInput';
import type { Session } from '../game/Session';
import type { FlowPhase } from '../game/phase';
import { NetSession } from '../net/NetSession';
import { RaceRenderer } from '../render/RaceRenderer';
import { Course } from '../sim/Course';
import type { RaceState } from '../sim/types';
import { BuildScreen, loadSavedBuild, type PlayerBuild } from './BuildScreen';
import { BroadcastAudio } from './BroadcastAudio';
import { PaddockCard, ReplayBug, WinnerCard } from './BroadcastOverlays';
import { Hud } from './Hud';
import { LobbyOverlay } from './LobbyOverlay';
import { Particles } from './Particles';
import { reducedMotion } from './prefs';
import { ResultsOverlay } from './ResultsOverlay';
import { SettingsPanel } from './SettingsPanel';
import { TitleOverlay } from './TitleOverlay';
import { raceTitle } from './format';

export interface UiOptions {
  /** This screen rides a horse (keyboard / build screen). */
  canPlay: boolean;
  skipIntro?: boolean;
  /** Share one sound engine across rebuilds (the TV mode keeps it unlocked between races). */
  audio?: BroadcastAudio;
  /** Own ⚙ and 🔊 buttons (off when the host page provides persistent ones). */
  chrome?: boolean;
  /** TV broadcast: display only, the caller drives the programme. */
  tv?: boolean;
  /** Called after the UI has reacted to a phase change. */
  onPhase?: (phase: FlowPhase) => void;
}

/**
 * All presentation: 3D view, HUD, overlays, sound. Talks to the race only through the Session.
 * Reads the current raceConfig / courseConfig when constructed; build a new one for a new venue or race.
 */
export class BroadcastUi {
  private readonly course = new Course(courseConfig);
  private readonly app = document.getElementById('app')!;
  readonly renderer: RaceRenderer;
  private readonly hud: Hud;
  readonly audio: BroadcastAudio;
  private readonly fx = new Particles();
  private readonly paddockCard = new PaddockCard();
  private readonly winnerCard = new WinnerCard();
  private readonly replayBug = new ReplayBug();
  private readonly muteBtn = document.createElement('button');
  private readonly title: TitleOverlay;
  readonly results: ResultsOverlay;
  /** Only screens that ride a horse get one (its preview owns a WebGL context). */
  private readonly buildScreen: BuildScreen | null;
  private readonly lobby: LobbyOverlay | null;
  private readonly keyboard = new KeyboardInput();
  private readonly gradeSparkles: number;
  private readonly canPlay: boolean;
  private readonly nodes: HTMLElement[];
  private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private audioEventSeq = 0;
  private resultsRefresh = 0;
  private last = performance.now();
  private raf = 0;
  private disposed = false;

  constructor(private readonly session: Session, private readonly opts: UiOptions) {
    const race = raceConfig;
    const canPlay = (this.canPlay = opts.canPlay);
    this.audio = opts.audio ?? new BroadcastAudio();
    this.renderer = new RaceRenderer(this.app, this.course, race);
    this.hud = new Hud(race, `${courseConfig.surface}${race.distance.toLocaleString()}m ・ ${courseConfig.venueName}`, this.course);
    this.title = new TitleOverlay(race, courseConfig, session.flow.liveState?.horses.length ?? horseRoster.length);
    // The big screen (/host) and the TV mode are display-only: no buttons
    const restart = opts.tv ? null : canPlay || !session.online ? () => session.rematch() : null;
    this.results = new ResultsOverlay(race, restart, canPlay ? () => this.openBuild() : undefined);
    this.buildScreen = canPlay ? new BuildScreen((b) => this.onBuilt(b)) : null;
    this.lobby = session.online
      ? new LobbyOverlay(raceTitle(race, true), canPlay ? () => session.startNow() : null, canPlay ? () => this.openBuild() : null)
      : null;
    this.gradeSparkles = race.grade === 'G1' ? 140 : race.grade === 'G2' ? 90 : 55;

    const chrome: HTMLElement[] = [];
    if (opts.chrome !== false) {
      this.muteBtn.className = 'mute-btn';
      this.muteBtn.addEventListener('click', () => this.setMute(!this.audio.muted));
      this.setMute(false);
      const settings = new SettingsPanel({ graphics: true, sound: true, resolution: () => this.renderer.resolutionScale });
      chrome.push(settings.button, settings.panel, this.muteBtn);
    }
    this.replayBug.root.addEventListener('click', () => session.skip());
    this.nodes = [
      ...chrome.slice(0, 2),
      this.fx.canvas, this.hud.root, this.paddockCard.root, this.winnerCard.root, this.replayBug.root, this.title.root,
      this.results.root, ...(this.lobby ? [this.lobby.root] : []), ...(this.buildScreen ? [this.buildScreen.root] : []), this.replayBug.wipe, ...chrome.slice(2),
    ];
    this.app.append(...this.nodes);
    this.audio.onUnlock = () => {
      if (session.flow.phase === 'intro' && session.flow.phaseTime < 2) this.audio.fanfare(race.grade);
    };
    this.renderer.director.onShotChange = (label) => this.hud.setCamera(label);
    if (this.lobby) {
      // 表彰式: confetti and a fanfare
      this.lobby.onAwards = () => {
        this.fx.confetti(reducedMotion() ? 60 : 320);
        this.fx.sparkles(reducedMotion() ? 20 : 120);
        this.audio.fanfare('G1');
      };
    }
    window.addEventListener('keydown', this.keyHandler);
    (window as unknown as { __derby: unknown }).__derby = { session, renderer: this.renderer, course: this.course, tick: (dt: number) => this.tick(dt), audio: this.audio };
  }

  begin(): void {
    const s = this.session;
    if (this.opts.tv && s instanceof LocalSession) s.showBuild();
    else if (s instanceof LocalSession) {
      if (s.myGate && !this.opts.skipIntro) this.openBuild();
      else s.begin();
    } else if (this.canPlay && s instanceof NetSession) {
      if (this.opts.skipIntro && !s.hasEntry) s.submitBuild(loadSavedBuild());
      else if (!s.hasEntry) this.openBuild(); // a reload keeps the entry; no need to design again
    }
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Tear everything down (the TV mode builds a fresh view for every race). */
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyHandler);
    for (const n of this.nodes) n.remove();
    this.fx.dispose();
    this.renderer.dispose();
    this.audio.onUnlock = null;
    this.audio.hooves(0, 1);
  }

  notice(text: string): void {
    this.hud.tick(text, 'tick-split');
  }

  private setMute(m: boolean): void {
    this.audio.setMuted(m);
    this.muteBtn.textContent = m ? '🔇' : '🔊';
    this.muteBtn.title = m ? '音を出す (M)' : 'ミュート (M)';
  }

  private openBuild(): void {
    const s = this.session;
    if (s instanceof LocalSession) s.showBuild();
    const gate = s instanceof NetSession ? (s.queuedGate ?? s.myGate ?? 1) : (s.myGate ?? 1);
    this.buildScreen?.show(gate);
  }

  private onBuilt(b: PlayerBuild): void {
    this.buildScreen?.hide();
    this.session.submitBuild(b);
  }

  private get buildOpen(): boolean {
    return !!this.buildScreen?.root.classList.contains('show');
  }

  private onKey(e: KeyboardEvent): void {
    if (this.buildOpen) return; // typing a name
    const s = this.session;
    if (this.opts.tv) return; // the TV mode handles its own keys
    if (e.key === 'm' || e.key === 'M') this.setMute(!this.audio.muted);
    if (e.key === 'Enter') s.flow.phase === 'build' ? s.startNow() : s.skip();
    if ((e.key === 'r' || e.key === 'R') && (!s.online || s.flow.phase === 'results')) s.rematch();
    if ((e.key === 'b' || e.key === 'B') && this.canPlay && (s.flow.phase === 'results' || s.flow.phase === 'build')) this.openBuild();
    if (e.key === 'v' || e.key === 'V') {
      this.renderer.swapViews = !this.renderer.swapViews;
      this.hud.setSwapped(this.renderer.swapViews);
    }
  }

  onSetup(): void {
    const live = this.session.flow.liveState;
    if (!live) return;
    this.renderer.setRace(live);
    this.hud.setRace(live);
    this.audioEventSeq = 0;
    this.fx.clear();
    this.winnerCard.hide();
    this.replayBug.hide();
    this.paddockCard.reset();
  }

  onPhase(phase: FlowPhase): void {
    if (this.disposed) return;
    const live = this.session.flow.liveState;
    switch (phase) {
      case 'build':
        this.title.hide();
        this.results.hide();
        this.winnerCard.hide();
        this.audio.crowd(0.05);
        break;
      case 'intro':
        this.title.show();
        this.results.hide();
        this.winnerCard.hide();
        this.audio.fanfare(raceConfig.grade);
        this.audio.crowd(0.3);
        this.fx.sparkles(reducedMotion() ? 15 : this.gradeSparkles);
        break;
      case 'paddock':
        this.title.hide();
        this.paddockCard.reset();
        this.audio.crowd(0.15);
        break;
      case 'gate':
        this.title.hide();
        this.results.hide();
        this.hud.flash('まもなく発走', 'small');
        this.audio.crowd(0.1);
        this.audio.chime();
        break;
      case 'running':
        this.title.hide();
        this.renderer.openGate();
        this.audio.gateBell();
        this.hud.flash('スタート！');
        break;
      case 'finish':
        this.winnerCard.show(live);
        // gentle flash (photosensitivity); none with reduced motion
        if (!reducedMotion()) {
          this.fx.flash(0.45);
          this.fx.confetti(raceConfig.grade === 'G1' ? 260 : 170);
        } else this.fx.confetti(40);
        this.audio.goal();
        break;
      case 'results':
        this.replayBug.hide();
        this.winnerCard.hide();
        this.renderer.director.replaySegment = null;
        this.markAdvancing(live);
        this.results.show(live);
        break;
    }
    this.opts.onPhase?.(phase);
  }

  /** Tournament: tag the horses that go through to the next round. */
  private markAdvancing(live: RaceState): void {
    const s = this.session;
    const t = s instanceof NetSession ? s.tournament : null;
    if (!(s instanceof NetSession) || !t || s.lobby?.mode !== 'tournament') return this.results.clearTournament();
    const entrantOf = (id: number) => s.entrantOfHorse(id);
    const races = t.rounds.flatMap((r) => r.races);
    const myEntrants = new Set(live.horses.map((h) => entrantOf(h.id)).filter(Boolean));
    const race = [...races].reverse().find((r) => r.entrants.some((e) => myEntrants.has(e)));
    if (!race) return this.results.clearTournament();
    const round = t.rounds.find((r) => r.races.includes(race))!;
    const next = round.kind === 'heat' ? (t.rounds.length > 1 ? t.rounds[1].label : '次のラウンド') : '決勝';
    const share = round.kind === 'heat' ? t.heatQualifiers : round.kind === 'semi' ? Math.floor(t.finalSize / round.races.length) : 0;
    const adv = new Map<number, string>();
    if (round.kind !== 'final') {
      const ordered = live.order.filter((id) => entrantOf(id));
      const winners = race.qualifiers.length ? live.horses.filter((h) => race.qualifiers.includes(entrantOf(h.id)!)).map((h) => h.id) : ordered.slice(0, share);
      for (const id of winners) adv.set(id, `${next}へ`);
    }
    this.results.setTournament(adv);
  }

  onReplaySegment(player: NonNullable<Session['flow']['replay']>): void {
    if (this.disposed) return;
    this.renderer.director.replaySegment = player.segment;
    this.winnerCard.hide();
    if (player.segment) this.replayBug.show(player.segment, player.state);
  }

  private frame(now: number): void {
    if (this.disposed) return;
    this.tick(Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    if (!this.disposed) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  tick(dt: number): void {
    const s = this.session;
    s.update(dt, this.canPlay ? this.keyboard.read() : null);
    if (this.disposed) return; // a phase hook may have moved on to the next race
    const flow = s.flow;
    const state = flow.viewState;
    const live = flow.liveState;
    if (!state || !live) return;
    const director = this.renderer.director;
    director.paddockIndex = flow.paddockIndex;
    director.paddockSeconds = raceConfig.timing.paddockSecondsPerHorse;
    director.replayTime = flow.replay?.segmentTime ?? 0;
    this.renderer.render(state, flow.phase, flow.phaseTime, dt);
    const leader = state.horses[state.order[0]];
    this.hud.update(state, flow.phase, this.course.segmentAt(leader.courseS).label, dt);
    this.paddockCard.update(flow.phase === 'paddock' ? live.horses[flow.paddockIndex] : null, flow.phase === 'paddock');
    if (this.winnerCard.update(live, dt)) {
      this.fx.sparkles(40, { x: window.innerWidth * 0.2, y: window.innerHeight * 0.6, w: window.innerWidth * 0.6, h: window.innerHeight * 0.3 });
    }
    if (this.lobby && s instanceof NetSession) this.lobby.update(s.lobby, flow.phase === 'build' && !this.buildOpen, s.queuedGate ?? s.myGate, s.tournament, s.entrantId);

    // Crowd follows the race; crashes make a noise
    if (flow.phase === 'running') {
      const rem = live.distance - live.horses[live.order[0]].progress;
      this.audio.crowd(rem < 400 ? 0.4 + 0.6 * (1 - rem / 400) : 0.25);
    }
    for (const ev of live.events) {
      if (ev.seq <= this.audioEventSeq) continue;
      this.audioEventSeq = ev.seq;
      const h = live.horses[ev.horseId];
      // keep the soundscape readable: small sounds only for the leaders or the player's horse
      const notable = h && (h.isPlayer || h.rank <= 3);
      if (ev.type === 'fall') this.audio.crash(1);
      else if (ev.type === 'collision' && (ev.value ?? 0) > 2) this.audio.crash(0.4);
      else if (ev.type === 'partLost') this.audio.pop();
      else if (ev.type === 'tapePeel' && notable) this.audio.tapeRip();
      else if (ev.type === 'legLift' && notable) this.audio.creak();
      else if (ev.type === 'brace' && h?.isPlayer) this.audio.brace();
      else if (ev.type === 'repairStart') this.audio.tapeRoll();
    }
    // hoofbeats grow as the field passes close to the camera
    if (flow.phase === 'running' || flow.phase === 'finish') {
      const cam = this.renderer.director.camera.position;
      let near = 0;
      for (const h of state.horses) {
        const d = Math.hypot(h.x - cam.x, h.z - cam.z);
        if (h.status === 'running' && d < 60) near += (1 - d / 60) * Math.min(1, h.speed / 15);
      }
      this.audio.hooves(Math.min(1, near / 3), dt);
    }
    if (flow.phase === 'results' && (this.resultsRefresh += dt) > 0.5) {
      this.resultsRefresh = 0;
      this.results.refresh(live);
    }
  }
}

import { courseConfig } from '../config/course';
import { coursePresets } from '../config/courses';
import { pacingConfig, type HorseProfile } from '../config/horses';
import { raceConfig } from '../config/race';
import { LocalSession } from '../game/LocalSession';
import type { SessionEvents } from '../game/Session';
import type { FlowPhase } from '../game/phase';
import { Course } from '../sim/Course';
import { BroadcastAudio } from '../ui/BroadcastAudio';
import { BroadcastUi } from '../ui/BroadcastUi';
import { el, raceTitle } from '../ui/format';
import { SettingsPanel } from '../ui/SettingsPanel';
import { payouts, popularity, predictionMarks, toOdds, tvPacing, winProbabilities, type OddsJob, type OddsProgress } from './odds';
import { PRIZE_SHARE, createDay, drawField, formatYen, type TvDay, type TvRace } from './Programme';
import { createStable, type TvHorse } from './Stable';
import { TvGuide, type GuideOdds } from './TvGuide';

const SAVE_KEY = 'cardboard-derby-tv-v1';
const ODDS_SIMS = 60;

interface SavedTv {
  seed: number;
  stable: TvHorse[];
  day: TvDay;
  index: number;
}

/**
 * 競馬中継モード (/tv): watch AI races one after another, like a TV racing programme.
 * A day is 12 races at one venue (main race 11R); between races the programme screen shows
 * today's card, the next 出馬表 and odds computed from trial races run in a Web Worker.
 * The day, the stable and every horse's record persist in this browser.
 *
 * URL options: ?races=N (races per day, the last N of the card) ?guide=秒 ?reset ?speed=N
 */
export class TvApp {
  private readonly app = document.getElementById('app')!;
  private readonly audio = new BroadcastAudio();
  private readonly guide = new TvGuide();
  private readonly bug = el('div', 'tv-bug');
  private readonly muteBtn = el('button', 'mute-btn');
  private readonly settings: SettingsPanel;
  private readonly racesPerDay: number;
  private readonly guideSeconds: number;
  private readonly resultsSeconds = 16;
  private readonly summarySeconds = 40;
  private state: SavedTv;
  private ui: BroadcastUi | null = null;
  private session: LocalSession | null = null;
  private worker: Worker | null = null;
  private oddsJobId = 0;
  private live: GuideOdds | null = null;
  private liveProb: number[] | null = null;
  /** 'guide' = countdown to post time, 'race' = on air, 'summary' = end of the day. */
  private mode: 'guide' | 'race' | 'summary' = 'guide';
  private countdown = 0;
  private resultsAt = -1;
  private last = performance.now();
  private guideRefresh = 0;

  constructor(params: URLSearchParams) {
    this.racesPerDay = Math.max(1, Math.min(12, Number(params.get('races')) || 12));
    this.guideSeconds = Math.max(5, Number(params.get('guide')) || 30);
    if (params.has('speed')) raceConfig.simulation.timeScale = Number(params.get('speed')) || 1;
    const saved = params.has('reset') ? null : load();
    if (saved && saved.day.races.length !== this.racesPerDay && !saved.day.races.some((r) => r.result)) saved.day = createDay(saved.day.day, saved.seed, this.racesPerDay);
    const seed = Math.floor(Math.random() * 1e9);
    this.state = saved ?? { seed, stable: createStable(seed), day: createDay(1, seed, this.racesPerDay), index: 0 };

    document.body.classList.add('tv-mode');
    Object.assign(pacingConfig, tvPacing);
    this.settings = new SettingsPanel({ graphics: true, sound: true, resolution: () => this.ui?.renderer.resolutionScale ?? 1 });
    this.muteBtn.addEventListener('click', () => this.setMute(!this.audio.muted));
    this.setMute(false);
    this.app.append(this.guide.root, this.bug, this.settings.button, this.settings.panel, this.muteBtn);
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.guide.root.addEventListener('click', () => this.mode === 'guide' && this.countdown > 3 && (this.countdown = 3));
    (window as unknown as { __tv: unknown }).__tv = this;
  }

  start(): void {
    this.prepareRace();
    if (this.race.result) this.advance(); // reopened after the last race of the day
    requestAnimationFrame((t) => this.frame(t));
  }

  private get race(): TvRace {
    return this.state.day.races[this.state.index];
  }

  private field(race: TvRace): HorseProfile[] {
    return race.field!.map((id) => this.state.stable[id].profile);
  }

  /** Set the venue and race, build the view, park in the programme screen. */
  private prepareRace(): void {
    const { day } = this.state;
    const race = this.race;
    const venue = coursePresets.find((v) => v.id === day.venueId) ?? coursePresets[0];
    Object.assign(courseConfig, venue.config);
    const main = race.grade === 'G1' || race.grade === 'G2' || race.grade === 'G3';
    Object.assign(raceConfig, {
      raceNo: race.no,
      edition: race.edition,
      name: race.name,
      grade: race.grade,
      distance: race.distance,
      weather: `${day.weather}・${day.going}`,
      tagline: race.tagline,
      playerGate: null,
    });
    // ordinary races get a shorter title and introductions; the main race the full show
    raceConfig.timing.introSeconds = main ? 7 : 4.5;
    raceConfig.timing.paddockSecondsPerHorse = main ? 3 : 1.8;
    if (!race.field) race.field = drawField(this.state.stable, day, race, this.state.seed);
    save(this.state);

    this.ui?.dispose();
    let ui: BroadcastUi | null = null;
    const handlers: SessionEvents = {
      onPhase: (p) => ui?.onPhase(p),
      onReplaySegment: (r) => ui?.onReplaySegment(r),
      onSetup: () => ui?.onSetup(),
      onNotice: (t) => ui?.notice(t),
    };
    const session = new LocalSession(new Course(courseConfig), raceConfig, Math.floor(Math.random() * 1e9), null, null, handlers, false, this.field(race));
    ui = new BroadcastUi(session, { canPlay: false, tv: true, audio: this.audio, chrome: false, onPhase: (p) => this.onPhase(p) });
    this.ui = ui;
    this.session = session;
    ui.onSetup();
    ui.begin();
    this.mode = 'guide';
    this.countdown = this.guideSeconds;
    this.resultsAt = -1;
    this.startOdds(race);
    this.renderGuide();
    this.updateBug();
  }

  private startOdds(race: TvRace): void {
    this.worker?.terminate();
    this.live = null;
    this.liveProb = null;
    const id = ++this.oddsJobId;
    const job: OddsJob = { id, course: { ...courseConfig }, race: structuredClone(raceConfig), field: this.field(race), sims: ODDS_SIMS, seed: Math.floor(Math.random() * 1e9), pacing: tvPacing };
    try {
      this.worker = new Worker(new URL('./oddsWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<OddsProgress>) => e.data.id === this.oddsJobId && this.applyOdds(e.data.wins, e.data.done);
      this.worker.onerror = () => this.applyOdds(new Array(race.field!.length).fill(0), 0);
      this.worker.postMessage(job);
    } catch {
      this.applyOdds(new Array(race.field!.length).fill(0), 0);
    }
  }

  private applyOdds(wins: number[], done: number): void {
    const race = this.race;
    const earnings = race.field!.map((id) => this.state.stable[id].earnings);
    const prob = winProbabilities(wins, done, earnings);
    const odds = toOdds(prob);
    this.liveProb = prob;
    this.live = { odds, pop: popularity(odds), marks: predictionMarks(prob, odds), done, total: ODDS_SIMS };
    this.guideRefresh = 1; // redraw soon
  }

  private renderGuide(): void {
    if (this.mode === 'summary') return;
    this.guide.showCard(this.state.day, this.state.stable, this.race, this.live);
    this.guideFooter();
  }

  private guideFooter(): void {
    const prev = [...this.state.day.races].reverse().find((r) => r.result);
    const prevText = prev
      ? `前のレース ${prev.no}R ${prev.name}　1着 ${this.state.stable[prev.result!.order[0]].profile.name}　単勝 ${formatYen(prev.result!.payWin)}`
      : '本日の第1競走です';
    const sound = this.audio.ready || this.audio.muted ? '' : '<span class="tvg-sound">🔈 画面をクリックするかキーを押すと音が出ます</span>';
    this.guide.setFooter(`<span>${prevText}</span>${sound}<span class="tvg-keys">Enter すぐ発走　M 音声　F 全画面</span>`);
  }

  /** Odds are fixed when the gates are about to open. */
  private goToPost(): void {
    const race = this.race;
    this.worker?.terminate();
    this.worker = null;
    if (!this.live) this.applyOdds(new Array(race.field!.length).fill(0), 0);
    race.odds = this.live!.odds;
    race.prob = this.liveProb;
    save(this.state);
    this.guide.hide();
    this.mode = 'race';
    this.session!.startNow();
    // 人気 next to the names on the result board
    const tags = new Map<number, string>();
    race.odds.forEach((o, i) => tags.set(i, `${this.live!.pop[i]}番人気 ${o.toFixed(1)}倍`));
    this.ui!.results.setTags(tags);
    this.updateBug();
  }

  private onPhase(phase: FlowPhase): void {
    if (phase === 'results' && this.mode === 'race' && this.resultsAt < 0) {
      this.resultsAt = 0;
      this.recordResult();
    }
    this.updateBug();
  }

  /** 確定: update every runner's record and prize money, show the payouts. */
  private recordResult(): void {
    const race = this.race;
    const state = this.session!.flow.liveState;
    const field = race.field!;
    const finished = state.order.map((i) => state.horses[i].finished);
    const order = state.order.map((i) => field[i]);
    state.order.forEach((gi, pos) => {
      const h = this.state.stable[field[gi]];
      const place = state.horses[gi].finished ? pos + 1 : 0;
      h.starts++;
      if (place === 1) h.wins++;
      if (place === 2) h.seconds++;
      if (place === 3) h.thirds++;
      if (place >= 1 && place <= PRIZE_SHARE.length) h.earnings += Math.round(race.prize * PRIZE_SHARE[place - 1]);
      h.form = [place, ...h.form].slice(0, 5);
      h.lastRaceKey = race.key;
    });
    const odds = race.odds!;
    const prob = race.prob ?? odds.map((o) => 0.8 / o);
    const [a, b, c] = state.finishOrder;
    const pay = payouts(prob, odds, a, b, c);
    const pop = popularity(odds);
    const winner = state.horses[a];
    race.result = {
      order,
      finished,
      winnerTime: winner?.finishTime ?? null,
      winnerOdds: odds[a],
      winnerPop: pop[a],
      payWin: pay.win,
      payPlace: pay.place,
      payQuinella: pay.quinella,
      falls: state.horses.reduce((s, h) => s + h.falls, 0),
      partsLost: state.events.filter((ev) => ev.type === 'partLost').length,
    };
    save(this.state);
    const g = (i: number | undefined) => (i === undefined ? '' : `<span class="tvr-num">${i + 1}</span>`);
    const big = pay.win >= 10000 ? '<span class="tvr-big">万馬券！</span>' : pay.win >= 3000 ? '<span class="tvr-big">高配当</span>' : '';
    this.ui!.results.setFooter(
      `<div class="tv-pay"><b>払戻金</b>` +
        `<span>単勝 ${g(a)} ${formatYen(pay.win)}（${pop[a]}番人気）</span>` +
        `<span>複勝 ${[a, b, c].map((i, k) => (i === undefined ? '' : `${g(i)} ${formatYen(pay.place[k])}`)).join('　')}</span>` +
        (b !== undefined ? `<span>馬連 ${g(Math.min(a, b))}-${g(Math.max(a, b))} ${formatYen(pay.quinella)}</span>` : '') +
        big +
        `</div>`,
    );
  }

  /** On to the next race, or the end-of-day summary. */
  private advance(): void {
    if (this.state.index + 1 < this.state.day.races.length) {
      this.state.index++;
      this.prepareRace();
      return;
    }
    this.mode = 'summary';
    this.ui?.results.hide();
    this.countdown = this.summarySeconds;
    const next = coursePresets[this.state.day.day % coursePresets.length];
    this.guide.showSummary(this.state.day, this.state.stable, next.config.venueName);
    this.guide.setFooter('<span>本日もご覧いただきありがとうございました</span><span class="tvg-keys">Enter 次の開催へ</span>');
    this.audio.fanfare('G1');
    this.updateBug();
  }

  private nextDay(): void {
    const d = this.state.day.day + 1;
    this.state.day = createDay(d, this.state.seed, this.racesPerDay);
    this.state.index = 0;
    this.prepareRace();
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  private update(dt: number): void {
    if (this.mode === 'guide') {
      this.countdown -= dt;
      this.guide.setCountdown('発走まで', this.countdown);
      if ((this.guideRefresh -= dt) <= 0) {
        this.guideRefresh = 0.5;
        this.renderGuide();
      }
      if (this.countdown <= 0) this.goToPost();
    } else if (this.mode === 'summary') {
      this.countdown -= dt;
      this.guide.setCountdown('次の開催まで', this.countdown);
      if (this.countdown <= 0) this.nextDay();
    } else if (this.resultsAt >= 0) {
      this.resultsAt += dt;
      this.bug.classList.add('hide'); // the result board uses the whole screen
      if (this.resultsAt >= this.resultsSeconds) this.advance();
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const k = e.key.toLowerCase();
    if (k === 'm') this.setMute(!this.audio.muted);
    if (k === 'f') {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    }
    if (k === 'enter' || k === ' ') {
      e.preventDefault();
      if (this.mode === 'guide') this.countdown = Math.min(this.countdown, 0.01);
      else if (this.mode === 'summary') this.nextDay();
      else if (this.resultsAt >= 0) this.advance();
      else this.session?.skip();
    }
  }

  private setMute(m: boolean): void {
    this.audio.setMuted(m);
    this.muteBtn.textContent = m ? '🔇' : '🔊';
    this.muteBtn.title = m ? '音を出す (M)' : 'ミュート (M)';
  }

  /** Channel logo in the corner, like a TV station's watermark. */
  private updateBug(): void {
    const r = this.race;
    const on = this.mode === 'race';
    this.bug.classList.remove('hide');
    this.bug.innerHTML = `<b>段ボール競馬</b><span>中継</span><span class="tv-bug-race">${on ? `第${this.state.day.day}日 ${r.no}R ${r.postTime}発走` : this.mode === 'summary' ? '本日の全レース終了' : `次は ${r.no}R`}</span>`;
    this.bug.title = raceTitle(raceConfig, true);
  }
}

function load(): SavedTv | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedTv;
    if (!s.stable?.length || !s.day?.races?.length) return null;
    // a race interrupted mid-broadcast is run again from the programme screen
    const r = s.day.races[s.index];
    if (r && !r.result) r.odds = r.prob = null;
    if (r?.result && s.index + 1 < s.day.races.length) s.index++;
    return s;
  } catch {
    return null;
  }
}

function save(s: SavedTv): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* private mode: the programme just restarts next time */
  }
}

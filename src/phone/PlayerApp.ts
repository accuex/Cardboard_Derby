import { courseConfig } from '../config/course';
import { gateColors } from '../config/horses';
import { raceConfig } from '../config/race';
import { applyQuality } from '../config/render';
import { prefs } from '../ui/prefs';
import { buzz, HAPTIC } from '../ui/haptics';
import { SettingsPanel } from '../ui/SettingsPanel';
import { applyDocumentPrefs } from '../ui/prefs';
import type { FlowPhase } from '../game/phase';
import type { SessionEvents } from '../game/Session';
import { NetSession } from '../net/NetSession';
import { RaceRenderer } from '../render/RaceRenderer';
import { judgeBuildType } from '../sim/buildType';
import { Course } from '../sim/Course';
import type { HorseState } from '../sim/types';
import { BuildScreen, loadSavedBuild, type PlayerBuild } from '../ui/BuildScreen';
import { el, formatRaceTime } from '../ui/format';
import { PlayerPanel } from '../ui/PlayerPanel';
import { bracketHtml } from '../ui/TournamentBoard';
import { viewStanding } from '../game/Tournament';
import { TouchController } from './TouchController';

const JOCKEY_KEY = 'cardboard-derby-jockey';
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const loadJockey = () => {
  try {
    return localStorage.getItem(JOCKEY_KEY) ?? '';
  } catch {
    return '';
  }
};
const saveJockey = (n: string) => {
  try {
    localStorage.setItem(JOCKEY_KEY, n);
  } catch {
    /* ignore */
  }
};

type Screen = 'connecting' | 'name' | 'build' | 'lobby' | 'race' | 'results' | 'watch';

const PHASE_MSG: Partial<Record<FlowPhase, string>> = {
  intro: 'まもなくレース紹介',
  paddock: '出走馬紹介中…',
  gate: 'ゲートイン！ まもなく発走',
  finish: 'ゴール！',
  replay: 'リプレイ中',
};

/**
 * Smartphone player screen (opened from the QR code, ?player):
 * name → build → lobby → touch controller with a light chase view → result.
 */
export class PlayerApp {
  private readonly root = el('div', 'phone');
  private readonly view = el('div', 'ph-view');
  private readonly top = el('div', 'ph-top');
  private readonly banner = el('div', 'ph-banner');
  private readonly ticker = el('div', 'ph-ticker');
  private readonly panel = new PlayerPanel();
  private readonly controller = new TouchController();
  private readonly nameScreen = el('div', 'ph-screen ph-name');
  private readonly lobbyScreen = el('div', 'ph-screen ph-lobby');
  private readonly resultScreen = el('div', 'ph-screen ph-result');
  private readonly connScreen = el('div', 'ph-conn', 'サーバーに接続しています…');
  private readonly buildScreen: BuildScreen;
  private readonly session: NetSession;
  private renderer: RaceRenderer | null = null;
  private course = new Course(courseConfig);
  private jockey = loadJockey();
  private submitted = false;
  private screen: Screen = 'connecting';
  private last = performance.now();
  private wakeLock: { release(): Promise<void> } | null = null;
  private resultShownFor = -1;
  private hapticSeq = 0;

  constructor() {
    const q = prefs().quality;
    applyQuality(q === 'auto' ? 'low' : q);
    const events: SessionEvents = {
      onPhase: (p) => this.onPhase(p),
      onReplaySegment: () => {},
      onSetup: () => this.onSetup(),
      onNotice: (t) => this.notice(t),
    };
    this.session = new NetSession(raceConfig, events, 'player');
    this.buildScreen = new BuildScreen((b) => this.onBuilt(b));
    const dash = el('div', 'ph-dash');
    dash.append(this.panel.root);
    const ctrl = el('div', 'ph-controls');
    ctrl.append(this.controller.root);
    this.view.append(this.top, this.banner, this.ticker);
    applyDocumentPrefs();
    const settings = new SettingsPanel({ graphics: true, haptics: true, resolution: () => this.renderer?.resolutionScale ?? 1 });
    this.root.append(settings.button, settings.panel, this.view, dash, ctrl, this.nameScreen, this.lobbyScreen, this.resultScreen, this.buildScreen.root, this.connScreen);
    document.getElementById('app')!.append(this.root);
    document.body.classList.add('phone-mode');
    this.buildNameScreen();
    (window as unknown as { __phone: unknown }).__phone = this;
    void this.start();
  }

  private async start(): Promise<void> {
    const ok = await this.session.ready(4000);
    if (!ok) {
      this.connScreen.innerHTML = 'サーバーに接続できませんでした。<br>同じWi-Fiにいるか確認して、もう一度読み込んでください。';
      const retry = el('button', 'restart', '再読み込み');
      retry.addEventListener('click', () => location.reload());
      this.connScreen.append(retry);
      return;
    }
    const info = this.session.raceInfo!;
    Object.assign(raceConfig, { edition: info.edition, name: info.name, grade: info.grade, distance: info.distance, weather: info.weather });
    Object.assign(courseConfig, this.session.courseSetup!.config);
    this.course = new Course(courseConfig);
    this.renderer = new RaceRenderer(this.view, this.course, raceConfig);
    this.renderer.viewMode = 'chase';
    this.view.prepend(this.renderer.renderer.domElement);
    this.onSetup();
    this.connScreen.classList.add('hide');
    // A reconnecting player (reload / phone woke up) is already entered: lobby now, controller once racing
    if (this.session.myGate !== null || this.session.hasEntry) {
      this.submitted = true;
      this.go('lobby');
    } else {
      this.go(this.jockey ? 'build' : 'name');
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private go(screen: Screen): void {
    this.screen = screen;
    this.root.dataset.screen = screen;
    this.nameScreen.classList.toggle('show', screen === 'name');
    this.lobbyScreen.classList.toggle('show', screen === 'lobby');
    this.resultScreen.classList.toggle('show', screen === 'results');
    if (screen === 'build') this.buildScreen.show(this.session.queuedGate ?? this.session.myGate ?? 1);
    else this.buildScreen.hide();
    if (screen === 'race') void this.keepAwake();
  }

  private buildNameScreen(): void {
    const input = el('input', 'bs-name') as HTMLInputElement;
    input.maxLength = 12;
    input.placeholder = '例：ミライ太郎';
    input.value = this.jockey;
    const next = el('button', 'bs-go', '次へ：馬体を設計');
    next.addEventListener('click', () => {
      this.jockey = input.value.trim() || 'ゲスト';
      saveJockey(this.jockey);
      this.go('build');
    });
    this.nameScreen.append(
      el('div', 'bs-title', '段ボール競馬'),
      el('div', 'ph-sub', `第${raceConfig.edition}回 ${raceConfig.name}`),
      el('label', 'bs-label', '騎手名（あなたの名前）'),
      input,
      next,
    );
  }

  private onBuilt(b: PlayerBuild): void {
    this.session.submitBuild({ ...b, jockey: this.jockey });
    this.submitted = true;
    this.go('lobby');
  }

  private onSetup(): void {
    this.hapticSeq = 0;
    if (!this.renderer) return;
    const live = this.session.flow.liveState;
    this.renderer.setRace(live);
  }

  private onPhase(p: FlowPhase): void {
    if (p === 'build' && this.submitted && this.screen !== 'build' && this.screen !== 'name') this.go('lobby');
    if (p === 'results' && this.session.myGate === null && this.screen === 'watch') this.go(this.submitted ? 'lobby' : 'build');
    if (p === 'intro' || p === 'paddock' || p === 'gate' || p === 'running') {
      if (this.session.myGate !== null && this.screen !== 'build') this.go('race');
      else if (this.screen === 'lobby') this.go('watch');
    }
    if (p === 'running') {
      this.renderer?.openGate();
      if (this.session.myGate !== null) buzz(HAPTIC.gate);
    }
    if (p === 'results' && this.session.myGate !== null && this.screen !== 'build') this.go('results');
  }

  private notice(text: string): void {
    const t = el('div', 'ph-tick', text);
    this.ticker.prepend(t);
    while (this.ticker.children.length > 2) this.ticker.lastChild!.remove();
    setTimeout(() => t.remove(), 4000);
  }

  private async keepAwake(): Promise<void> {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
      if (!this.wakeLock && nav.wakeLock) this.wakeLock = await nav.wakeLock.request('screen');
    } catch {
      /* not supported / denied */
    }
  }

  private me(): HorseState | null {
    const g = this.session.myGate;
    return g === null ? null : this.session.flow.liveState.horses[g - 1] ?? null;
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const flow = this.session.flow;
    const racing = flow.phase === 'running';
    this.controller.enabled = racing;
    this.controller.root.classList.toggle('disabled', !racing);
    this.session.update(dt, this.screen === 'race' ? this.controller.read() : null);
    const live = flow.liveState;
    if (live) this.hapticsFor(live);
    if (live && this.renderer) {
      this.renderer.director.paddockIndex = flow.paddockIndex;
      this.renderer.director.replayTime = flow.replay?.segmentTime ?? 0;
      this.renderer.director.replaySegment = flow.replay?.segment ?? null;
      this.renderer.render(flow.viewState, flow.phase, flow.phaseTime, dt);
      this.updateHud(live);
    }
    if (this.screen === 'lobby') this.updateLobby();
    if (this.screen === 'results') this.updateResults();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Feel your own horse: brace, legs lifting, contact, falls, parts flying off, the finish. */
  private hapticsFor(live: { events: { seq: number; type: string; horseId: number; otherId?: number }[] }): void {
    const me = this.me();
    for (const ev of live.events) {
      if (ev.seq <= this.hapticSeq) continue;
      this.hapticSeq = ev.seq;
      if (!me || (ev.horseId !== me.id && ev.otherId !== me.id)) continue;
      const pattern = (HAPTIC as Record<string, number | readonly number[]>)[ev.type];
      if (pattern !== undefined) buzz(pattern as number | number[]);
    }
  }

  private updateHud(live: { horses: HorseState[]; distance: number; order: number[] }): void {
    const h = this.me();
    const s = this.session;
    const conn = s.connected ? `${Math.round(s.rtt)}ms` : '再接続中…';
    this.root.classList.toggle('offline', !s.connected);
    if (h) {
      const remaining = Math.max(0, Math.ceil((live.distance - h.progress) / 10) * 10);
      const gc = gateColors[(h.gate - 1) % gateColors.length];
      this.top.innerHTML =
        `<span class="ph-gate" style="background:${gc.bg};color:${gc.fg}">${h.gate}</span>` +
        `<span class="ph-rank"><b>${h.rank}</b>位</span>` +
        `<span class="ph-rem">${h.finished ? 'ゴール' : `残り ${remaining}m`}</span>` +
        `<span class="ph-net ${s.connected ? '' : 'bad'}">📶 ${conn}</span>`;
    } else {
      this.top.innerHTML = `<span class="ph-rem">観戦中</span><span class="ph-net">📶 ${conn}</span>`;
    }
    this.panel.update(h ?? undefined, !!h && this.screen === 'race');
    const msg = PHASE_MSG[s.flow.phase];
    this.banner.textContent = h?.autopilot ? '通信が戻るまでCPUが代走中' : (msg ?? '');
    this.banner.classList.toggle('show', !!this.banner.textContent && this.screen === 'race');
  }

  private lobbyEls: { head: HTMLElement; countdown: HTMLElement; list: HTMLElement; bracket: HTMLElement; rebuild: HTMLElement } | null = null;

  /** Built once; only the texts change, so taps on the buttons are never lost to a re-render. */
  private updateLobby(): void {
    const s = this.session;
    if (!this.lobbyEls) {
      const head = el('div', 'ph-lobby-head');
      const countdown = el('div', 'lobby-countdown');
      const list = el('ul', 'ph-list');
      const start = el('button', 'restart start-btn', '今すぐ発走');
      start.addEventListener('click', () => s.startNow());
      const rebuild = el('button', 'restart secondary', '馬体を作り直す');
      rebuild.addEventListener('click', () => this.go('build'));
      const buttons = el('div', 'results-buttons');
      buttons.append(start, rebuild);
      const bracket = el('div', 'ph-bracket');
      this.lobbyScreen.append(head, countdown, list, buttons, el('div', 'ph-sub', '大画面でレースが始まります。スマホが操作パネルになります。'), bracket);
      this.lobbyEls = { head, countdown, list, bracket, rebuild };
    }
    const info = s.lobby;
    const gate = s.queuedGate ?? s.myGate;
    const build = loadSavedBuild();
    const type = judgeBuildType(build.body);
    const gc = gateColors[((gate ?? 1) - 1) % gateColors.length];
    const head = gate
      ? `<div class="ph-big-gate" style="background:${gc.bg};color:${gc.fg}">${gate}</div><div><div class="ph-horse">${esc(build.name)}</div><div class="ph-nick">${type.name}</div><div class="ph-sub">騎手 ${esc(this.jockey)}</div></div>`
      : '<div class="ph-horse">満員のため観戦です</div>';
    const list = (info?.players ?? [])
      .map((p) => `<li class="${p.gate === gate ? 'me' : ''}">${p.gate}番 ${esc(p.name)}<small>（${esc(p.jockey)}）${p.connected ? '' : ' ⚠切断'}</small></li>`)
      .join('');
    const cd = info?.countdown == null ? '参加者を待っています' : `発走まで ${Math.ceil(info.countdown)} 秒`;
    const L = this.lobbyEls;
    // 大会モード: my entry, standing and the bracket instead of a gate
    const t = info?.mode === 'tournament' ? s.tournament : null;
    if (t) {
      const st = viewStanding(t, s.entrantId);
      const entered = !!s.entrantId;
      const thead = entered
        ? `<div class="ph-big-gate tour">${st.next ? '🏁' : '🎟'}</div><div><div class="ph-horse">${esc(build.name)}</div><div class="ph-nick">${esc(st.text)}</div><div class="ph-sub">騎手 ${esc(this.jockey)}</div></div>`
        : `<div class="ph-horse">${t.status === 'registration' ? '「馬体を作り直す」から大会にエントリーできます' : '大会進行中（観戦）'}</div>`;
      if (L.head.innerHTML !== thead) L.head.innerHTML = thead;
      const cdT = info?.countdown != null ? `${info.raceLabel ?? ''} 発走まで ${Math.ceil(info.countdown)} 秒` : t.status === 'registration' ? 'エントリー受付中' : info?.raceLabel ? `次のレース：${info.raceLabel}` : t.status === 'finished' ? '大会終了・表彰式' : '';
      if (L.countdown.textContent !== cdT) L.countdown.textContent = cdT;
      if (L.list.innerHTML !== list) L.list.innerHTML = list;
      const bh = bracketHtml(t, s.entrantId);
      if (L.bracket.innerHTML !== bh) L.bracket.innerHTML = bh;
      L.rebuild.style.display = t.status === 'registration' ? '' : 'none';
      (this.lobbyScreen.querySelector('.start-btn') as HTMLElement).style.display = 'none';
      return;
    }
    L.bracket.innerHTML = '';
    L.rebuild.style.display = '';
    if (L.head.innerHTML !== head) L.head.innerHTML = head;
    if (L.countdown.textContent !== cd) L.countdown.textContent = cd;
    if (L.list.innerHTML !== list) L.list.innerHTML = list;
    (this.lobbyScreen.querySelector('.start-btn') as HTMLElement).style.display = info?.playersCanStart === false ? 'none' : '';
  }

  private updateResults(): void {
    const s = this.session;
    const live = s.flow.liveState;
    const h = this.me();
    const key = live.finishOrder.length;
    if (this.resultShownFor === key) return;
    this.resultShownFor = key;
    this.resultScreen.innerHTML = '';
    const place = h ? live.finishOrder.indexOf(h.id) + 1 : 0;
    const big = el('div', place ? 'ph-place' : 'ph-place small', place ? `${place}着` : '完走できず');
    const sub = el('div', 'ph-sub', h?.finishTime != null ? `タイム ${formatRaceTime(h.finishTime)}　転倒 ${h.falls}回　修理 ${h.repairs}回` : '');
    const top = el('ol', 'ph-list');
    top.innerHTML = live.finishOrder.slice(0, 3).map((id) => `<li>${live.horses[id].gate}番 ${esc(live.horses[id].name)}</li>`).join('');
    const again = el('button', 'restart', 'もう一度レース');
    again.addEventListener('click', () => s.rematch());
    const rebuild = el('button', 'restart secondary', '馬体を作り直す');
    rebuild.addEventListener('click', () => this.go('build'));
    const buttons = el('div', 'results-buttons');
    buttons.append(again, rebuild);
    this.resultScreen.append(el('div', 'ph-sub', `第${raceConfig.edition}回 ${raceConfig.name} 確定`), big, sub, top, buttons);
  }
}

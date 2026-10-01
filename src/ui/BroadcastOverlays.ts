import { gateColors, runningStyleLabel } from '../config/horses';
import type { ReplaySegment } from '../game/Replay';
import { buildStats, judgeBuildType, statGauges } from '../sim/buildType';
import { computePerformance } from '../sim/performance';
import type { HorseState, RaceState } from '../sim/types';
import { el, formatMargin, formatRaceTime } from './format';

const STAT_LABELS: [keyof ReturnType<typeof statGauges>, string][] = [
  ['speed', 'スピード'],
  ['accel', '加速'],
  ['corner', 'コーナー'],
  ['durability', '耐久'],
];

/** 出走馬紹介: lower-third card for the horse on screen. */
export class PaddockCard {
  readonly root = el('div', 'paddock-card');
  private shownId = -1;

  update(h: HorseState | null, visible: boolean): void {
    this.root.classList.toggle('show', visible && !!h);
    if (!h || !visible || h.id === this.shownId) return;
    this.shownId = h.id;
    const gc = gateColors[(h.gate - 1) % gateColors.length];
    const perf = computePerformance(h.body);
    const type = judgeBuildType(h.body, perf);
    const g = statGauges(buildStats(perf));
    this.root.innerHTML = '';
    const num = el('div', 'pc-num', String(h.gate));
    num.style.background = gc.bg;
    num.style.color = gc.fg;
    const main = el('div', 'pc-main');
    const top = el('div', 'pc-top');
    top.append(el('span', 'pc-nick', type.name), el('span', 'pc-style', h.isPlayer ? 'あなたの馬' : runningStyleLabel[h.style]));
    main.append(top, el('div', 'pc-name', h.name), el('div', 'pc-desc', h.jockey ? `騎手 ${h.jockey}　${type.description}` : type.description));
    const stats = el('div', 'pc-stats');
    stats.append(el('div', 'pc-weight', `馬体重 ${perf.mass.toFixed(1)}kg`));
    for (const [k, label] of STAT_LABELS) {
      const row = el('div', 'pc-stat');
      const stars = Math.max(1, Math.round(g[k] / 20));
      row.append(el('span', '', label), el('span', 'pc-stars', '★'.repeat(stars) + '☆'.repeat(5 - stars)));
      stats.append(row);
    }
    this.root.append(num, main, stats);
    // restart the slide-in animation
    this.root.classList.remove('anim');
    void this.root.offsetWidth;
    this.root.classList.add('anim');
  }

  reset(): void {
    this.shownId = -1;
  }
}

/** ゴール演出: winner plate, winning time and margin, with 写真判定 for close finishes. */
export class WinnerCard {
  readonly root = el('div', 'winner-card');
  private timer = 0;
  private revealAt = 0;
  private winnerId = -1;
  private photo = false;

  /** Call when the winner crosses the line. */
  show(state: RaceState): void {
    const w = state.horses[state.finishOrder[0]];
    this.winnerId = w.id;
    this.timer = 0;
    // Photo finish when someone else is within half a length at the line
    const close = state.horses.some((h) => h.id !== w.id && state.distance - h.progress < 1.2);
    this.photo = close;
    this.revealAt = close ? 2.6 : 0.6;
    this.root.className = 'winner-card show';
    this.root.innerHTML = close ? '<div class="wc-photo">写真判定</div>' : '';
  }

  hide(): void {
    this.root.className = 'winner-card';
    this.winnerId = -1;
  }

  update(state: RaceState, dt: number): boolean {
    if (this.winnerId < 0) return false;
    const before = this.timer;
    this.timer += dt;
    if (before < this.revealAt && this.timer >= this.revealAt) {
      this.render(state);
      return true;
    }
    return false;
  }

  private render(state: RaceState): void {
    const w = state.horses[this.winnerId];
    const gc = gateColors[(w.gate - 1) % gateColors.length];
    const second = state.horses[state.finishOrder[1] ?? -1];
    const speed = w.finishTime ? state.distance / w.finishTime : 15;
    const margin = second?.finishTime != null && w.finishTime != null ? formatMargin(second.finishTime - w.finishTime, speed) : '';
    this.root.innerHTML = '';
    const badge = el('div', 'wc-badge', '1着');
    const num = el('div', 'wc-num', String(w.gate));
    num.style.background = gc.bg;
    num.style.color = gc.fg;
    const info = el('div', 'wc-info');
    info.append(el('div', 'wc-name', w.name), el('div', 'wc-nick', `異名「${w.nickname}」${w.isPlayer ? '　あなたの勝利！' : ''}`));
    const time = el('div', 'wc-time');
    time.innerHTML = `<span>勝ちタイム</span><b>${w.finishTime != null ? formatRaceTime(w.finishTime) : '--'}</b>${margin ? `<span>着差</span><b>${margin}</b>` : ''}`;
    this.root.append(badge, num, info, time);
    if (this.photo) this.root.classList.add('photo-done');
  }
}

/** REPLAY bug in the corner plus the gold wipe used for cuts in and out of replays. */
export class ReplayBug {
  readonly root = el('div', 'replay-bug');
  readonly wipe = el('div', 'wipe');
  private readonly label = el('span', 'rb-label');

  constructor() {
    this.root.append(el('span', 'rb-tag', 'REPLAY'), this.label, el('span', 'rb-skip', 'Enter でスキップ'));
  }

  show(seg: ReplaySegment, state: RaceState): void {
    const h = state.horses[seg.focusId];
    this.label.textContent = seg.kind === 'goal' ? seg.label : `${seg.label}　${h.gate}番 ${h.name}`;
    this.root.classList.add('show');
    this.doWipe();
  }

  hide(): void {
    if (this.root.classList.contains('show')) this.doWipe();
    this.root.classList.remove('show');
  }

  doWipe(): void {
    this.wipe.classList.remove('go');
    void this.wipe.offsetWidth;
    this.wipe.classList.add('go');
  }
}

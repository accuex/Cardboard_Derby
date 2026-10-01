import { gateColors } from '../config/horses';
import type { RaceConfig } from '../config/race';
import type { FlowPhase } from '../render/BroadcastDirector';
import type { Course } from '../sim/Course';
import type { RaceEvent, RaceState } from '../sim/types';
import { partLabel } from '../sim/damage';
import { PlayerPanel } from './PlayerPanel';
import { el, formatRaceTime, raceTitle } from './format';

const ROW_H = 38;

/** Broadcast-style overlay: race badge, running order, distance to go, camera tag. */
export class Hud {
  readonly root = el('div', 'hud');
  private readonly board = el('div', 'hud-board');
  private readonly rows = new Map<number, HTMLDivElement>();
  private readonly remaining = el('div', 'hud-remaining');
  private readonly clock = el('div', 'hud-clock');
  private readonly segment = el('div', 'hud-segment');
  private readonly cam = el('div', 'hud-cam');
  private readonly banner = el('div', 'hud-banner');
  private bannerTimer = 0;
  private readonly ticker = el('div', 'hud-ticker');
  private readonly pipFrame = el('div', 'pip-frame');
  private readonly panel = new PlayerPanel();
  private lastEventSeq = 0;
  private readonly minimap = el('div', 'hud-minimap');
  private svg!: SVGSVGElement;
  private readonly dots = new Map<number, SVGCircleElement>();
  private readonly prevRank = new Map<number, number>();
  private readonly arrowTimers = new Map<number, number>();
  private splitShown = false;

  constructor(race: RaceConfig, distanceLabel: string, private readonly course: Course) {
    const badge = el('div', 'hud-race');
    if (race.grade) badge.append(el('span', `grade grade-${race.grade.toLowerCase()}`, race.grade));
    const titles = el('div', 'hud-race-text');
    titles.append(el('div', 'hud-race-name', raceTitle(race)), el('div', 'hud-race-sub', distanceLabel));
    badge.append(titles);

    const right = el('div', 'hud-right');
    right.append(this.remaining, this.clock, this.segment);

    this.cam.innerHTML = '';
    this.pipFrame.append(el('span', 'pip-label', 'あなたの馬'));
    right.append(this.minimap);
    // screen readers hear race events and big announcements
    this.ticker.setAttribute('role', 'log');
    this.ticker.setAttribute('aria-live', 'polite');
    this.banner.setAttribute('aria-live', 'assertive');
    this.buildMinimap();
    this.root.append(badge, right, this.board, this.cam, this.ticker, this.pipFrame, this.panel.root, this.banner);
  }

  /** Swap the label when the main view and the PiP are exchanged. */
  setSwapped(swapped: boolean): void {
    (this.pipFrame.firstChild as HTMLElement).textContent = swapped ? '中継' : 'あなたの馬';
  }

  /** Bird's-eye course map; the home straight (and stands) at the bottom, like a TV graphic. */
  private buildMinimap(): void {
    const c = this.course;
    const W = c.config.trackWidth;
    const pts: string[] = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let s = 0; s <= c.lapLength; s += 10) {
      const p = c.sample(s, W / 2);
      pts.push(`${p.x.toFixed(1)},${p.z.toFixed(1)}`);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 30;
    const f = c.sample(c.finishS, -2);
    const f2 = c.sample(c.finishS, W + 2);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `${minX - pad} ${minZ - pad} ${maxX - minX + pad * 2} ${maxZ - minZ + pad * 2}`);
    svg.innerHTML = `<polygon points="${pts.join(' ')}" class="mm-track" style="stroke-width:${W}"/>` +
      `<line x1="${f.x}" y1="${f.z}" x2="${f2.x}" y2="${f2.z}" class="mm-finish"/>`;
    this.minimap.append(svg);
    this.svg = svg;
  }

  setRace(state: RaceState): void {
    this.lastEventSeq = 0;
    this.splitShown = false;
    this.prevRank.clear();
    const svg = this.svg;
    for (const d of this.dots.values()) d.remove();
    this.dots.clear();
    for (const h of [...state.horses].reverse()) {
      const gc = gateColors[(h.gate - 1) % gateColors.length];
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', h.isPlayer ? '34' : '26');
      dot.setAttribute('fill', gc.bg);
      dot.setAttribute('class', h.isPlayer ? 'mm-dot player' : 'mm-dot');
      svg.append(dot);
      this.dots.set(h.id, dot);
    }
    this.ticker.innerHTML = '';
    this.pipFrame.classList.toggle('on', state.horses.some((h) => h.isPlayer));
    this.board.innerHTML = '';
    this.rows.clear();
    this.board.style.height = `${state.horses.length * ROW_H}px`;
    for (const h of state.horses) {
      const gc = gateColors[(h.gate - 1) % gateColors.length];
      const row = el('div', 'hud-row');
      const rank = el('span', 'hud-rank');
      const num = el('span', 'hud-num', String(h.gate));
      num.style.background = gc.bg;
      num.style.color = gc.fg;
      const name = el('span', 'hud-name', h.name);
      const gap = el('span', 'hud-gap');
      const arrow = el('span', 'hud-arrow');
      row.append(rank, num, name, gap, arrow);
      this.board.append(row);
      this.rows.set(h.id, row);
    }
  }

  setCamera(label: string): void {
    const replay = label.startsWith('リプレイ');
    this.cam.innerHTML = `<span class="${replay ? 'rep' : 'live'}">${replay ? '◀◀ REPLAY' : '● LIVE'}</span><span>${label}</span>`;
  }

  flash(text: string, cls = ''): void {
    this.banner.textContent = text;
    this.banner.className = `hud-banner show ${cls}`;
    this.bannerTimer = 2.2;
  }

  update(state: RaceState, phase: FlowPhase, segmentLabel: string, dt: number): void {
    const visible = phase !== 'intro' && phase !== 'build';
    this.root.classList.toggle('visible', visible);
    this.root.classList.toggle('results', phase === 'results');
    // Clean screen for the introductions and replays
    this.root.classList.toggle('clean', phase === 'paddock' || phase === 'replay');

    for (const h of state.horses) {
      const dot = this.dots.get(h.id);
      if (dot) {
        dot.setAttribute('cx', h.x.toFixed(1));
        dot.setAttribute('cy', h.z.toFixed(1));
        dot.classList.toggle('down', h.status !== 'running');
      }
    }
    if (phase === 'running' && !this.splitShown) {
      const lead = state.horses[state.order[0]];
      const half = state.distance / 2;
      if (lead.progress >= half) {
        this.splitShown = true;
        this.tick(`${half}m通過 ${formatRaceTime(state.time)}　先頭は${lead.gate}番 ${lead.name}`, 'tick-split');
      }
    }

    const leader = state.horses[state.order[0]];
    const remaining = Math.max(0, Math.ceil((state.distance - leader.progress) / 10) * 10);
    this.remaining.innerHTML = state.finishOrder.length ? '<small>決着</small>' : `<small>残り</small>${remaining}<small>m</small>`;
    const winner = state.finishOrder.length ? state.horses[state.finishOrder[0]] : null;
    this.clock.textContent = formatRaceTime(winner?.finishTime ?? state.time);
    this.segment.textContent = segmentLabel;

    state.order.forEach((id, i) => {
      const h = state.horses[id];
      const row = this.rows.get(id)!;
      row.style.transform = `translateY(${i * ROW_H}px)`;
      (row.children[0] as HTMLElement).textContent = String(i + 1);
      let gapText = '';
      if (i > 0) {
        const ahead = state.horses[state.order[i - 1]];
        if (h.finished && ahead.finished && h.finishTime !== null && ahead.finishTime !== null) {
          gapText = `+${(h.finishTime - state.horses[state.order[0]].finishTime!).toFixed(1)}`;
        } else {
          const d = (state.horses[state.order[0]].progress - h.progress) / 2.4;
          gapText = d < 0.5 ? '' : `${d.toFixed(1)}馬身`;
        }
      }
      if (h.status === 'fallen') gapText = '転倒';
      else if (h.status === 'recovering') gapText = '起き上がり';
      else if (h.status === 'repairing') gapText = `修理中 ${Math.max(0, h.repairTotal - h.statusTime).toFixed(0)}秒`;
      else if (h.pitRequested) gapText = 'ピットイン';
      if (h.autopilot && h.status === 'running') gapText = `代走 ${gapText}`;
      (row.children[3] as HTMLElement).textContent = gapText;
      // ▲▼ when a horse gains or loses a place
      const prev = this.prevRank.get(id);
      const arrowEl = row.children[4] as HTMLElement;
      if (phase === 'running' && prev !== undefined && prev !== i + 1) {
        arrowEl.textContent = prev > i + 1 ? '▲' : '▼';
        arrowEl.className = `hud-arrow ${prev > i + 1 ? 'up' : 'dn'}`;
        this.arrowTimers.set(id, 1.6);
      }
      const at = (this.arrowTimers.get(id) ?? 0) - dt;
      this.arrowTimers.set(id, at);
      if (at <= 0) arrowEl.className = 'hud-arrow';
      this.prevRank.set(id, i + 1);
      row.classList.toggle('player', h.isPlayer);
      row.classList.toggle('down', h.status !== 'running');
      row.classList.toggle('done', h.finished);
    });

    this.panel.update(state.horses.find((h) => h.isPlayer), visible && phase !== 'results');
    this.consumeEvents(state);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
  }

  private consumeEvents(state: RaceState): void {
    for (const ev of state.events) {
      if (ev.seq <= this.lastEventSeq) continue;
      this.lastEventSeq = ev.seq;
      const text = this.describe(ev, state);
      if (!text) continue;
      this.tick(text, `tick-${ev.type}`);
      const h = state.horses[ev.horseId];
      if (h.isPlayer && ev.type === 'fall') this.flash('転倒！', 'bad');
      if (h.isPlayer && ev.type === 'partLost') this.flash(`${partLabel[ev.part!]}脱落！`, 'bad');
    }
  }

  tick(text: string, cls = ''): void {
    const item = el('div', `tick ${cls}`, text);
    this.ticker.prepend(item);
    while (this.ticker.children.length > 3) this.ticker.lastChild!.remove();
    setTimeout(() => item.classList.add('out'), 3500);
    setTimeout(() => item.remove(), 4200);
  }

  private describe(ev: RaceEvent, state: RaceState): string | null {
    const h = state.horses[ev.horseId];
    const who = `${h.gate}番 ${h.name}`;
    switch (ev.type) {
      case 'fall':
        return `⚠ ${who} 転倒！`;
      case 'recover':
        return `${who} 立ち上がった！`;
      case 'collision': {
        const o = state.horses[ev.otherId ?? 0];
        return (ev.value ?? 0) > 2 ? `💥 ${h.gate}番と${o.gate}番が激突！` : `${h.gate}番と${o.gate}番が接触`;
      }
      case 'rail':
        return `${who} ラチに接触`;
      case 'legLift':
        return `${who} 内脚が浮いた！`;
      case 'brace':
        return `${who} 踏ん張った！ 疲労度UP×${ev.value}`;
      case 'tapePeel':
        return `${who} ${partLabel[ev.part!]}のガムテープが剥がれた！`;
      case 'deform':
        return `${who} ${partLabel[ev.part!]}が曲がった！`;
      case 'partLost':
        return `💥 ${who} ${partLabel[ev.part!]}が取れた！`;
      case 'repairStart':
        return `🔧 ${who} 修理開始（約${(ev.value ?? 0).toFixed(0)}秒）`;
      case 'repairEnd':
        return `${who} 修理完了！ 戦線復帰`;
      default:
        return null;
    }
  }
}

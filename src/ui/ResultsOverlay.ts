import { gateColors, runningStyleLabel } from '../config/horses';
import type { RaceConfig } from '../config/race';
import type { RaceState } from '../sim/types';
import { el, formatMargin, formatRaceTime, raceTitle } from './format';

/** Official result board (確定). */
export class ResultsOverlay {
  readonly root = el('div', 'results-overlay');
  private readonly body = el('tbody');
  private readonly title = el('div', 'results-title');

  constructor(private readonly race: RaceConfig, onRestart: (() => void) | null, onRebuild?: () => void) {
    const card = el('div', 'results-card');
    const head = el('div', 'results-head');
    head.append(this.title, el('div', 'kakutei', '確定'));
    const table = el('table', 'results-table');
    const thead = el('thead');
    thead.innerHTML = '<tr><th>着順</th><th>馬番</th><th>馬名</th><th>異名</th><th>脚質</th><th>タイム</th><th>着差</th><th>上がり3F</th><th>転倒</th><th>修理</th><th>接触</th><th>構造疲労</th></tr>';
    table.append(thead, this.body);
    const btn = el('button', 'restart', 'もう一度レース (R)');
    const buttons = el('div', 'results-buttons');
    if (onRestart) {
      btn.addEventListener('click', onRestart);
      buttons.append(btn);
    }
    if (onRebuild) {
      const rb = el('button', 'restart secondary', '馬体を作り直す (B)');
      rb.addEventListener('click', onRebuild);
      buttons.append(rb);
    }
    card.append(head, table, this.footer, buttons);
    this.root.append(card);
  }

  /** Horse ids advancing to the next round (tournament), with a label such as 準決勝へ. */
  private advancing = new Map<number, string>();

  setTournament(advancing: Map<number, string>): void {
    this.advancing = advancing;
  }

  clearTournament(): void {
    this.advancing = new Map();
  }

  /** Small notes after the horse name (TV mode: 3番人気). */
  private tags = new Map<number, string>();
  private readonly footer = el('div', 'results-footer');

  setTags(tags: Map<number, string>): void {
    this.tags = tags;
  }

  /** A line under the table (TV mode: 払戻金). */
  setFooter(html: string): void {
    this.footer.innerHTML = html;
  }

  show(state: RaceState): void {
    this.title.textContent = raceTitle(this.race, true);
    this.refresh(state);
    this.root.classList.add('show');
  }

  /** Re-render while stragglers finish. */
  refresh(state: RaceState): void {
    this.body.innerHTML = '';
    const winner = state.horses[state.finishOrder[0]];
    const avgSpeed = winner?.finishTime ? state.distance / winner.finishTime : 16;
    state.order.forEach((id, i) => {
      const h = state.horses[id];
      const gc = gateColors[(h.gate - 1) % gateColors.length];
      const tr = el('tr');
      if (i === 0) tr.className = 'first';
      const num = el('span', 'num', String(h.gate));
      num.style.background = gc.bg;
      num.style.color = gc.fg;
      const tdNum = el('td');
      tdNum.append(num);
      let margin = '';
      if (i > 0 && h.finishTime !== null) {
        const prev = state.horses[state.order[i - 1]];
        if (prev.finishTime !== null) margin = formatMargin(h.finishTime - prev.finishTime, avgSpeed);
      }
      const last3f = h.finishTime !== null && h.last600Time !== null ? (h.finishTime - h.last600Time).toFixed(1) : '';
      tr.append(
        el('td', 'rank', h.finished ? String(i + 1) : '-'),
        tdNum,
        el('td', 'name', h.jockey ? `${h.name}（${h.jockey}）` : h.name),
        el('td', 'nick', h.nickname),
        el('td', '', h.isPlayer ? 'あなた' : runningStyleLabel[h.style]),
        el('td', 'time', h.finishTime !== null ? formatRaceTime(h.finishTime) : '--'),
        el('td', '', margin),
        el('td', '', last3f),
        el('td', h.falls ? 'bad' : '', String(h.falls)),
        el('td', h.repairs ? 'bad' : '', String(h.repairs)),
        el('td', '', String(h.collisions)),
        el('td', '', `${Math.round(h.structuralFatigue * 100)}%`),
      );
      if (h.isPlayer) tr.classList.add('player');
      const tag = this.tags.get(h.id);
      if (tag) (tr.children[2] as HTMLElement).append(el('span', 'pop-tag', tag));
      const adv = this.advancing.get(h.id);
      if (adv) {
        tr.classList.add('advance');
        (tr.children[2] as HTMLElement).append(el('span', 'adv-tag', `▶${adv}`));
      }
      this.body.append(tr);
    });
  }

  hide(): void {
    this.root.classList.remove('show');
  }
}

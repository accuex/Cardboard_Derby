import { physicsConfig } from '../config/physics';
import { PART_IDS, partHealth, partLabel } from '../sim/damage';
import type { HorseState, PartId } from '../sim/types';
import { el } from './format';

/** Driver's dashboard for the local player's horse. */
export class PlayerPanel {
  readonly root = el('div', 'player-panel');
  private readonly status = el('div', 'pp-status');
  private readonly speed = el('div', 'pp-speed');
  private readonly throttle = el('div', 'pp-bar-fill');
  private readonly load = el('div', 'pp-bar-fill');
  private readonly tip = el('div', 'pp-bar-fill');
  private readonly tipText = el('span', 'pp-val');
  private readonly wear = el('div', 'pp-bar-fill');
  private readonly wearText = el('span', 'pp-val');
  private readonly stacks: HTMLSpanElement[] = [];
  private readonly brace = el('div', 'pp-brace', '踏ん張り中');
  private readonly partEls = new Map<PartId, HTMLElement>();
  private readonly repair = el('div', 'pp-repair');
  private readonly repairFill = el('div', 'pp-bar-fill');
  private readonly repairText = el('span', 'pp-repair-text');

  constructor() {
    const head = el('div', 'pp-head');
    head.append(this.speed, this.status);
    const meters = el('div', 'pp-meters');
    meters.append(
      this.meter('アクセル', this.throttle),
      this.meter('コーナー負荷', this.load, undefined, true),
      this.meter('転倒危険度', this.tip, this.tipText),
      this.meter('構造疲労', this.wear, this.wearText),
    );
    const stackRow = el('div', 'pp-stacks');
    stackRow.append(el('span', 'pp-label', '疲労度UP'));
    for (let i = 0; i < physicsConfig.brace.maxStacks; i++) {
      const s = el('span', 'pp-stack');
      this.stacks.push(s);
      stackRow.append(s);
    }
    stackRow.append(this.brace);
    // Side-view parts diagram (horse facing right)
    const diagram = el('div', 'pp-parts');
    for (const id of PART_IDS) {
      const part = el('div', `pp-part pp-${id}`);
      part.title = partLabel[id];
      diagram.append(part);
      this.partEls.set(id, part);
    }
    const repairBar = el('div', 'pp-bar');
    repairBar.append(this.repairFill);
    this.repair.append(this.repairText, repairBar);
    const body = el('div', 'pp-main');
    const left = el('div', 'pp-left');
    left.append(meters, stackRow);
    body.append(left, diagram);
    const help = el('div', 'pp-help');
    help.innerHTML = '<b>↑</b>全開 <b>↓</b>ブレーキ <b>←→</b>進路 <b>Space</b>踏ん張る <b>P</b>ピットイン <b>V</b>視点';
    this.root.append(head, body, this.repair, help);
  }

  private meter(label: string, fill: HTMLElement, value?: HTMLElement, limitMark = false): HTMLElement {
    const row = el('div', 'pp-meter');
    const bar = el('div', 'pp-bar');
    bar.append(fill);
    if (limitMark) bar.append(el('i', 'pp-limit'));
    row.append(el('span', 'pp-label', label), bar);
    if (value) row.append(value);
    return row;
  }

  update(h: HorseState | undefined, visible: boolean): void {
    this.root.classList.toggle('visible', visible && !!h);
    if (!h) return;
    this.speed.innerHTML = `${Math.round(h.speed * 3.6)}<small>km/h</small>`;
    let status = '走行中';
    let cls = '';
    if (h.finished) status = 'ゴール';
    if (h.status === 'fallen') { status = '転倒！'; cls = 'bad'; }
    else if (h.status === 'repairing') { status = '修理中'; cls = 'warn'; }
    else if (h.pitRequested) { status = 'ピットイン中'; cls = 'warn'; }
    else if (h.status === 'recovering') { status = '起き上がり中…'; cls = 'warn'; }
    else if (h.legsLifted) { status = '内脚が浮いている！'; cls = 'bad'; }
    else if (Math.abs(h.loadRatio) > 1) { status = '限界超え'; cls = 'warn'; }
    else if (h.brake > 0) status = 'ブレーキ';
    else if (h.throttle >= 0.99) status = '全開';
    this.status.textContent = status;
    this.status.className = `pp-status ${cls}`;

    this.throttle.style.width = `${(h.brake > 0 ? 0 : h.throttle) * 100}%`;
    this.throttle.classList.toggle('brake', h.brake > 0);
    // Load meter: full bar = 150% of the limit; the tick marks 100%.
    const load = Math.abs(h.loadRatio);
    this.load.style.width = `${Math.min(1, load / 1.5) * 100}%`;
    this.load.dataset.level = load > 1 ? 'bad' : load > 0.85 ? 'warn' : 'ok';
    this.tip.style.width = `${h.tipRisk * 100}%`;
    this.tip.dataset.level = h.tipRisk > 0.6 ? 'bad' : h.tipRisk > 0.3 ? 'warn' : 'ok';
    this.tipText.textContent = `${Math.round(h.tipRisk * 100)}%`;
    this.wear.style.width = `${h.structuralFatigue * 100}%`;
    this.wear.dataset.level = h.structuralFatigue > 0.6 ? 'bad' : h.structuralFatigue > 0.3 ? 'warn' : 'ok';
    this.wearText.textContent = `${Math.round(h.structuralFatigue * 100)}%`;
    this.stacks.forEach((s, i) => s.classList.toggle('on', i < h.fatigueStacks));
    this.brace.classList.toggle('on', h.bracing);

    for (const id of PART_IDS) {
      const p = h.parts[id];
      const hp = partHealth(p);
      const e = this.partEls.get(id)!;
      e.dataset.level = p.detached ? 'lost' : hp > 0.7 ? 'ok' : hp > 0.4 ? 'warn' : 'bad';
      e.classList.toggle('peel', !p.detached && p.joint < 0.5);
      e.classList.toggle('taped', p.tape > 0);
      e.title = `${partLabel[id]} ${p.detached ? '脱落' : `${Math.round(hp * 100)}%`}`;
    }
    const repairing = h.status === 'repairing';
    this.repair.classList.toggle('on', repairing);
    if (repairing) {
      const left = Math.max(0, h.repairTotal - h.statusTime);
      this.repairText.textContent = `🔧 修理中 残り ${left.toFixed(1)}秒`;
      this.repairFill.style.width = `${Math.min(1, h.statusTime / h.repairTotal) * 100}%`;
    }
  }
}

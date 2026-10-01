import { courseConfig } from '../config/course';
import { gateColors, runningStyleLabel } from '../config/horses';
import { raceConfig } from '../config/race';
import type { FlowPhase } from '../game/phase';
import type { SessionEvents } from '../game/Session';
import { NetSession } from '../net/NetSession';
import { Course } from '../sim/Course';
import { PART_IDS, RIGHT_LEGS, LEFT_LEGS, damageEffects, partHealth, partLabel } from '../sim/damage';
import { computePerformance } from '../sim/performance';
import type { HorseState, RaceState } from '../sim/types';
import { el, formatRaceTime } from '../ui/format';
import { SettingsPanel } from '../ui/SettingsPanel';
import { applyDocumentPrefs } from '../ui/prefs';
import { TalkingPoints } from './TalkingPoints';

const PHASE_LABEL: Record<FlowPhase, string> = {
  build: 'ロビー（出走受付）', intro: 'レース紹介', paddock: '出走馬紹介', gate: 'ゲートイン', running: 'レース中',
  finish: 'ゴール', replay: 'リプレイ', results: '確定',
};
const STATUS_LABEL: Record<HorseState['status'], string> = { running: '走行', fallen: '転倒', recovering: '起き上がり', repairing: '修理中' };

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const bar = (v: number, warn = 0.4, bad = 0.7) =>
  `<div class="cm-bar"><i style="width:${Math.min(100, v * 100)}%" class="${v >= bad ? 'bad' : v >= warn ? 'warn' : ''}"></i></div>`;
const hpClass = (v: number) => (v < 0.35 ? 'bad' : v < 0.65 ? 'warn' : 'ok');

/** 実況者用: everything the commentator needs, nothing the audience sees. */
export class CommentaryApp {
  private readonly session: NetSession;
  private readonly root = el('div', 'cm');
  private readonly header = el('div', 'cm-header');
  private readonly table = el('div', 'cm-table');
  private readonly talk = el('div', 'cm-talk');
  private readonly log = el('div', 'cm-log');
  private readonly cards = el('div', 'cm-cards');
  private readonly map = el('div', 'cm-map');
  private readonly points = new TalkingPoints();
  private maxSpeed: number[] = [];
  private braceUses: number[] = [];
  private logLines: string[] = [];
  private lastSeq = 0;
  private lastDom = 0;
  private last = performance.now();
  private course: Course | null = null;

  constructor() {
    document.body.classList.add('dash-mode');
    applyDocumentPrefs();
    const settings = new SettingsPanel();
    document.getElementById('app')!.append(settings.button, settings.panel);
    const events: SessionEvents = {
      onPhase: () => {},
      onReplaySegment: () => {},
      onSetup: () => this.onSetup(),
      onNotice: (t) => this.addLog(t),
    };
    this.session = new NetSession(raceConfig, events, 'commentary');
    const side = el('div', 'cm-side');
    side.append(el('h3', '', 'コース'), this.map, el('h3', '', '実況ネタ（自動抽出）'), this.talk, el('h3', '', 'イベントログ'), this.log);
    const main = el('div', 'cm-main');
    main.append(this.table, el('h3', '', '各馬の詳細'), this.cards);
    const body = el('div', 'cm-body');
    body.append(main, side);
    this.root.append(this.header, body);
    document.getElementById('app')!.append(this.root);
    void this.start();
  }

  private async start(): Promise<void> {
    if (!(await this.session.ready(4000))) {
      this.header.textContent = 'サーバーに接続できません（npm run dev / npm start を確認）';
      return;
    }
    const info = this.session.raceInfo!;
    Object.assign(raceConfig, { edition: info.edition, name: info.name, grade: info.grade, distance: info.distance });
    Object.assign(courseConfig, this.session.courseSetup!.config);
    this.course = new Course(courseConfig);
    this.onSetup();
    requestAnimationFrame((t) => this.frame(t));
  }

  private onSetup(): void {
    const live = this.session.flow.liveState;
    if (!live) return;
    this.maxSpeed = live.horses.map(() => 0);
    this.braceUses = live.horses.map(() => 0);
    this.points.reset();
    this.lastSeq = 0;
    if (this.course) this.buildMap(live);
  }

  private addLog(line: string): void {
    this.logLines.unshift(line);
    if (this.logLines.length > 80) this.logLines.pop();
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.session.update(dt, null);
    const st = this.session.flow.liveState;
    if (st) {
      for (const h of st.horses) this.maxSpeed[h.id] = Math.max(this.maxSpeed[h.id] ?? 0, h.speed);
      for (const ev of st.events) {
        if (ev.seq <= this.lastSeq) continue;
        this.lastSeq = ev.seq;
        if (ev.type === 'brace') this.braceUses[ev.horseId]++;
        const h = st.horses[ev.horseId];
        const t = formatRaceTime(ev.time);
        const desc: Record<string, string> = {
          fall: '転倒', recover: '起き上がり', collision: `接触（${(ev.value ?? 0).toFixed(1)}m/s）`, rail: 'ラチ接触', legLift: '内脚浮き',
          brace: `踏ん張る（疲労度UP×${ev.value}）`, finish: `${ev.value}着ゴール`, tapePeel: `${partLabel[ev.part!]} テープ剥離`,
          partLost: `${partLabel[ev.part!]} 脱落`, deform: `${partLabel[ev.part!]} 変形`, repairStart: `修理開始（予定${(ev.value ?? 0).toFixed(0)}秒）`, repairEnd: '修理完了',
        };
        this.addLog(`${t}　${h.gate}番 ${h.name}　${desc[ev.type] ?? ev.type}`);
      }
      this.points.update(st, now / 1000, this.session.flow.phase === 'running');
      this.updateMapDots(st);
      if (now - this.lastDom > 250) {
        this.lastDom = now;
        this.render(st);
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private render(st: RaceState): void {
    const flow = this.session.flow;
    const leader = st.horses[st.order[0]];
    const remaining = Math.max(0, st.distance - leader.progress);
    this.header.innerHTML =
      `<span class="cm-title">第${raceConfig.edition}回 ${esc(raceConfig.name)} ${raceConfig.grade}</span>` +
      `<span class="cm-badge">${PHASE_LABEL[flow.phase]}</span>` +
      `<span>${courseConfig.surface}${st.distance}m</span>` +
      `<span>タイム <b>${formatRaceTime(st.time)}</b></span>` +
      `<span>先頭残り <b>${Math.ceil(remaining)}m</b></span>` +
      `<span class="cm-net">${this.session.connected ? `📶 ${Math.round(this.session.rtt)}ms` : '⚠ 再接続中'}</span>`;

    const rows = st.order.map((id) => {
      const h = st.horses[id];
      const gc = gateColors[(h.gate - 1) % gateColors.length];
      const weakest = PART_IDS.filter((p) => p !== 'body').map((p) => ({ p, hp: h.parts[p].detached ? 0 : Math.min(h.parts[p].joint, h.parts[p].integrity) })).sort((a, b) => a.hp - b.hp)[0];
      const status = h.finished ? `${st.finishOrder.indexOf(h.id) + 1}着` : h.autopilot ? `${STATUS_LABEL[h.status]}・代走` : h.pitRequested ? 'ピットへ' : STATUS_LABEL[h.status];
      const repair = h.status === 'repairing' ? `${Math.max(0, h.repairTotal - h.statusTime).toFixed(1)}秒` : '';
      const danger = h.tipRisk >= 0.6 || h.status !== 'running';
      return `<tr class="${danger ? 'danger' : ''}">
        <td class="cm-rank">${h.rank}</td>
        <td><span class="cm-num" style="background:${gc.bg};color:${gc.fg}">${h.gate}</span></td>
        <td class="cm-name"><b>${esc(h.name)}</b><small>${h.jockey ? `騎手 ${esc(h.jockey)}・` : 'CPU・'}${esc(h.nickname)}</small></td>
        <td>${status}${h.bracing ? ' <span class="cm-tag brace">踏ん張り中</span>' : ''}${h.legsLifted ? ' <span class="cm-tag bad">内脚浮き</span>' : ''}</td>
        <td class="num">${Math.round(h.speed * 3.6)}<small> / ${Math.round((this.maxSpeed[h.id] ?? 0) * 3.6)}</small></td>
        <td>${bar(h.tipRisk, 0.3, 0.6)}<small>${pct(h.tipRisk)}</small></td>
        <td>${bar(h.structuralFatigue)}<small>${pct(h.structuralFatigue)}</small></td>
        <td class="num">×${h.fatigueStacks}<small> / ${this.braceUses[h.id] ?? 0}回</small></td>
        <td>${weakest ? `${partLabel[weakest.p]} <span class="${hpClass(weakest.hp)}">${h.parts[weakest.p].detached ? '脱落' : pct(weakest.hp)}</span>` : ''}</td>
        <td class="num">${repair}</td>
        <td class="num">${h.falls}/${h.repairs}/${h.collisions}</td>
      </tr>`;
    });
    this.table.innerHTML = `<table><thead><tr><th>順</th><th>番</th><th>馬名 / 騎手・異名</th><th>状態</th><th>速度 / 最高 km/h</th><th>転倒危険度</th><th>構造疲労</th><th>疲労度UP / 踏ん張り</th><th>最弱部位</th><th>修理残</th><th>転倒/修理/接触</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;

    this.talk.innerHTML = this.points.list
      .slice(0, 14)
      .map((p) => `<div class="cm-point ${p.priority}">${esc(p.text)}</div>`)
      .join('') || '<div class="cm-empty">レースが始まると実況ネタが出ます</div>';
    this.log.innerHTML = this.logLines.slice(0, 40).map((l) => `<div>${esc(l)}</div>`).join('');
    this.cards.innerHTML = st.horses.map((h) => this.card(h)).join('');
  }

  private card(h: HorseState): string {
    const gc = gateColors[(h.gate - 1) % gateColors.length];
    const perf = computePerformance(h.body);
    const b = h.body;
    const fx = damageEffects(h);
    // which side carries the cornering load right now
    const course = this.course!;
    const cornering = course.segmentAt(h.courseS).kind === 'corner' && Math.abs(h.loadRatio) > 0.8;
    const loaded = new Set(cornering ? (h.loadRatio > 0 ? RIGHT_LEGS : LEFT_LEGS) : []);
    const parts = PART_IDS.map((id) => {
      const p = h.parts[id];
      const hp = partHealth(p);
      return `<tr><td>${partLabel[id]}${loaded.has(id) ? ' <span class="cm-tag bad">負荷大</span>' : ''}</td>
        <td class="${hpClass(p.integrity)}">${p.detached ? '脱落' : pct(p.integrity)}</td>
        <td class="${hpClass(p.joint)}">${p.detached ? '-' : pct(p.joint)}</td>
        <td class="${p.deform > 0.3 ? 'warn' : ''}">${pct(p.deform)}</td>
        <td>${p.tape}</td><td class="${hpClass(hp)}">${pct(hp)}</td></tr>`;
    }).join('');
    return `<div class="cm-card">
      <div class="cm-card-head"><span class="cm-num" style="background:${gc.bg};color:${gc.fg}">${h.gate}</span>
        <div><b>${esc(h.name)}</b><small>${h.jockey ? `騎手 ${esc(h.jockey)}` : `CPU・${runningStyleLabel[h.style]}`}　異名「${esc(h.nickname)}」</small></div></div>
      <div class="cm-spec">重量${perf.mass.toFixed(1)}kg・重心${perf.cgHeight.toFixed(2)}m・脚長×${b.legLength.toFixed(2)}・車幅${Math.round(b.stanceWidth * 100)}cm・段ボール×${b.ply.toFixed(2)}・補強×${b.reinforcement.toFixed(2)}・テープ×${b.tape.toFixed(2)}</div>
      <div class="cm-spec">最高速${Math.round(perf.topSpeed * 3.6)}km/h（現在上限${Math.round(h.topSpeed * 3.6)}）・コーナー限界${perf.cornerLimit.toFixed(2)}G相当・損傷で速度×${fx.topSpeedMul.toFixed(2)}${Math.abs(fx.steerBias) > 0.01 ? `・進路が${fx.steerBias > 0 ? '外' : '内'}へ流れる` : ''}</div>
      <table class="cm-parts"><thead><tr><th>部位</th><th>耐久</th><th>接合</th><th>変形</th><th>テープ</th><th>状態</th></tr></thead><tbody>${parts}</tbody></table>
    </div>`;
  }

  private dots = new Map<number, SVGCircleElement>();

  private buildMap(st: RaceState): void {
    const c = this.course!;
    const W = c.config.trackWidth;
    const pts: string[] = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let s = 0; s <= c.lapLength; s += 10) {
      const p = c.sample(s, W / 2);
      pts.push(`${p.x.toFixed(1)},${p.z.toFixed(1)}`);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const f = c.sample(c.finishS, -2);
    const f2 = c.sample(c.finishS, W + 2);
    const pad = 40;
    this.map.innerHTML = `<svg viewBox="${minX - pad} ${minZ - pad} ${maxX - minX + 2 * pad} ${maxZ - minZ + 2 * pad}"><polygon points="${pts.join(' ')}" class="mm-track" style="stroke-width:${W}"/><line x1="${f.x}" y1="${f.z}" x2="${f2.x}" y2="${f2.z}" class="mm-finish"/></svg>`;
    const svg = this.map.querySelector('svg')!;
    this.dots.clear();
    for (const h of st.horses) {
      const d = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      d.setAttribute('r', '24');
      d.setAttribute('fill', gateColors[(h.gate - 1) % gateColors.length].bg);
      d.setAttribute('class', 'mm-dot');
      svg.append(d);
      this.dots.set(h.id, d);
    }
  }

  private updateMapDots(st: RaceState): void {
    for (const h of st.horses) {
      const d = this.dots.get(h.id);
      if (!d) continue;
      d.setAttribute('cx', h.x.toFixed(1));
      d.setAttribute('cy', h.z.toFixed(1));
    }
  }
}

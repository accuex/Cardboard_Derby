import { LEG_IDS, PART_IDS, partLabel } from '../sim/damage';
import type { HorseState, RaceEvent, RaceState } from '../sim/types';

export type Priority = 'hot' | 'warn' | 'info';

export interface TalkingPoint {
  key: string;
  at: number;
  priority: Priority;
  text: string;
  gate?: number;
}

const kmh = (v: number) => Math.round(v * 3.6);

/**
 * 実況ネタ: turns telemetry thresholds and race events into short call-outs
 * a human commentator can read out. Rule based (not AI), each with a cooldown.
 */
export class TalkingPoints {
  readonly list: TalkingPoint[] = [];
  private readonly cooldown = new Map<string, number>();
  private prevOrder: number[] = [];
  private leader = -1;
  private fastest = 0;
  private calls = new Set<number>();
  private lastSeq = 0;

  reset(): void {
    this.list.length = 0;
    this.cooldown.clear();
    this.prevOrder = [];
    this.leader = -1;
    this.fastest = 0;
    this.calls.clear();
    this.lastSeq = 0;
  }

  private add(key: string, priority: Priority, text: string, now: number, cool: number, gate?: number): void {
    if ((this.cooldown.get(key) ?? -Infinity) > now) return;
    this.cooldown.set(key, now + cool);
    this.list.unshift({ key, at: now, priority, text, gate });
    if (this.list.length > 40) this.list.pop();
  }

  update(st: RaceState, now: number, running: boolean): void {
    const who = (h: HorseState) => `${h.gate}番 ${h.name}`;
    // Events first: they are the big moments
    for (const ev of st.events) {
      if (ev.seq <= this.lastSeq) continue;
      this.lastSeq = ev.seq;
      this.fromEvent(ev, st, now);
    }
    if (!running) return;

    const leader = st.horses[st.order[0]];
    const remaining = st.distance - leader.progress;
    if (leader.id !== this.leader && this.leader >= 0) this.add(`lead`, 'hot', `先頭が入れ替わった！ ${who(leader)} がハナに立つ`, now, 4, leader.gate);
    this.leader = leader.id;

    for (const mark of [1000, 600, 400, 200]) {
      if (remaining <= mark && !this.calls.has(mark) && st.distance > mark + 100) {
        this.calls.add(mark);
        const second = st.horses[st.order[1]];
        const gap = ((leader.progress - second.progress) / 2.4).toFixed(1);
        this.add(`mark${mark}`, 'info', `残り${mark}m！ 先頭 ${who(leader)}、2番手 ${second.gate}番とは${gap}馬身`, now, 999);
      }
    }

    // Overtakes (compare with the previous order)
    if (this.prevOrder.length) {
      st.order.forEach((id, i) => {
        const before = this.prevOrder.indexOf(id);
        if (before > i && i < 3) {
          const passed = st.horses[this.prevOrder[i]];
          const h = st.horses[id];
          if (passed && passed.id !== id) this.add(`pass${id}`, 'info', `${who(h)} が ${passed.gate}番をかわして${i + 1}番手！`, now, 6, h.gate);
        }
      });
    }
    this.prevOrder = [...st.order];

    for (const h of st.horses) {
      if (h.finished) continue;
      const pct = (v: number) => Math.round(v * 100);
      if (h.status === 'running' && h.tipRisk >= 0.6) this.add(`tip${h.id}`, 'hot', `【危険】${who(h)} 転倒危険度${pct(h.tipRisk)}%！${h.legsLifted ? ' 内脚が浮いている！' : ''}`, now, 4, h.gate);
      if (h.speed > this.fastest + 0.05 && h.speed > 16) {
        this.fastest = h.speed;
        this.add('fast', 'info', `本レース最速 ${kmh(h.speed)}km/h！ ${who(h)}`, now, 8, h.gate);
      }
      if (h.fatigueStacks >= 3) this.add(`stk${h.id}`, 'warn', `${who(h)} 疲労度UP×${h.fatigueStacks}！ 踏ん張りの代償が来るか`, now, 15, h.gate);
      if (h.structuralFatigue >= 0.7) this.add(`fat${h.id}`, 'warn', `${who(h)} 構造疲労${pct(h.structuralFatigue)}%、最後まで持つか`, now, 20, h.gate);
      if (h.status === 'repairing') this.add(`rep${h.id}`, 'info', `${who(h)} 修理中、復帰まで残り${Math.max(0, h.repairTotal - h.statusTime).toFixed(0)}秒`, now, 6, h.gate);
      if (h.autopilot) this.add(`ap${h.id}`, 'warn', `${who(h)} 通信が切れてCPUが代走中`, now, 20, h.gate);
      for (const id of PART_IDS) {
        const p = h.parts[id];
        if (p.detached) continue;
        if (p.joint < 0.3) this.add(`joint${h.id}${id}`, 'warn', `${who(h)} ${partLabel[id]}のテープがもう限界！（接合強度${pct(p.joint)}%）`, now, 20, h.gate);
        else if (p.integrity < 0.35) this.add(`int${h.id}${id}`, 'warn', `${who(h)} ${partLabel[id]}がボロボロです（耐久${pct(p.integrity)}%）`, now, 20, h.gate);
        if (LEG_IDS.includes(id) && p.deform >= 0.5) this.add(`def${h.id}${id}`, 'info', `${who(h)} ${partLabel[id]}が曲がって進路が流れている`, now, 25, h.gate);
      }
    }
  }

  private fromEvent(ev: RaceEvent, st: RaceState, now: number): void {
    const h = st.horses[ev.horseId];
    if (!h) return;
    const who = `${h.gate}番 ${h.name}`;
    switch (ev.type) {
      case 'fall':
        this.add(`ev${ev.seq}`, 'hot', `転倒！ ${who}、${kmh(ev.value ?? 0)}km/hから崩れ落ちた！`, now, 0, h.gate);
        break;
      case 'partLost':
        this.add(`ev${ev.seq}`, 'hot', `${who} ${partLabel[ev.part!]}が取れた！ 段ボールが宙を舞う！`, now, 0, h.gate);
        break;
      case 'collision':
        if ((ev.value ?? 0) > 2) this.add(`ev${ev.seq}`, 'hot', `激突！ ${h.gate}番と${st.horses[ev.otherId ?? 0].gate}番が接触！`, now, 0, h.gate);
        break;
      case 'brace':
        if ((ev.value ?? 0) >= 2) this.add(`br${h.id}`, 'info', `${who} ここで踏ん張った！ 疲労度UP×${ev.value}`, now, 6, h.gate);
        break;
      case 'repairStart':
        this.add(`ev${ev.seq}`, 'warn', `${who} 修理に入ります、予定${(ev.value ?? 0).toFixed(0)}秒`, now, 0, h.gate);
        break;
      case 'repairEnd':
        this.add(`ev${ev.seq}`, 'info', `${who} 修理完了、ガムテープ増し増しで戦線復帰！`, now, 0, h.gate);
        break;
      case 'finish':
        if (ev.value === 1) this.add(`ev${ev.seq}`, 'hot', `ゴール！ 1着は ${who}！`, now, 0, h.gate);
        break;
    }
  }
}

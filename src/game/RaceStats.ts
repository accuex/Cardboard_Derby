import type { RaceState } from '../sim/types';

/** Per-horse numbers worth keeping after a race (統計 / 特別賞). */
export interface HorseRaceStats {
  topSpeed: number;
  /** Hardest collision (m/s). */
  maxImpact: number;
  /** Highest 構造疲労 reached (0..1). */
  maxFatigue: number;
  falls: number;
  repairs: number;
  braces: number;
  partsLost: number;
  /** Places gained from the worst position held after the start (最大逆転順位). */
  comeback: number;
  /** Mean speed while running (m/s), for 亀さん賞. */
  avgSpeed: number;
}

export const emptyStats = (): HorseRaceStats => ({
  topSpeed: 0, maxImpact: 0, maxFatigue: 0, falls: 0, repairs: 0, braces: 0, partsLost: 0, comeback: 0, avgSpeed: 0,
});

/** Watches a running race (any RaceState source) and accumulates statistics. */
export class RaceStatsTracker {
  private stats: HorseRaceStats[] = [];
  private worstRank: number[] = [];
  private speedSum: number[] = [];
  private samples: number[] = [];
  private lastSeq = 0;

  reset(n: number): void {
    this.stats = Array.from({ length: n }, emptyStats);
    this.worstRank = new Array(n).fill(0);
    this.speedSum = new Array(n).fill(0);
    this.samples = new Array(n).fill(0);
    this.lastSeq = 0;
  }

  update(st: RaceState): void {
    if (st.phase === 'waiting') return;
    if (this.stats.length !== st.horses.length) this.reset(st.horses.length);
    for (const h of st.horses) {
      const s = this.stats[h.id];
      s.topSpeed = Math.max(s.topSpeed, h.speed);
      s.maxFatigue = Math.max(s.maxFatigue, h.structuralFatigue);
      s.falls = h.falls;
      s.repairs = h.repairs;
      if (!h.finished) {
        // ignore the scramble out of the gate
        if (st.time > 10) this.worstRank[h.id] = Math.max(this.worstRank[h.id], h.rank);
        this.speedSum[h.id] += h.speed;
        this.samples[h.id]++;
      }
    }
    for (const ev of st.events) {
      if (ev.seq <= this.lastSeq) continue;
      this.lastSeq = ev.seq;
      const s = this.stats[ev.horseId];
      if (!s) continue;
      if (ev.type === 'collision') {
        s.maxImpact = Math.max(s.maxImpact, ev.value ?? 0);
        const o = ev.otherId !== undefined ? this.stats[ev.otherId] : null;
        if (o) o.maxImpact = Math.max(o.maxImpact, ev.value ?? 0);
      } else if (ev.type === 'rail') s.maxImpact = Math.max(s.maxImpact, ev.value ?? 0);
      else if (ev.type === 'brace') s.braces++;
      else if (ev.type === 'partLost') s.partsLost++;
    }
  }

  /** Final numbers; `finalRank` is the official placing (1-based). */
  result(st: RaceState): HorseRaceStats[] {
    return st.horses.map((h) => {
      const s = { ...this.stats[h.id] ?? emptyStats() };
      const final = st.order.indexOf(h.id) + 1;
      s.comeback = Math.max(0, (this.worstRank[h.id] || final) - final);
      s.avgSpeed = this.samples[h.id] ? this.speedSum[h.id] / this.samples[h.id] : 0;
      return s;
    });
  }
}

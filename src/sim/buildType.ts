import { referenceBody } from '../config/build';
import type { HorseBody } from '../config/horses';
import { computePerformance, type HorsePerformance } from './performance';

/** Performance relative to the reference horse (1.0 = average). */
export interface BuildStats {
  speed: number;
  accel: number;
  corner: number;
  durability: number;
  repair: number;
}

export interface BuildType {
  id: string;
  name: string;
  description: string;
}

const ref = computePerformance(referenceBody);

const durabilityOf = (p: HorsePerformance) => 1 / (p.fragility * (p.jointWearMul + p.integrityWearMul) * 0.5);

export function buildStats(perf: HorsePerformance): BuildStats {
  return {
    speed: perf.topSpeed / ref.topSpeed,
    accel: perf.acceleration / ref.acceleration,
    corner: perf.cornerLimit / ref.cornerLimit,
    durability: durabilityOf(perf) / durabilityOf(ref),
    repair: ref.repairBase / perf.repairBase,
  };
}

/** 0..100 gauge values for the UI. */
export function statGauges(s: BuildStats): Record<keyof BuildStats, number> {
  const g = (v: number, lo: number, hi: number) => Math.round(Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100);
  return {
    speed: g(s.speed, 0.9, 1.1),
    accel: g(s.accel, 0.6, 1.5),
    corner: g(s.corner, 0.6, 1.6),
    durability: g(Math.log(s.durability), Math.log(0.4), Math.log(3)),
    repair: g(s.repair, 0.6, 1.4),
  };
}

interface Rule extends BuildType {
  test: (s: BuildStats, b: HorseBody, p: HorsePerformance) => boolean;
}

/**
 * Nicknames judged from the actual numbers, first match wins (not a class system:
 * the same name can come from very different builds).
 */
const RULES: Rule[] = [
  {
    id: 'defect', name: '欠陥建築', description: '速くもなく、曲がれず、すぐ壊れる。なぜこうなった。',
    test: (s) => s.corner < 0.78 && s.durability < 0.75 && s.speed < 1.02,
  },
  {
    id: 'tapeball', name: 'ガムテープの塊', description: '段ボールよりガムテープの方が多い。剥がれる気配がない。',
    test: (_s, b) => b.tape >= 1.7,
  },
  {
    id: 'stilts', name: '竹馬', description: '脚が長すぎる。直線は夢があるが、コーナーは祈るしかない。',
    test: (_s, b) => b.legLength >= 1.22,
  },
  {
    id: 'chabudai', name: 'ちゃぶ台', description: '低くて広い。まず転ばないが、どう見ても家具。',
    test: (s, b) => b.stanceWidth >= 0.64 && s.corner >= 1.35 && s.speed < 1,
  },
  {
    id: 'straight', name: '直線番長', description: '最高速は抜群。コーナー手前でしっかり減速できるかが勝負。',
    test: (s) => s.speed >= 1.03 && s.corner <= 0.92,
  },
  {
    id: 'turtle', name: 'ガチガチ亀さん', description: 'とにかく遅いが、とにかく壊れない。他馬の自滅を待つ。',
    test: (s) => s.durability >= 1.6 && s.speed <= 0.99,
  },
  {
    id: 'corner', name: 'コーナー職人', description: 'コーナーを全開で駆け抜ける。直線では少し置いていかれる。',
    test: (s) => s.corner >= 1.15 && s.speed <= 1.0,
  },
  {
    id: 'paper', name: '紙装甲', description: '軽くて速いが、ぶつかった瞬間に終わる。',
    test: (s) => s.durability < 0.7,
  },
  {
    id: 'rocket', name: 'ロケット', description: '出足が鋭い。序盤で逃げて、そのまま持たせたい。',
    test: (s) => s.accel >= 1.2,
  },
  {
    id: 'honor', name: '優等生', description: '何でも平均点。乗り手の腕がそのまま結果に出る。',
    test: (s) => [s.speed, s.accel, s.corner, s.durability].every((v) => Math.abs(v - 1) < 0.12),
  },
];

const FALLBACK: BuildType = { id: 'unique', name: '個性派', description: '分類不能。乗ってみるまで分からない。' };

export function judgeBuildType(body: HorseBody, perf: HorsePerformance = computePerformance(body)): BuildType {
  const s = buildStats(perf);
  const hit = RULES.find((r) => r.test(s, body, perf));
  return hit ? { id: hit.id, name: hit.name, description: hit.description } : FALLBACK;
}

import type { CourseConfig } from '../config/course';
import { pacingConfig, type HorseProfile } from '../config/horses';
import type { RaceConfig } from '../config/race';
import { Course } from '../sim/Course';
import { RaceSimulation } from '../sim/RaceSimulation';

/** What the odds worker needs to run trial races off-screen. */
export interface OddsJob {
  id: number;
  course: CourseConfig;
  race: RaceConfig;
  field: HorseProfile[];
  sims: number;
  seed: number;
  /** The TV mode's CPU tuning (the worker has its own copy of the config). */
  pacing: Partial<typeof pacingConfig>;
}

/** TV mode: bigger day-to-day form swings, so favourites are beatable (about a third win, as in real racing). */
export const tvPacing: Partial<typeof pacingConfig> = { formSpread: 0.04, conditionSpread: 0.04, level: 'normal' };

export interface OddsProgress {
  id: number;
  done: number;
  /** Wins per gate index. */
  wins: number[];
  /** Top-2 finishes per gate index (for 馬連 / 複勝 estimates). */
  top2: number[];
}

/** Runs one complete race headless and returns the finishing order (gate indexes). */
export function trialRace(course: Course, race: RaceConfig, field: HorseProfile[], seed: number): number[] {
  const sim = new RaceSimulation(course, race, field, seed);
  sim.start();
  const step = 1 / race.simulation.tickRate;
  const limit = race.distance * 0.2 * race.simulation.tickRate; // ~ 5 m/s worst case
  for (let i = 0; i < limit && sim.state.finishOrder.length < 2; i++) sim.step(step);
  return [...sim.state.finishOrder];
}

/** Runs `job.sims` trial races, reporting every few races. */
export function runOdds(job: OddsJob, report: (p: OddsProgress) => void): void {
  Object.assign(pacingConfig, job.pacing);
  const course = new Course(job.course);
  const n = job.field.length;
  const wins = new Array<number>(n).fill(0);
  const top2 = new Array<number>(n).fill(0);
  for (let k = 0; k < job.sims; k++) {
    const order = trialRace(course, job.race, job.field, (job.seed + k * 7919) >>> 0);
    if (order[0] !== undefined) wins[order[0]]++;
    for (const i of order.slice(0, 2)) top2[i]++;
    if (k % 4 === 3 || k === job.sims - 1) report({ id: job.id, done: k + 1, wins: [...wins], top2: [...top2] });
  }
}

/** JRA-like takeout: 単勝 pays back 80%. */
const TAKEOUT = 0.8;

/**
 * Win probabilities: mostly the trial races, a little of the public's "form" opinion (prize money),
 * so the market is not a perfect oracle and upsets still pay well.
 */
export function winProbabilities(wins: number[], done: number, earnings: number[]): number[] {
  const n = wins.length;
  const sim = wins.map((w) => (w + 0.4) / (done + 0.4 * n));
  const formRaw = earnings.map((e) => Math.sqrt(Math.max(0, e) + 400));
  const formSum = formRaw.reduce((a, b) => a + b, 0);
  const simWeight = done >= 8 ? 0.78 : (done / 8) * 0.78;
  return sim.map((p, i) => simWeight * p + (1 - simWeight) * (formRaw[i] / formSum));
}

export function toOdds(prob: number[]): number[] {
  return prob.map((p) => Math.min(999.9, Math.max(1.1, Math.floor((TAKEOUT / p) * 10) / 10)));
}

/** 人気: 1 = favourite. */
export function popularity(odds: number[]): number[] {
  const idx = odds.map((_, i) => i).sort((a, b) => odds[a] - odds[b] || a - b);
  const pop = new Array<number>(odds.length);
  idx.forEach((i, r) => (pop[i] = r + 1));
  return pop;
}

/** Newspaper marks: ◎本命 ○対抗 ▲単穴 △連下, ☆ an outsider the AI likes. */
export function predictionMarks(prob: number[], odds: number[]): string[] {
  const idx = prob.map((_, i) => i).sort((a, b) => prob[b] - prob[a]);
  const marks = new Array<string>(prob.length).fill('');
  ['◎', '○', '▲', '△', '△'].forEach((m, r) => {
    if (idx[r] !== undefined) marks[idx[r]] = m;
  });
  // 穴馬: the best value among the long shots
  const value = idx.filter((i) => !marks[i] && odds[i] >= 15).sort((a, b) => prob[b] * odds[b] - prob[a] * odds[a])[0];
  if (value !== undefined) marks[value] = '☆';
  return marks;
}

/** Approximate payouts (円 per 100円) for the result board. */
export function payouts(prob: number[], odds: number[], first: number, second: number | undefined, third: number | undefined) {
  const place = (i: number | undefined) => (i === undefined ? null : Math.max(100, Math.round((1 + (odds[i] - 1) / 3.6) * 10) * 10));
  let quinella: number | null = null;
  if (second !== undefined) {
    const a = prob[first], b = prob[second];
    const pair = (a * b) / Math.max(0.05, 1 - a) + (b * a) / Math.max(0.05, 1 - b);
    quinella = Math.max(110, Math.round((0.775 / pair) * 10) * 10);
  }
  return {
    win: Math.round(odds[first] * 100),
    place: [place(first), place(second), place(third)],
    quinella,
  };
}

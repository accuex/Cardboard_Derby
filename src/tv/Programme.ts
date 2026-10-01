import { coursePresets, validDistances } from '../config/courses';
import type { RaceConfig } from '../config/race';
import { Rng } from '../core/rng';
import type { TvHorse } from './Stable';

export type Grade = RaceConfig['grade'];

export interface TvResult {
  /** Horse ids in finishing order (non-finishers last). */
  order: number[];
  finished: boolean[];
  winnerTime: number | null;
  winnerOdds: number;
  winnerPop: number;
  payWin: number;
  payPlace: (number | null)[];
  payQuinella: number | null;
  falls: number;
  partsLost: number;
}

export interface TvRace {
  key: string;
  no: number;
  /** 新馬 / 未勝利 / 1勝クラス … / 特別 / オープン / 重賞 */
  className: string;
  name: string;
  grade: Grade;
  edition: number;
  distance: number;
  postTime: string;
  /** 1着本賞金 (万円). */
  prize: number;
  tagline: string;
  /** Horse ids in gate order (drawn when the race comes up). */
  field: number[] | null;
  /** Final odds by gate index (fixed at post time). */
  odds: number[] | null;
  prob: number[] | null;
  result: TvResult | null;
}

export interface TvDay {
  day: number;
  venueId: string;
  venueName: string;
  weather: string;
  going: string;
  races: TvRace[];
}

const SPECIAL = ['折り目特別', 'みかん箱特別', '梱包材特別', 'クラフト紙特別', '緩衝材特別', 'ホチキス特別', '宅配便特別', '取っ手穴特別'];
const OPEN = ['リサイクルステークス', 'ナミイタステークス', 'ガムテープカップ', 'パッケージステークス', 'カートンオープン', 'ハコヅメステークス'];
const GRADED: Record<'G1' | 'G2' | 'G3', string[]> = {
  G1: ['段ボールダービー', 'ガムテープ大賞典', 'ハコ王決定戦', '段ボール天翔賞', 'ダンボリ記念'],
  G2: ['クラフト記念', '紙箱賞', '梱包王冠', 'オリガミカップ'],
  G3: ['リボン賞', 'シール杯', 'ハコイリ杯', '緩衝材記念'],
};
const MAIN_TAGLINES = ['走る。壊れる。それでも、前へ。', '段ボールの頂点へ。', '剥がれても、折れても、ゴールまで。', 'テープ一枚の差が、栄光を分ける。'];
const WEATHER: [string, string][] = [['晴れ', '良'], ['晴れ', '良'], ['曇り', '良'], ['曇り', '稍重'], ['小雨', '稍重'], ['雨', '重']];

interface Slot { className: string; prize: number; kind: 'maiden' | 'debut' | 'class' | 'special' | 'open' | 'main' | 'last' }
const DAY_PLAN: Slot[] = [
  { className: '新馬', prize: 700, kind: 'debut' },
  { className: '未勝利', prize: 550, kind: 'maiden' },
  { className: '未勝利', prize: 550, kind: 'maiden' },
  { className: '1勝クラス', prize: 800, kind: 'class' },
  { className: '新馬', prize: 700, kind: 'debut' },
  { className: '1勝クラス', prize: 800, kind: 'class' },
  { className: '2勝クラス', prize: 1100, kind: 'class' },
  { className: '2勝クラス', prize: 1100, kind: 'class' },
  { className: '特別', prize: 1500, kind: 'special' },
  { className: 'オープン', prize: 2400, kind: 'open' },
  { className: '重賞', prize: 4000, kind: 'main' },
  { className: '3勝クラス', prize: 1800, kind: 'last' },
];
const MAIN_PRIZE: Record<string, number> = { G1: 15000, G2: 6000, G3: 4000 };
/** Share of the winner's prize for 1st..5th. */
export const PRIZE_SHARE = [1, 0.4, 0.25, 0.15, 0.1];

const fmtTime = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

/** A racing day: one venue, 12 races (or the last `count` of them), the main race in 11R. */
export function createDay(day: number, seed: number, count = 12): TvDay {
  const rng = new Rng(seed * 31 + day * 977);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rng.next() * a.length)];
  const venue = coursePresets[(day - 1) % coursePresets.length];
  const [weather, going] = pick(WEATHER);
  const all = validDistances(venue.config).filter((d) => d >= 1400);
  const short = all.filter((d) => d <= 2000);
  const regular = all.filter((d) => d <= 2600);
  const long = all.filter((d) => d >= 2000 && d <= 3200);
  const mainGrade = (['G1', 'G3', 'G2'] as const)[(day - 1) % 3];
  const races = DAY_PLAN.map((slot, i): TvRace => {
    const no = i + 1;
    let name = slot.className;
    let grade: Grade = '';
    let edition = 0;
    let prize = slot.prize;
    let tagline = '';
    let pool = regular;
    if (slot.kind === 'debut' || slot.kind === 'maiden') pool = short.length ? short : regular;
    if (slot.kind === 'special') name = pick(SPECIAL);
    if (slot.kind === 'open') {
      name = pick(OPEN);
      grade = 'OP';
    }
    if (slot.kind === 'main') {
      grade = mainGrade;
      name = pick(GRADED[mainGrade]);
      edition = 10 + day + Math.floor(rng.next() * 30);
      prize = MAIN_PRIZE[mainGrade];
      tagline = pick(MAIN_TAGLINES);
      pool = long.length ? long : regular;
    }
    // 10:05 start, 30 minutes apart; the main race goes a little later, like the real thing
    const post = 10 * 60 + 5 + i * 30 + (slot.kind === 'main' ? 5 : slot.kind === 'last' ? 10 : 0);
    return {
      key: `${day}-${no}`,
      no,
      className: slot.className,
      name,
      grade,
      edition,
      distance: pick(pool.length ? pool : all),
      postTime: fmtTime(post),
      prize,
      tagline,
      field: null,
      odds: null,
      prob: null,
      result: null,
    };
  });
  return { day, venueId: venue.id, venueName: venue.config.venueName, weather, going, races: races.slice(-Math.max(1, Math.min(12, count))) };
}

/** Draw the runners for a race: class-appropriate, rested horses, gates shuffled. */
export function drawField(stable: TvHorse[], day: TvDay, race: TvRace, seed: number): number[] {
  const rng = new Rng(seed ^ (race.no * 7331 + day.day * 104729));
  const slot = DAY_PLAN[race.no - 1];
  const size = slot.kind === 'main' || slot.kind === 'open' ? 8 : 6 + Math.floor(rng.next() * 3);
  // a horse runs at most once every three races
  const rested = (h: TvHorse) => {
    const [d, n] = h.lastRaceKey.split('-').map(Number);
    return d !== day.day || race.no - n >= 3;
  };
  let pool = stable.filter(rested);
  if (pool.length < size) pool = [...stable];
  const noise = () => rng.next();
  let score: (h: TvHorse) => number;
  switch (slot.kind) {
    case 'debut':
      score = (h) => (h.starts === 0 ? 10 : 0) - h.starts + noise() * 2;
      break;
    case 'maiden':
      score = (h) => (h.wins === 0 && h.starts > 0 ? 10 : 0) - h.wins * 3 + noise() * 3;
      break;
    case 'main':
    case 'open':
      score = (h) => Math.sqrt(h.earnings) / 10 + noise() * (slot.kind === 'main' ? 2 : 4);
      break;
    default:
      score = () => noise();
  }
  const chosen = pool
    .map((h) => ({ h, s: score(h) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, size)
    .map((x) => x.h.id);
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
  }
  return chosen;
}

/** 「1億5000万円」 */
export function formatPrize(man: number): string {
  const oku = Math.floor(man / 10000);
  const rest = Math.round(man % 10000);
  return `${oku ? `${oku}億` : ''}${rest ? `${rest.toLocaleString()}万` : ''}円`;
}

export function formatYen(v: number | null): string {
  return v === null ? '—' : `${v.toLocaleString()}円`;
}

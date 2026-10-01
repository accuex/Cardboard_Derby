import { horseRoster, type HorseProfile, type RunningStyle } from '../config/horses';
import { Rng } from '../core/rng';

/** A horse of the TV mode's stable, with its career record. */
export interface TvHorse {
  id: number;
  profile: HorseProfile;
  starts: number;
  wins: number;
  seconds: number;
  thirds: number;
  /** 獲得賞金 (万円). */
  earnings: number;
  /** Recent finishing positions, newest first (0 = 競走中止 / 着外扱い). */
  form: number[];
  /** Race number of the day it last ran (rest between races). */
  lastRaceKey: string;
}

const PREFIX = ['ダンボール', 'ガムテ', 'ハコ', 'クラフト', 'ミカンバコ', 'オリガミ', 'リサイクル', 'カミ', 'ナミイタ', 'コンテナ', 'ホチキス', 'ノリシロ', 'セロハン', 'カートン', 'ツツミ', 'オリメ', 'フタ', 'ソコヌケ'];
const SUFFIX = ['ドリーム', 'キング', 'スター', 'ボルト', 'ロード', 'オー', 'エース', 'サンダー', 'フラッシュ', 'ブレイブ', 'ヒーロー', 'マーチ', 'ジェット', 'カイザー', 'ルビー', 'リボン', 'タイフーン', 'ミラクル', 'プリンス', 'クイーン', 'ハヤテ', 'ムテキ'];
const SURNAME = ['段田', '箱崎', '紙谷', '折原', '梱野', '貼山', '角田', '厚木', '糊川', '巻島', '包井', '畳屋', '芯野', '波板'];
const GIVEN = ['翔', '剛', '健太', '大和', '蓮', '陽介', '颯', '誠', '優', '光', '隼人', '拓海', 'みのり', 'さくら', 'ひかり'];
const STYLES: RunningStyle[] = ['nige', 'senkou', 'senkou', 'sashi', 'sashi', 'oikomi'];

/** The six original horses plus generated ones: about 30 horses so every race has a fresh field. */
export function createStable(seed: number, size = 30): TvHorse[] {
  const rng = new Rng(seed);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rng.next() * a.length)];
  const used = new Set<string>(horseRoster.map((h) => h.name));
  const jockeys = new Set<string>();
  const jockey = () => {
    for (;;) {
      const j = `${pick(SURNAME)}${pick(GIVEN)}`;
      if (!jockeys.has(j)) return jockeys.add(j), j;
    }
  };
  const profiles: HorseProfile[] = horseRoster.map((p) => ({ ...p, jockey: jockey() }));
  while (profiles.length < size) {
    const name = `${pick(PREFIX)}${pick(SUFFIX)}`;
    if (used.has(name) || name.length > 10) continue;
    used.add(name);
    const r = (a: number, b: number) => Math.round(rng.range(a, b) * 100) / 100;
    profiles.push({
      name,
      jockey: jockey(),
      silkColor: `hsl(${Math.floor(rng.next() * 360)}, ${60 + Math.floor(rng.next() * 30)}%, ${40 + Math.floor(rng.next() * 20)}%)`,
      style: pick(STYLES),
      body: {
        legLength: r(0.96, 1.1),
        stanceWidth: r(0.46, 0.58),
        ply: r(0.8, 1.2),
        reinforcement: r(0.85, 1.5),
        tape: r(0.8, 1.6),
        cgAdjust: r(-0.08, 0.04),
      },
      rider: {
        cornerMargin: r(0.96, 1.0),
        cornerError: r(0.04, 0.09),
        reactRisk: r(0.28, 0.45),
        braceTendency: r(0.6, 1.2),
        reactionTime: r(0.3, 0.6),
      },
    });
  }
  // A made-up past so the first day already has favourites, veterans and debutants
  return profiles.map((profile, id): TvHorse => {
    const star = id < horseRoster.length;
    const starts = star ? 8 + Math.floor(rng.next() * 7) : rng.chance(0.3) ? 0 : 1 + Math.floor(rng.next() * 10);
    const wins = Math.min(starts, Math.floor(starts * rng.range(star ? 0.25 : 0, star ? 0.5 : 0.3)));
    const seconds = Math.min(starts - wins, Math.floor((starts - wins) * rng.range(0, 0.3)));
    const thirds = Math.min(starts - wins - seconds, Math.floor((starts - wins - seconds) * rng.range(0, 0.3)));
    let winsLeft = wins;
    const form = Array.from({ length: Math.min(4, starts) }, () => {
      if (winsLeft > 0 && rng.chance(wins / starts + 0.1)) return winsLeft--, 1;
      return 2 + Math.floor(rng.next() * (star ? 4 : 7));
    });
    const earnings = Math.round(wins * (star ? 2400 : 900) + seconds * 400 + thirds * 250 + starts * 60);
    return { id, profile, starts, wins, seconds, thirds, earnings, form, lastRaceKey: '' };
  });
}

/** 「3戦1勝」 */
export function recordText(h: TvHorse): string {
  return h.starts ? `${h.starts}戦${h.wins}勝` : '初出走';
}

/** 「1-3-2」 newest first, like a racing paper's 近走. */
export function formText(h: TvHorse): string {
  return h.form.length ? h.form.slice(0, 4).map((r) => (r ? String(r) : '中')).join('-') : '—';
}

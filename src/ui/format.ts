import type { RaceConfig } from '../config/race';

/** 「11R 第5回 段ボールダービー G1」 */
export function raceTitle(r: Pick<RaceConfig, 'edition' | 'name' | 'grade' | 'raceNo'>, withGrade = false): string {
  const no = r.raceNo ? `${r.raceNo}R ` : '';
  const ed = r.edition > 0 ? `第${r.edition}回 ` : '';
  return `${no}${ed}${r.name}${withGrade && r.grade ? ` ${r.grade}` : ''}`;
}

export function formatRaceTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** Converts a finishing gap in seconds to JRA-style margin notation (着差). */
export function formatMargin(gapSeconds: number, speed: number): string {
  const lengths = (gapSeconds * speed) / 2.4;
  if (lengths < 0.05) return '同着';
  if (lengths < 0.12) return 'ハナ';
  if (lengths < 0.25) return 'アタマ';
  if (lengths < 0.4) return 'クビ';
  const table: [number, string][] = [
    [0.625, '1/2'], [0.875, '3/4'], [1.125, '1'], [1.375, '1 1/4'], [1.625, '1 1/2'], [1.875, '1 3/4'],
    [2.25, '2'], [2.75, '2 1/2'], [3.5, '3'], [4.5, '4'], [5.5, '5'], [7, '6'], [9, '8'], [10, '10'],
  ];
  for (const [lim, label] of table) if (lengths < lim) return label;
  return '大差';
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

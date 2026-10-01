import type { HorseBody } from './horses';

/** One adjustable body parameter on the build screen. */
export interface BuildParam {
  key: keyof HorseBody;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Words for the low / high ends of the slider. */
  low: string;
  high: string;
  hint: string;
}

export const buildParams: BuildParam[] = [
  { key: 'legLength', label: '脚の長さ', min: 0.8, max: 1.3, step: 0.01, low: '短足', high: '竹馬', hint: '長いほど最高速UP、ただし重心が上がりコーナーで不安定' },
  { key: 'stanceWidth', label: '車幅', min: 0.4, max: 0.72, step: 0.01, low: '細身', high: 'ワイド', hint: '広いほど転びにくいが、空気抵抗で最高速が少し落ちる' },
  { key: 'ply', label: '段ボールの厚さ', min: 0.6, max: 1.5, step: 0.05, low: '軽量化', high: '厚紙', hint: '薄いほど軽くて加速UP、ただし壊れやすい' },
  { key: 'reinforcement', label: '補強', min: 0.6, max: 2.0, step: 0.05, low: 'なし', high: 'ガチガチ', hint: '耐久・接合強度UP、ただし重くなり修理にも時間がかかる' },
  { key: 'tape', label: 'ガムテープ量', min: 0.5, max: 2.0, step: 0.05, low: 'ケチる', high: '巻きまくる', hint: '接合部が剥がれにくくなる。重さと修理時間が増える' },
  { key: 'cgAdjust', label: '重心', min: -0.25, max: 0.15, step: 0.01, low: '重り(低重心)', high: 'かさ上げ', hint: '下げると転びにくいが重りの分だけ重い。上げると軽快だが不安定' },
];

/** Mass model (kg). Reference body ≈ 20kg. */
export const massConfig = {
  headNeckTail: 4,
  torsoPerPly: 6,
  legsPerPlyAndLength: 3,
  perReinforcement: 5,
  perTape: 1.5,
  /** Ballast kg per metre the centre of gravity is lowered. */
  ballastPerMetre: 42,
  /** Raising the body saves a little weight (shorter struts elsewhere). */
  raisedSavingPerMetre: 6,
};

export const referenceBody: HorseBody = { legLength: 1, stanceWidth: 0.5, ply: 1, reinforcement: 1, tape: 1, cgAdjust: 0 };

export const buildPresets: { label: string; body: HorseBody }[] = [
  { label: 'バランス', body: { ...referenceBody } },
  { label: '軽量スピード', body: { legLength: 1.15, stanceWidth: 0.46, ply: 0.7, reinforcement: 0.8, tape: 0.8, cgAdjust: 0.05 } },
  { label: '重装甲', body: { legLength: 0.95, stanceWidth: 0.6, ply: 1.3, reinforcement: 1.8, tape: 1.6, cgAdjust: -0.05 } },
  { label: '低重心', body: { legLength: 0.88, stanceWidth: 0.66, ply: 1, reinforcement: 1.1, tape: 1, cgAdjust: -0.15 } },
];

export const playerDefaults = {
  name: 'マイダンボール号',
  silkColors: ['#e04848', '#3a62d8', '#f0a020', '#2fa36b', '#d85aa8', '#8a5ad8', '#20b8c8', '#222222', '#ffffff'],
};

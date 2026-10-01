import { buildParams, buildPresets, playerDefaults, referenceBody } from '../config/build';
import type { HorseBody } from '../config/horses';
import { HorsePreview } from '../render/HorsePreview';
import { buildStats, judgeBuildType, statGauges } from '../sim/buildType';
import { computePerformance } from '../sim/performance';
import { el } from './format';

export interface PlayerBuild {
  /** 騎手名 (phones ask for it before the build). */
  jockey?: string;
  name: string;
  silkColor: string;
  body: HorseBody;
}

const STORAGE_KEY = 'cardboard-derby-build';

/** Last build, remembered per browser for convenience. */
export function loadSavedBuild(): PlayerBuild {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const b = JSON.parse(raw) as PlayerBuild;
      if (b && b.body && typeof b.name === 'string') return { ...b, body: { ...referenceBody, ...b.body } };
    }
  } catch {
    /* storage unavailable */
  }
  return { name: playerDefaults.name, silkColor: playerDefaults.silkColors[0], body: { ...referenceBody } };
}

function saveBuild(b: PlayerBuild): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

const GAUGES: [keyof ReturnType<typeof statGauges>, string][] = [
  ['speed', '最高速'],
  ['accel', '加速'],
  ['corner', 'コーナー'],
  ['durability', '耐久'],
  ['repair', '修理の速さ'],
];

/** 馬体設計: sliders, live 3D preview, derived stats and the auto-judged nickname. */
export class BuildScreen {
  readonly root = el('div', 'build-screen');
  private readonly preview = new HorsePreview();
  private build: PlayerBuild;
  private readonly sliders = new Map<keyof HorseBody, { input: HTMLInputElement; value: HTMLElement }>();
  private readonly gaugeEls = new Map<string, HTMLElement>();
  private readonly nick = el('div', 'bs-nick');
  private readonly nickDesc = el('div', 'bs-nick-desc');
  private readonly mass = el('span', 'bs-num');
  private readonly cg = el('span', 'bs-num');
  private readonly nameInput = el('input', 'bs-name') as HTMLInputElement;
  private readonly swatches: HTMLButtonElement[] = [];
  private gate = 1;
  private rebuildTimer = 0;

  constructor(private readonly onConfirm: (b: PlayerBuild) => void) {
    this.build = loadSavedBuild();

    const panel = el('div', 'bs-panel');
    const head = el('div', 'bs-head');
    head.append(el('div', 'bs-title', '馬体設計'), el('div', 'bs-sub', '段ボールとガムテープで、あなたの競走馬を組み立てよう'));

    // Left: controls
    const left = el('div', 'bs-left');
    const nameRow = el('label', 'bs-row');
    this.nameInput.maxLength = 12;
    this.nameInput.addEventListener('input', () => (this.build.name = this.nameInput.value || playerDefaults.name));
    nameRow.append(el('span', 'bs-label', '馬名'), this.nameInput);
    const silkRow = el('div', 'bs-row');
    const sw = el('div', 'bs-swatches');
    for (const c of playerDefaults.silkColors) {
      const b = el('button', 'bs-swatch') as HTMLButtonElement;
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', () => {
        this.build.silkColor = c;
        this.refresh(true);
      });
      this.swatches.push(b);
      sw.append(b);
    }
    silkRow.append(el('span', 'bs-label', '勝負服'), sw);

    const presets = el('div', 'bs-presets');
    for (const p of buildPresets) {
      const b = el('button', 'bs-chip', p.label);
      b.addEventListener('click', () => this.setBody(p.body));
      presets.append(b);
    }
    const rnd = el('button', 'bs-chip', 'ランダム');
    rnd.addEventListener('click', () => this.randomize());
    presets.append(rnd);

    const sliders = el('div', 'bs-sliders');
    for (const p of buildParams) {
      const row = el('div', 'bs-slider');
      row.title = p.hint;
      const top = el('div', 'bs-slider-top');
      const value = el('span', 'bs-value');
      top.append(el('span', 'bs-label', p.label), value);
      const input = el('input') as HTMLInputElement;
      input.type = 'range';
      input.min = String(p.min);
      input.max = String(p.max);
      input.step = String(p.step);
      input.addEventListener('input', () => {
        this.build.body[p.key] = Number(input.value);
        this.refresh(true);
      });
      const ends = el('div', 'bs-ends');
      ends.append(el('span', '', p.low), el('span', '', p.high));
      row.append(top, input, ends);
      sliders.append(row);
      this.sliders.set(p.key, { input, value });
    }
    left.append(nameRow, silkRow, presets, sliders);

    // Right: preview + stats
    const right = el('div', 'bs-right');
    const stage = el('div', 'bs-stage');
    stage.append(this.preview.canvas);
    const nickBox = el('div', 'bs-nickbox');
    nickBox.append(el('div', 'bs-nick-label', 'ビルドタイプ判定'), this.nick, this.nickDesc);
    const spec = el('div', 'bs-spec');
    spec.append(el('span', '', '重量 '), this.mass, el('span', '', ' kg　重心 '), this.cg, el('span', '', ' m'));
    const gauges = el('div', 'bs-gauges');
    for (const [key, label] of GAUGES) {
      const row = el('div', 'bs-gauge');
      const bar = el('div', 'bs-gauge-bar');
      const fill = el('div', 'bs-gauge-fill');
      bar.append(fill);
      row.append(el('span', 'bs-label', label), bar);
      gauges.append(row);
      this.gaugeEls.set(key, fill);
    }
    const go = el('button', 'bs-go', 'この馬で出走！');
    go.addEventListener('click', () => {
      this.build.name = this.nameInput.value.trim() || playerDefaults.name;
      saveBuild(this.build);
      this.onConfirm(structuredClone(this.build));
    });
    right.append(stage, nickBox, spec, gauges, go);

    const cols = el('div', 'bs-cols');
    cols.append(left, right);
    panel.append(head, cols);
    this.root.append(panel);
  }

  show(gate: number): void {
    this.gate = gate;
    this.nameInput.value = this.build.name;
    this.root.classList.add('show');
    this.refresh(true);
    this.preview.start();
  }

  hide(): void {
    this.root.classList.remove('show');
    this.preview.stop();
  }

  get current(): PlayerBuild {
    return structuredClone(this.build);
  }

  private setBody(body: HorseBody): void {
    this.build.body = { ...body };
    this.refresh(true);
  }

  private randomize(): void {
    const body = { ...this.build.body };
    for (const p of buildParams) {
      const steps = Math.round((p.max - p.min) / p.step);
      body[p.key] = p.min + Math.round(Math.random() * steps) * p.step;
    }
    this.setBody(body);
  }

  private refresh(rebuildModel: boolean): void {
    const body = this.build.body;
    for (const p of buildParams) {
      const s = this.sliders.get(p.key)!;
      s.input.value = String(body[p.key]);
      const v = body[p.key];
      s.value.textContent = p.key === 'cgAdjust' ? `${v >= 0 ? '+' : ''}${Math.round(v * 100)}cm` : p.key === 'stanceWidth' ? `${Math.round(v * 100)}cm` : `×${v.toFixed(2)}`;
    }
    const perf = computePerformance(body);
    const type = judgeBuildType(body, perf);
    this.nick.textContent = type.name;
    this.nickDesc.textContent = type.description;
    this.mass.textContent = perf.mass.toFixed(1);
    this.cg.textContent = perf.cgHeight.toFixed(2);
    const g = statGauges(buildStats(perf));
    for (const [key] of GAUGES) {
      const e = this.gaugeEls.get(key)!;
      e.style.width = `${g[key]}%`;
      e.dataset.level = g[key] >= 65 ? 'hi' : g[key] <= 30 ? 'lo' : 'mid';
    }
    this.swatches.forEach((b) => b.classList.toggle('on', b.title === this.build.silkColor));
    if (rebuildModel) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = window.setTimeout(() => this.preview.setHorse(body, this.build.silkColor, this.gate), 60);
    }
  }
}

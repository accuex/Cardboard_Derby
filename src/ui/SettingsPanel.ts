import { el } from './format';
import { isPhone, prefs, setPrefs, type Prefs, type Quality } from './prefs';

export interface SettingsOptions {
  graphics?: boolean;
  sound?: boolean;
  haptics?: boolean;
  /** Current drawing resolution, shown next to the quality setting. */
  resolution?: () => number;
}

/** ⚙ 設定: graphics quality, volumes, vibration, reduced motion, large text. */
export class SettingsPanel {
  readonly button = el('button', 'settings-btn', '⚙');
  readonly panel = el('div', 'settings-panel');
  private readonly res = el('span', 'sp-res');

  constructor(private readonly opts: SettingsOptions = {}) {
    this.button.setAttribute('aria-label', '設定');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', () => this.toggle());
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', '設定');
    this.build();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.panel.classList.contains('show')) this.toggle(false);
    });
  }

  toggle(open = !this.panel.classList.contains('show')): void {
    this.panel.classList.toggle('show', open);
    this.button.setAttribute('aria-expanded', String(open));
    if (open) {
      this.refresh();
      (this.panel.querySelector('select, input, button') as HTMLElement | null)?.focus();
    }
  }

  private refresh(): void {
    if (this.opts.resolution) this.res.textContent = `現在の描画解像度 ×${this.opts.resolution().toFixed(2)}`;
  }

  private build(): void {
    const p = prefs();
    const o = this.opts;
    const rows: HTMLElement[] = [el('div', 'sp-title', '設定')];
    const row = (label: string, control: HTMLElement, hint?: string) => {
      const r = el('label', 'sp-row');
      r.append(el('span', 'sp-label', label), control);
      if (hint) r.append(el('span', 'sp-hint', hint));
      rows.push(r);
    };
    if (o.graphics) {
      const sel = el('select') as HTMLSelectElement;
      const labels: Record<Quality, string> = {
        auto: `自動（${isPhone() ? 'スマホ: 軽量' : 'PC: 高画質'}）`, high: '高画質', medium: '標準', low: '軽量（影なし・観客少なめ）',
      };
      for (const q of ['auto', 'high', 'medium', 'low'] as Quality[]) sel.append(new Option(labels[q], q, false, q === p.quality));
      sel.addEventListener('change', () => {
        setPrefs({ quality: sel.value as Quality });
        // the scene is built for one quality level: reload (session and entry survive)
        location.reload();
      });
      row('画質', sel);
      rows.push(this.res);
    }
    if (o.sound) {
      const slider = (key: keyof Pick<Prefs, 'master' | 'music' | 'sfx' | 'crowd'>, label: string) => {
        const s = el('input') as HTMLInputElement;
        s.type = 'range';
        s.min = '0';
        s.max = '1';
        s.step = '0.05';
        s.value = String(p[key]);
        s.setAttribute('aria-label', label);
        s.addEventListener('input', () => setPrefs({ [key]: Number(s.value) }));
        row(label, s);
      };
      slider('master', '全体の音量');
      slider('music', 'ファンファーレ');
      slider('sfx', '効果音');
      slider('crowd', '歓声');
    }
    if (o.haptics) {
      const c = el('input') as HTMLInputElement;
      c.type = 'checkbox';
      c.checked = p.haptics;
      c.addEventListener('change', () => setPrefs({ haptics: c.checked }));
      row('振動', c, 'iPhoneでは利用できません');
    }
    const motion = el('select') as HTMLSelectElement;
    motion.append(new Option('OSの設定に合わせる', 'os', false, p.reducedMotion === null), new Option('減らす', 'on', false, p.reducedMotion === true), new Option('減らさない', 'off', false, p.reducedMotion === false));
    motion.addEventListener('change', () => setPrefs({ reducedMotion: motion.value === 'os' ? null : motion.value === 'on' }));
    row('動き・点滅を減らす', motion, 'カメラの揺れ、フラッシュ、紙吹雪を控えめにします');
    const big = el('input') as HTMLInputElement;
    big.type = 'checkbox';
    big.checked = p.largeText;
    big.addEventListener('change', () => setPrefs({ largeText: big.checked }));
    row('文字を大きく', big);
    const close = el('button', 'restart secondary', '閉じる');
    close.addEventListener('click', () => this.toggle(false));
    rows.push(close);
    this.panel.append(...rows);
  }
}

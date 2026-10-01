import type { HorseInput } from '../sim/input';
import { el } from '../ui/format';

/** Keep receiving a finger's events even when it slides off the control. */
function capture(target: HTMLElement, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    /* pointer already gone */
  }
}

/**
 * Multi-touch controls for the phone: a steering pad (drag left/right),
 * hold buttons for accelerator, brake and 踏ん張る, and a pit button.
 */
export class TouchController {
  readonly root = el('div', 'tc');
  private steer = 0;
  private throttle = false;
  private brake = false;
  private brace = false;
  private pit = false;
  private readonly knob = el('div', 'tc-knob');
  enabled = true;

  constructor() {
    const pad = el('div', 'tc-pad');
    pad.append(el('span', 'tc-pad-l', '◀ 内'), this.knob, el('span', 'tc-pad-r', '外 ▶'));
    this.bindPad(pad);

    const brake = this.holdButton('tc-btn tc-brake', 'ブレーキ', (on) => (this.brake = on));
    const brace = this.holdButton('tc-btn tc-brace', '踏ん張る', (on) => (this.brace = on));
    const gas = this.holdButton('tc-btn tc-gas', '全開', (on) => (this.throttle = on));
    const pit = this.holdButton('tc-btn tc-pit', 'ピット', (on) => {
      if (on) this.pit = true;
    });
    const row = el('div', 'tc-row');
    row.append(brake, brace, gas);
    this.root.append(pit, pad, row);
  }

  private bindPad(pad: HTMLElement): void {
    let active: number | null = null;
    const update = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      const v = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.steer = Math.max(-1, Math.min(1, v * 1.3));
      this.knob.style.transform = `translateX(${this.steer * (r.width / 2 - 30)}px)`;
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      active = e.pointerId;
      capture(pad, e.pointerId);
      pad.classList.add('on');
      update(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === active) update(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = null;
      this.steer = 0;
      this.knob.style.transform = '';
      pad.classList.remove('on');
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  }

  private holdButton(cls: string, label: string, set: (on: boolean) => void): HTMLElement {
    const b = el('button', cls, label);
    const on = (e: PointerEvent) => {
      e.preventDefault();
      capture(b, e.pointerId);
      b.classList.add('on');
      set(true);
    };
    const off = () => {
      b.classList.remove('on');
      set(false);
    };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  read(): HorseInput {
    if (!this.enabled) return { throttle: null, brake: 0, steer: 0, brace: false };
    const pit = this.pit;
    this.pit = false;
    return { throttle: this.throttle ? 1 : null, brake: this.brake ? 1 : 0, steer: this.steer, brace: this.brace, pit };
  }
}

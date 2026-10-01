import type { HorseInput } from '../sim/input';

/**
 * Keyboard controls for the local player.
 *   ↑ / W : full throttle (no key = cruise)
 *   ↓ / S : brake
 *   ← / A : move toward the inner rail, → / D : move outward
 *   Space : 踏ん張る
 *   P     : pit stop for repairs (press again to cancel)
 */
export class KeyboardInput {
  private readonly down = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return; // typing in a form field
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      this.down.add(e.key.toLowerCase());
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.key.toLowerCase()));
    target.addEventListener('blur', () => this.down.clear());
  }

  private any(...keys: string[]): boolean {
    return keys.some((k) => this.down.has(k));
  }

  read(): HorseInput {
    const left = this.any('arrowleft', 'a');
    const right = this.any('arrowright', 'd');
    return {
      throttle: this.any('arrowup', 'w') ? 1 : null,
      brake: this.any('arrowdown', 's') ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      brace: this.any(' '),
      pit: this.any('p'),
    };
  }
}

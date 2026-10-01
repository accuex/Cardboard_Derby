/** Full-screen 2D particle layer for broadcast effects (confetti, gold sparkles, flashes). */
interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  spin: number;
  angle: number;
  kind: 'confetti' | 'spark';
}

const CONFETTI = ['#ffd84a', '#ff5a5a', '#5ab4ff', '#5ad07a', '#ff8ad8', '#ffffff', '#ffa83a'];

export class Particles {
  readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private list: P[] = [];
  private flashAlpha = 0;
  private running = false;
  private last = 0;

  constructor() {
    this.canvas.className = 'fx-layer';
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      this.canvas.width = window.innerWidth * dpr;
      this.canvas.height = window.innerHeight * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    this.dispose = () => {
      window.removeEventListener('resize', resize);
      this.running = false;
      this.list = [];
      this.flashAlpha = 0;
      this.canvas.remove();
    };
  }

  /** Stop and detach (set in the constructor, where the resize handler lives). */
  readonly dispose: () => void;

  /** Confetti raining from the top (and bursting from the sides). */
  confetti(count = 160): void {
    const w = window.innerWidth;
    for (let i = 0; i < count; i++) {
      const fromSide = i % 3 === 0;
      const left = i % 2 === 0;
      this.list.push({
        x: fromSide ? (left ? 0 : w) : Math.random() * w,
        y: fromSide ? window.innerHeight * 0.7 : -20 - Math.random() * 200,
        vx: fromSide ? (left ? 1 : -1) * (250 + Math.random() * 350) : (Math.random() - 0.5) * 60,
        vy: fromSide ? -500 - Math.random() * 400 : 60 + Math.random() * 120,
        life: 0,
        max: 4 + Math.random() * 2,
        size: 6 + Math.random() * 6,
        color: CONFETTI[i % CONFETTI.length],
        spin: (Math.random() - 0.5) * 12,
        angle: Math.random() * 6,
        kind: 'confetti',
      });
    }
    this.start();
  }

  /** Gold glints drifting up, density by grade. */
  sparkles(count = 60, area?: { x: number; y: number; w: number; h: number }): void {
    const a = area ?? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    for (let i = 0; i < count; i++) {
      this.list.push({
        x: a.x + Math.random() * a.w,
        y: a.y + Math.random() * a.h,
        vx: (Math.random() - 0.5) * 20,
        vy: -20 - Math.random() * 40,
        life: -Math.random() * 2,
        max: 1.2 + Math.random() * 1.2,
        size: 2 + Math.random() * 3,
        color: Math.random() < 0.3 ? '#ffffff' : '#ffe08a',
        spin: 0,
        angle: 0,
        kind: 'spark',
      });
    }
    this.start();
  }

  flash(strength = 0.85): void {
    this.flashAlpha = Math.max(this.flashAlpha, strength);
    this.start();
  }

  clear(): void {
    this.list = [];
    this.flashAlpha = 0;
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    this.list = this.list.filter((p) => {
      p.life += dt;
      if (p.life < 0) return true;
      if (p.kind === 'confetti') {
        p.vy += 380 * dt;
        p.vy = Math.min(p.vy, 160);
        p.vx *= 1 - 1.2 * dt;
        p.vx += Math.sin(p.life * 3 + p.angle) * 30 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      const fade = Math.min(1, (p.max - p.life) / 0.6);
      if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = Math.max(0, fade);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.angle * 2)) + 1);
        ctx.restore();
      } else {
        const tw = Math.sin((p.life / p.max) * Math.PI);
        ctx.globalAlpha = Math.max(0, tw);
        ctx.fillStyle = p.color;
        ctx.shadowColor = '#ffd84a';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + tw), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      return p.life < p.max && p.y < h + 40;
    });
    if (this.flashAlpha > 0) {
      ctx.globalAlpha = this.flashAlpha;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      this.flashAlpha = Math.max(0, this.flashAlpha - dt * 2.2);
    }
    ctx.globalAlpha = 1;
    if (this.list.length || this.flashAlpha > 0) requestAnimationFrame((t) => this.frame(t));
    else {
      ctx.clearRect(0, 0, w, h);
      this.running = false;
    }
  }
}

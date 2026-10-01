import * as THREE from 'three';
import { Rng } from '../core/rng';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, rng: Rng, colors: string[], size = 2): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng.next() * colors.length)];
    ctx.fillRect(rng.next() * w, rng.next() * h, size * rng.range(0.5, 1.5), size * rng.range(0.5, 1.5));
  }
}

/** Corrugated cardboard with darker cut edges so every box face reads as a cardboard panel. */
export function cardboardTexture(seed = 1, tint = '#c49a63'): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const rng = new Rng(seed);
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 1400, rng, ['rgba(120,80,40,0.10)', 'rgba(255,230,190,0.10)', 'rgba(90,60,30,0.08)'], 3);
  // corrugation flutes
  for (let x = 0; x < 256; x += 7) {
    ctx.fillStyle = 'rgba(100,65,30,0.10)';
    ctx.fillRect(x, 0, 2, 256);
  }
  // a printed logo-ish stamp and a crease
  ctx.strokeStyle = 'rgba(90,55,25,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 128 + rng.range(-40, 40));
  ctx.lineTo(256, 128 + rng.range(-40, 40));
  ctx.stroke();
  if (rng.chance(0.5)) {
    ctx.fillStyle = 'rgba(70,40,20,0.25)';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(rng.chance(0.5) ? 'FRAGILE' : 'THIS SIDE UP', 20 + rng.range(0, 60), 60 + rng.range(0, 140));
  }
  // dark cut edges
  ctx.strokeStyle = 'rgba(80,50,20,0.55)';
  ctx.lineWidth = 10;
  ctx.strokeRect(0, 0, 256, 256);
  return toTexture(c);
}

export function tapeTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 64);
  const rng = new Rng(7);
  ctx.fillStyle = '#a8a9a6';
  ctx.fillRect(0, 0, 128, 64);
  for (let y = 0; y < 64; y += 3) {
    ctx.fillStyle = `rgba(255,255,255,${rng.range(0.03, 0.12)})`;
    ctx.fillRect(0, y, 128, 1);
  }
  speckle(ctx, 128, 64, 120, rng, ['rgba(60,60,60,0.15)'], 2);
  return toTexture(c);
}

/** Mown turf: alternating bands across the track. */
export function turfTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 512);
  const rng = new Rng(3);
  ctx.fillStyle = '#4f9a3a';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#5eae45';
  ctx.fillRect(0, 256, 256, 256);
  speckle(ctx, 256, 512, 5000, rng, ['rgba(30,80,20,0.25)', 'rgba(150,210,110,0.18)', 'rgba(60,110,40,0.3)'], 2);
  const t = toTexture(c, true);
  return t;
}

export function grassTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const rng = new Rng(11);
  ctx.fillStyle = '#4a8a36';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 4000, rng, ['rgba(30,70,20,0.3)', 'rgba(120,180,80,0.2)', 'rgba(80,120,40,0.25)'], 3);
  return toTexture(c, true);
}

export function dirtTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const rng = new Rng(5);
  ctx.fillStyle = '#9c7a55';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 4000, rng, ['rgba(70,50,30,0.3)', 'rgba(200,170,130,0.25)'], 2);
  return toTexture(c, true);
}

export function concreteTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  const rng = new Rng(9);
  ctx.fillStyle = '#b9b6ae';
  ctx.fillRect(0, 0, 128, 128);
  speckle(ctx, 128, 128, 800, rng, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.1)'], 2);
  return toTexture(c, true);
}

/** Saddle cloth with the horse number. */
export function numberClothTexture(num: number, bg: string, fg: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 192);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 192);
  ctx.strokeStyle = fg;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 240, 176);
  ctx.globalAlpha = 1;
  ctx.fillStyle = fg;
  ctx.font = '900 150px "Noto Sans JP", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), 128, 104);
  return toTexture(c);
}

/** Magic-marker eye, drawn on like a school craft project. */
export function eyeTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(64, 64, 46, 38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#111';
  ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(74, 66, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(80, 59, 5, 0, Math.PI * 2);
  ctx.fill();
  // eyelashes
  ctx.lineWidth = 5;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(40 + i * 22, 30);
    ctx.lineTo(34 + i * 24, 12);
    ctx.stroke();
  }
  return toTexture(c);
}

export function labelTexture(text: string, opts: { bg: string; fg: string; w?: number; h?: number; font?: string; border?: string; round?: boolean }): THREE.CanvasTexture {
  const w = opts.w ?? 256;
  const h = opts.h ?? 256;
  const [c, ctx] = canvas(w, h);
  if (opts.round) {
    ctx.fillStyle = opts.bg;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 6, 0, Math.PI * 2);
    ctx.fill();
    if (opts.border) {
      ctx.lineWidth = 10;
      ctx.strokeStyle = opts.border;
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, w, h);
    if (opts.border) {
      ctx.lineWidth = 12;
      ctx.strokeStyle = opts.border;
      ctx.strokeRect(6, 6, w - 12, h - 12);
    }
  }
  ctx.fillStyle = opts.fg;
  ctx.font = opts.font ?? `900 ${Math.floor(h * 0.6)}px "Noto Sans JP", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + h * 0.04);
  return toTexture(c);
}

export function windowsTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 128);
  ctx.fillStyle = '#d8dde2';
  ctx.fillRect(0, 0, 256, 128);
  for (let x = 4; x < 256; x += 32) {
    for (let y = 8; y < 128; y += 40) {
      const g = ctx.createLinearGradient(x, y, x + 28, y + 30);
      g.addColorStop(0, '#5c7ea3');
      g.addColorStop(1, '#22384f');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, 26, 28);
    }
  }
  return toTexture(c, true);
}

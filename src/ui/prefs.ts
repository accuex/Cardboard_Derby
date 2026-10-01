/**
 * Per-viewer preferences (画質・音量・振動・アクセシビリティ). Kept in this browser only;
 * every read/write is guarded so private mode etc. still works with defaults.
 */
export type Quality = 'auto' | 'high' | 'medium' | 'low';

export interface Prefs {
  quality: Quality;
  /** 0..1 */
  master: number;
  sfx: number;
  crowd: number;
  music: number;
  haptics: boolean;
  /** null = follow the OS "reduce motion" setting. */
  reducedMotion: boolean | null;
  largeText: boolean;
}

const KEY = 'cardboard-derby-prefs';
const DEFAULTS: Prefs = { quality: 'auto', master: 0.8, sfx: 0.8, crowd: 0.7, music: 0.8, haptics: true, reducedMotion: null, largeText: false };

let current: Prefs = load();
const listeners = new Set<(p: Prefs) => void>();

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

export function prefs(): Prefs {
  return current;
}

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l(current);
  applyDocumentPrefs();
}

export function onPrefs(fn: (p: Prefs) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Effective reduced-motion (user choice, else the OS setting). */
export function reducedMotion(): boolean {
  if (current.reducedMotion !== null) return current.reducedMotion;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export const isPhone = (): boolean => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600;

/** CSS hooks on <html>: large text and reduced motion. */
export function applyDocumentPrefs(): void {
  const root = document.documentElement;
  root.classList.toggle('large-text', current.largeText);
  root.classList.toggle('reduce-motion', reducedMotion());
}

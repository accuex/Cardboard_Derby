import { prefs } from './prefs';

/** Phone vibration (Android Chrome etc.; iOS Safari has no vibration API, so this is a no-op there). */
export function buzz(pattern: number | number[]): void {
  if (!prefs().haptics) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not allowed */
  }
}

export const HAPTIC = {
  gate: 120,
  brace: 25,
  legLift: [30, 40, 30],
  collision: 70,
  fall: [250, 80, 250],
  partLost: [80, 40, 80],
  finish: [60, 60, 200],
} as const;

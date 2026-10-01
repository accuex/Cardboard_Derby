import type { Course } from '../sim/Course';

/** Where the stands, the big screen and the opening orbit go, derived from the course size. */
export function venueLayout(course: Course) {
  const { straightLength: L, cornerRadius: R, trackWidth: W } = course.config;
  const finishX = -L / 2 + course.finishS;
  const standTo = Math.min(L / 2 - 10, finishX + 70);
  const standFrom = Math.max(-L / 2 + 20, standTo - 390);
  return {
    finishX,
    standFrom,
    standTo,
    /** z of the outer rail along the home straight. */
    railZ: R + W,
    screenX: Math.max(-L / 2 + 30, Math.min(L / 2 - 30, finishX - 110)),
    screenZ: Math.max(15, R - 55),
    orbitCenter: [finishX - 60, 0, R - 10] as [number, number, number],
    orbitRadius: L / 2 + R + 80,
  };
}

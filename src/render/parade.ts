import type { Course } from '../sim/Course';

/** Where horse `i` stands during the pre-race parade (in front of the gate, single file). */
export function paradeCourseS(startS: number, i: number, n: number, walk = 0): number {
  return startS + 10 + (n - i) * 5.5 + walk;
}

/** Metres walked after `t` seconds of the parade. */
export const paradeWalk = (t: number) => t * 0.7;

export const PARADE_LATERAL = 7;

export function paradePose(course: Course, startS: number, i: number, n: number, walk = 0) {
  return course.sample(paradeCourseS(startS, i, n, walk), PARADE_LATERAL);
}

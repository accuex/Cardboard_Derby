import type { CourseConfig } from '../config/course';

export type SegmentKind = 'straight' | 'corner';

export interface CourseSegment {
  index: number;
  kind: SegmentKind;
  start: number;
  length: number;
  label: string;
}

export interface CourseSample {
  x: number;
  z: number;
  /** Unit direction of travel. */
  dirX: number;
  dirZ: number;
  /** Unit vector pointing away from the infield (direction of increasing lateral). */
  normalX: number;
  normalZ: number;
}

/**
 * Pure course geometry (no rendering dependencies).
 * World axes: x/z ground plane, y up. The home straight runs along +x on the +z side,
 * the course turns left (counter-clockwise seen from above).
 */
export class Course {
  readonly config: CourseConfig;
  readonly lapLength: number;
  readonly segments: CourseSegment[];

  constructor(config: CourseConfig) {
    this.config = config;
    const L = config.straightLength;
    const C = Math.PI * config.cornerRadius;
    this.segments = [
      { index: 0, kind: 'straight', start: 0, length: L, label: 'ホームストレッチ' },
      { index: 1, kind: 'corner', start: L, length: C, label: '1〜2コーナー' },
      { index: 2, kind: 'straight', start: L + C, length: L, label: 'バックストレッチ' },
      { index: 3, kind: 'corner', start: 2 * L + C, length: C, label: '3〜4コーナー' },
    ];
    this.lapLength = 2 * L + 2 * C;
  }

  get finishS(): number {
    return this.config.finishS;
  }

  wrap(s: number): number {
    const m = s % this.lapLength;
    return m < 0 ? m + this.lapLength : m;
  }

  segmentAt(s: number): CourseSegment {
    const w = this.wrap(s);
    for (const seg of this.segments) {
      if (w < seg.start + seg.length) return seg;
    }
    return this.segments[this.segments.length - 1];
  }

  /** Fraction (0..1) through the segment containing `s`. */
  segmentFraction(s: number): number {
    const seg = this.segmentAt(s);
    return (this.wrap(s) - seg.start) / seg.length;
  }

  /** Course coordinate at a given segment and fraction, handy for configuring fixed objects. */
  sAt(segmentIndex: number, fraction: number): number {
    const seg = this.segments[segmentIndex];
    return seg.start + seg.length * fraction;
  }

  sample(s: number, lateral: number, out: CourseSample = { x: 0, z: 0, dirX: 1, dirZ: 0, normalX: 0, normalZ: 1 }): CourseSample {
    const L = this.config.straightLength;
    const R = this.config.cornerRadius;
    const seg = this.segmentAt(s);
    const local = this.wrap(s) - seg.start;
    let ix: number, iz: number;
    switch (seg.index) {
      case 0:
        ix = -L / 2 + local; iz = R;
        out.dirX = 1; out.dirZ = 0; out.normalX = 0; out.normalZ = 1;
        break;
      case 1: {
        const th = Math.PI / 2 - local / R;
        ix = L / 2 + R * Math.cos(th); iz = R * Math.sin(th);
        out.dirX = Math.sin(th); out.dirZ = -Math.cos(th);
        out.normalX = Math.cos(th); out.normalZ = Math.sin(th);
        break;
      }
      case 2:
        ix = L / 2 - local; iz = -R;
        out.dirX = -1; out.dirZ = 0; out.normalX = 0; out.normalZ = -1;
        break;
      default: {
        const th = -Math.PI / 2 - local / R;
        ix = -L / 2 + R * Math.cos(th); iz = R * Math.sin(th);
        out.dirX = Math.sin(th); out.dirZ = -Math.cos(th);
        out.normalX = Math.cos(th); out.normalZ = Math.sin(th);
      }
    }
    out.x = ix + out.normalX * lateral;
    out.z = iz + out.normalZ * lateral;
    return out;
  }

  /** Inner-rail distance gained per metre actually run at the given lateral offset. */
  progressRate(s: number, lateral: number): number {
    const seg = this.segmentAt(s);
    if (seg.kind === 'straight') return 1;
    const R = this.config.cornerRadius;
    return R / (R + lateral);
  }

  /** Distance along the course from `s` forward to the finish line (within one lap). */
  distanceToFinish(s: number): number {
    return this.wrap(this.finishS - s);
  }
}

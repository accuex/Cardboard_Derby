import type { CourseConfig } from './course';
import { Course } from '../sim/Course';

export interface CoursePreset {
  id: string;
  label: string;
  config: CourseConfig;
}

const base = { surface: '芝', markerInterval: 100, railHeight: 1.0, railPostSpacing: 3 };

/** Selectable venues (Admin → コース選択). */
export const coursePresets: CoursePreset[] = [
  {
    id: 'danbori',
    label: '東京・ダンボリ競馬場（標準）',
    config: { ...base, venueName: '東京・ダンボリ競馬場', straightLength: 500, cornerRadius: 130, trackWidth: 28, finishS: 420 },
  },
  {
    id: 'tight',
    label: '小回り・ガムテープ競馬場（急コーナー）',
    config: { ...base, venueName: 'ガムテープ競馬場', straightLength: 360, cornerRadius: 85, trackWidth: 24, finishS: 300 },
  },
  {
    id: 'grand',
    label: '大回り・段ボール記念競馬場（長い直線）',
    config: { ...base, venueName: '段ボール記念競馬場', straightLength: 680, cornerRadius: 160, trackWidth: 32, finishS: 560 },
  },
];

/** Race distances whose start lies well inside a straight (so the gate isn't on a bend). */
export function validDistances(config: CourseConfig): number[] {
  const course = new Course(config);
  const out: number[] = [];
  for (let d = 1000; d <= 3600; d += 200) {
    const s = course.wrap(course.finishS - d);
    const seg = course.segmentAt(s);
    const local = s - seg.start;
    if (seg.kind === 'straight' && local > 40 && seg.length - local > 60) out.push(d);
  }
  return out;
}

/**
 * Course geometry settings. All lengths are metres.
 * The course is a left-handed (counter-clockwise) oval: home straight -> corner 1-2
 * -> back straight -> corner 3-4. Distance `s` is measured along the inner rail
 * from the start of the home straight.
 */
export interface CourseConfig {
  venueName: string;
  surface: string;
  straightLength: number;
  cornerRadius: number;
  trackWidth: number;
  /** Position of the finish line, measured from the start of the home straight. */
  finishS: number;
  /** Interval between distance-to-go marker posts. */
  markerInterval: number;
  railHeight: number;
  railPostSpacing: number;
}

export const courseConfig: CourseConfig = {
  venueName: '東京・ダンボリ競馬場',
  surface: '芝',
  straightLength: 500,
  cornerRadius: 130,
  trackWidth: 28,
  finishS: 420,
  markerInterval: 100,
  railHeight: 1.0,
  railPostSpacing: 3,
};

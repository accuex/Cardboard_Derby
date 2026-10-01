/**
 * Broadcast camera shots and the rules that pick them.
 * Positions are given in course coordinates (segment + fraction, lateral, height)
 * so they follow the course if its dimensions change.
 */
export type ShotType = 'orbit' | 'gate' | 'follow' | 'fixed' | 'headOn';

export interface CoursePoint {
  segment: number;
  fraction: number;
  lateral: number;
  height: number;
}

export interface ShotDef {
  label: string;
  type: ShotType;
  /** follow/headOn: offset along the course from the focus (+ ahead). */
  along?: number;
  /** follow/headOn: absolute lateral of the camera car. */
  lateral?: number;
  height?: number;
  /** fixed: camera position. */
  at?: CoursePoint;
  /** Fixed vertical FOV in degrees; omitted = auto telephoto framing. */
  fov?: number;
  /** Auto framing: how much of the field to keep in frame. */
  frameScale?: number;
  minFov?: number;
  maxFov?: number;
  /** Follow the winner instead of the leading group. */
  focusWinner?: boolean;
  /** Position smoothing rate (higher = stiffer). */
  stiffness?: number;
}

export interface ShotRule {
  shot: string;
  phase: 'intro' | 'gate' | 'running' | 'finish';
  segment?: number;
  fractionMin?: number;
  fractionMax?: number;
  remainingMin?: number;
  remainingMax?: number;
  timeMax?: number;
  /** Only on the final approach (the leader's next finish-line crossing ends the race). */
  finalLap?: boolean;
  /** Cut immediately even if the current shot has not been held long enough. */
  force?: boolean;
}

export interface CameraConfig {
  minShotSeconds: number;
  /** Opening orbit; centre and radius come from the venue layout. */
  orbit: { height: number; speed: number; startAngle: number };
  shots: Record<string, ShotDef>;
  rules: ShotRule[];
}

export const cameraConfig: CameraConfig = {
  minShotSeconds: 3,
  orbit: { height: 90, speed: 0.06, startAngle: -1.2 },
  shots: {
    intro: { label: 'オープニング', type: 'orbit', fov: 45 },
    gate: { label: 'スタート地点', type: 'gate', fov: 38 },
    start: { label: 'スタート', type: 'follow', along: 26, lateral: 30, height: 9, fov: 30, stiffness: 2.5 },
    backStretch: { label: '向正面', type: 'follow', along: 6, lateral: -38, height: 7, frameScale: 1.3, minFov: 10, maxFov: 32, stiffness: 3 },
    corner1: { label: '第1コーナー', type: 'fixed', at: { segment: 1, fraction: 0.35, lateral: -45, height: 14 }, frameScale: 1.1, minFov: 6, maxFov: 40 },
    corner3: { label: '第3コーナー', type: 'fixed', at: { segment: 3, fraction: 0.3, lateral: -45, height: 14 }, frameScale: 1.1, minFov: 6, maxFov: 40 },
    corner4: { label: '第4コーナー', type: 'fixed', at: { segment: 0, fraction: 0.1, lateral: 48, height: 11 }, frameScale: 0.95, minFov: 6, maxFov: 40 },
    headOn: { label: '最終直線 正面', type: 'headOn', along: 45, lateral: 7, height: 2.8, fov: 16, stiffness: 4 },
    homeFirst: { label: 'スタンド前', type: 'follow', along: 2, lateral: 52, height: 14, frameScale: 1.3, minFov: 10, maxFov: 40, stiffness: 3 },
    homeStretch: { label: '最終直線', type: 'follow', along: 3, lateral: 52, height: 13, frameScale: 1.2, minFov: 9, maxFov: 40, stiffness: 3 },
    goal: { label: 'ゴール前', type: 'fixed', at: { segment: 0, fraction: 0.84, lateral: 36, height: 9 }, frameScale: 1.25, minFov: 8, maxFov: 34 },
    winner: { label: 'ウイナー', type: 'follow', along: 5, lateral: 38, height: 6, frameScale: 0.6, minFov: 6, maxFov: 20, focusWinner: true, stiffness: 2 },
  },
  rules: [
    { phase: 'intro', shot: 'intro' },
    { phase: 'gate', shot: 'gate' },
    { phase: 'finish', shot: 'winner', force: true },
    { phase: 'running', shot: 'start', timeMax: 5 },
    { phase: 'running', shot: 'goal', remainingMax: 70, force: true },
    { phase: 'running', shot: 'headOn', segment: 0, finalLap: true, remainingMin: 290 },
    { phase: 'running', shot: 'homeStretch', segment: 0, finalLap: true },
    { phase: 'running', shot: 'homeFirst', segment: 0 },
    { phase: 'running', shot: 'corner4', segment: 3, fractionMin: 0.6 },
    { phase: 'running', shot: 'corner3', segment: 3 },
    { phase: 'running', shot: 'corner1', segment: 1 },
    { phase: 'running', shot: 'backStretch' },
  ],
};

export interface RaceConfig {
  /** 第N回 (0 = an ordinary race without an edition). */
  edition: number;
  /** Race number of the day (TV mode: 11R). */
  raceNo?: number;
  name: string;
  grade: 'G1' | 'G2' | 'G3' | 'OP' | '';
  distance: number;
  weather: string;
  tagline: string;
  /** Lateral position (from inner rail) of gate 1 and spacing between stalls. */
  gateFirstLateral: number;
  gateSpacing: number;
  timing: {
    introSeconds: number;
    /** 出走馬紹介: seconds per horse. */
    paddockSecondsPerHorse: number;
    gateSeconds: number;
    /** After the winner crosses the line, the race ends when everyone finishes or after this many seconds. */
    finishTimeoutSeconds: number;
    resultsDelaySeconds: number;
  };
  simulation: {
    tickRate: number;
    timeScale: number;
  };
  replay: {
    /** Seconds before / after the winner crosses the line. */
    goalBefore: number;
    goalAfter: number;
    goalSpeed: number;
    crashBefore: number;
    crashAfter: number;
    crashSpeed: number;
    maxCrashes: number;
    /** Recording rate (frames per second of race time). */
    recordRate: number;
  };
  /** Gate number the local player rides (null = everyone is CPU). */
  playerGate: number | null;
}

export const raceConfig: RaceConfig = {
  edition: 1,
  name: 'ダンボリ記念',
  grade: 'G3',
  distance: 2000,
  weather: '晴れ',
  tagline: '走る。壊れる。それでも、前へ。',
  gateFirstLateral: 1.6,
  gateSpacing: 1.7,
  timing: {
    introSeconds: 7,
    paddockSecondsPerHorse: 2.8,
    gateSeconds: 3.5,
    finishTimeoutSeconds: 15,
    resultsDelaySeconds: 3.5,
  },
  simulation: {
    tickRate: 60,
    timeScale: 1,
  },
  replay: {
    goalBefore: 7,
    goalAfter: 1.5,
    goalSpeed: 0.45,
    crashBefore: 1.2,
    crashAfter: 2.8,
    crashSpeed: 0.5,
    maxCrashes: 2,
    recordRate: 30,
  },
  playerGate: 1,
};

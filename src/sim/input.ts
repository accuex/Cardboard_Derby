/** Controls for one horse. Produced by CPU riders and by players (keyboard now, smartphone later). */
export interface HorseInput {
  /** 0..1, or null to use the default cruise throttle. */
  throttle: number | null;
  /** 0..1 */
  brake: number;
  /** -1 (toward the inner rail) .. +1 (outward). */
  steer: number;
  /** 踏ん張る */
  brace: boolean;
  /** Toggle a pit stop request (edge-triggered). */
  pit?: boolean;
}

export const neutralInput = (): HorseInput => ({ throttle: null, brake: 0, steer: 0, brace: false });

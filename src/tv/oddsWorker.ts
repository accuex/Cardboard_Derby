/// <reference lib="webworker" />
import { runOdds, type OddsJob } from './odds';

/** Runs trial races off the main thread so the broadcast keeps its frame rate. */
self.onmessage = (e: MessageEvent<OddsJob>) => {
  runOdds(e.data, (p) => self.postMessage(p));
};

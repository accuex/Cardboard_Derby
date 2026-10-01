/**
 * Balance check for CPU strength: a scripted "decent player" (slows for corners, braces in danger,
 * spurts late) rides gate 3 against the CPUs at each level. Prints the player's win rate / average place.
 *   npx tsx scripts/difficulty.ts [races=40]
 */
import { courseConfig } from '../src/config/course';
import { cpuLevels, horseRoster, pacingConfig, type CpuLevel } from '../src/config/horses';
import { raceConfig } from '../src/config/race';
import { Course } from '../src/sim/Course';
import { cornerLimitOf } from '../src/sim/HorsePhysics';
import { RaceSimulation } from '../src/sim/RaceSimulation';

const N = Number(process.argv[2] ?? 40);
const course = new Course(courseConfig);
const me = 2;
for (const level of Object.keys(cpuLevels) as CpuLevel[]) {
  pacingConfig.level = level;
  let wins = 0, places = 0, falls = 0;
  for (let seed = 1; seed <= N; seed++) {
    const sim = new RaceSimulation(course, raceConfig, horseRoster, seed * 7, [me]);
    sim.start();
    while (sim.state.phase === 'running' && sim.state.time < 400) {
      const h = sim.state.horses[me];
      const perf = sim.performance[me];
      const seg = course.segmentAt(h.courseS);
      const rem = sim.state.distance - h.progress;
      // look ahead: what speed is safe in the coming corner?
      const limit = Math.sqrt(cornerLimitOf(h, perf, false) * (course.config.cornerRadius + h.lateral)) * 0.97;
      const toCorner = seg.kind === 'straight' ? seg.start + seg.length - course.wrap(h.courseS) : 0;
      const tooFast = h.speed > Math.sqrt(limit * limit + 2 * 2.5 * Math.max(0, toCorner - 10));
      sim.setInput(me, {
        throttle: tooFast || h.tipRisk > 0.3 ? 0 : rem < 500 ? 1 : 0.86,
        brake: tooFast && h.speed > limit + 1 ? 0.5 : 0,
        steer: Math.max(-1, Math.min(1, (1.5 - h.lateral) * 0.3)),
        brace: h.tipRisk > 0.45,
      });
      sim.step(1 / 60);
    }
    const place = sim.state.finishOrder.indexOf(me) + 1 || 7;
    places += place;
    if (place === 1) wins++;
    falls += sim.state.horses[me].falls;
  }
  console.log(`${cpuLevels[level].label.padEnd(5, '　')} player win ${(100 * wins / N).toFixed(0).padStart(3)}%  avg place ${(places / N).toFixed(2)}  falls/race ${(falls / N).toFixed(2)}`);
}

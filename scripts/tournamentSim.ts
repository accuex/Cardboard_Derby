/**
 * Runs a whole tournament headlessly with CPU riders: registration → 組分け → 予選 → 準決勝 → 決勝 → 特別賞.
 *   npx tsx scripts/tournamentSim.ts [entrants=35]
 */
import { buildParams } from '../src/config/build';
import { courseConfig } from '../src/config/course';
import { horseRoster, type HorseBody, type HorseProfile } from '../src/config/horses';
import { raceConfig } from '../src/config/race';
import { RaceStatsTracker } from '../src/game/RaceStats';
import { Tournament } from '../src/game/Tournament';
import { Rng } from '../src/core/rng';
import { judgeBuildType } from '../src/sim/buildType';
import { Course } from '../src/sim/Course';
import { RaceSimulation } from '../src/sim/RaceSimulation';

const N = Number(process.argv[2] ?? 35);
const rng = new Rng(7);
const t = new Tournament(undefined, 'テスト杯');
for (let i = 0; i < N; i++) {
  const body = {} as HorseBody;
  for (const p of buildParams) body[p.key] = p.min + rng.next() * (p.max - p.min);
  t.register({ id: `e${i + 1}`, jockey: `騎手${i + 1}`, horseName: `ダンボール${i + 1}号`, silkColor: '#e04848', body, nickname: judgeBuildType(body).name });
}
t.draw(1);
console.log('heats:', t.data.rounds[0].map((r) => r.entrants.length).join('/'));
console.log(t.start());
const course = new Course(courseConfig);
let race;
let seed = 1;
while ((race = t.current)) {
  const roster: HorseProfile[] = horseRoster.map((cpu, i) => {
    const e = t.entrant(race!.entrants[i]);
    return e ? { ...cpu, name: e.horseName, jockey: e.jockey, body: e.body } : cpu;
  });
  const sim = new RaceSimulation(course, raceConfig, roster, seed++);
  const tracker = new RaceStatsTracker();
  sim.start();
  while (sim.state.phase === 'running' && sim.state.time < 400) {
    sim.step(1 / 60);
    tracker.update(sim.state);
  }
  const stats = tracker.result(sim.state);
  const results = sim.state.order.map((id, k) => ({
    entrantId: race!.entrants[id], place: k + 1, time: sim.state.horses[id].finishTime, stats: stats[id],
  })).filter((r) => r.entrantId);
  t.recordResult(race.id, results);
  const done = t.data.rounds.flat().find((r) => r.id === race!.id)!;
  console.log(`${done.label.padEnd(6, '　')} entrants ${done.entrants.length} → 1着 ${t.entrant(done.results[0].entrantId)!.horseName} ${done.results[0].time?.toFixed(1)}s　勝ち上がり ${done.qualifiers.length || '-'}`);
}
console.log('status:', t.data.status, 'rounds:', t.data.rounds.map((r) => `${r[0].label.replace(/\d+組/, '')}×${r.length}`).join(' → '));
for (const a of t.awards()) console.log(`  ${a.title.padEnd(8, '　')} ${a.entrantId ? t.entrant(a.entrantId)!.horseName : '-'}　${a.value}`);
for (const id of ['e1', 'e2']) console.log(id, t.standing(id).state);

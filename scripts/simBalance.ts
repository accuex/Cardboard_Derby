/** Headless balance check: runs many all-CPU races and prints win rates, crashes and wear. */
import { courseConfig } from '../src/config/course';
import { horseRoster } from '../src/config/horses';
import { raceConfig } from '../src/config/race';
import { Course } from '../src/sim/Course';
import { computePerformance } from '../src/sim/performance';
import { RaceSimulation } from '../src/sim/RaceSimulation';

const races = Number(process.argv[2] ?? 200);
const course = new Course(courseConfig);
const n = horseRoster.length;
const acc = horseRoster.map(() => ({ wins: 0, rank: 0, falls: 0, collisions: 0, fatigue: 0, stacks: 0, time: 0, repairs: 0 }));
let totalWin = 0, totalGap = 0, leaderChanges = 0, dnf = 0, totalFalls = 0, racesWithFall = 0, events = { collision: 0, rail: 0, legLift: 0, brace: 0, tapePeel: 0, deform: 0, partLost: 0, repairStart: 0 };
let repairSeconds = 0;
for (let seed = 1; seed <= races; seed++) {
  const sim = new RaceSimulation(course, raceConfig, horseRoster, seed);
  sim.start();
  const dt = 1 / raceConfig.simulation.tickRate;
  let lastLeader = -1;
  let seen = 0;
  while (sim.state.phase === 'running' && sim.state.time < 400) {
    sim.step(dt);
    const leader = sim.state.order[0];
    if (sim.state.time > 3 && leader !== lastLeader) leaderChanges++;
    lastLeader = leader;
    for (const e of sim.state.events) {
      if (e.seq <= seen) continue;
      seen = e.seq;
      if (e.type in events) events[e.type as keyof typeof events]++;
      if (e.type === 'repairStart') repairSeconds += e.value ?? 0;
    }
  }
  const st = sim.state;
  if (st.finishOrder.length < n) dnf++;
  st.finishOrder.forEach((id, r) => (acc[id].rank += r + 1));
  acc[st.finishOrder[0]].wins++;
  let falls = 0;
  for (const h of st.horses) {
    const a = acc[h.id];
    a.falls += h.falls; a.collisions += h.collisions; a.repairs += h.repairs; a.fatigue += h.structuralFatigue; a.time += h.finishTime ?? 0;
    falls += h.falls;
  }
  totalFalls += falls;
  if (falls) racesWithFall++;
  totalWin += st.horses[st.finishOrder[0]].finishTime!;
  totalGap += st.horses[st.finishOrder[1]].finishTime! - st.horses[st.finishOrder[0]].finishTime!;
}
const f = (v: number, d = 2) => (v / races).toFixed(d);
console.log(`races=${races} avgWin=${f(totalWin)}s 1-2gap=${f(totalGap)}s leaderChanges=${f(leaderChanges, 1)} falls/race=${f(totalFalls)} racesWithFall=${(100 * racesWithFall / races).toFixed(0)}% dnf=${dnf}`);
console.log(`events/race: collision ${f(events.collision, 1)} rail ${f(events.rail, 1)} legLift ${f(events.legLift, 1)} brace ${f(events.brace, 1)} | tapePeel ${f(events.tapePeel, 1)} deform ${f(events.deform, 1)} partLost ${f(events.partLost, 2)} repairs ${f(events.repairStart, 2)} avgRepair ${(repairSeconds / Math.max(1, events.repairStart)).toFixed(1)}s`);
horseRoster.forEach((h, i) => {
  const p = computePerformance(h.body);
  const a = acc[i];
  console.log(`${i + 1} ${h.name.padEnd(9, '　')} ${h.style.padEnd(6)} top ${p.topSpeed.toFixed(1)} acc ${p.acceleration.toFixed(2)} lim ${p.cornerLimit.toFixed(2)} | win ${(100 * a.wins / races).toFixed(1).padStart(5)}% rank ${f(a.rank)} time ${f(a.time, 1)} falls ${f(a.falls)} rep ${f(a.repairs)} coll ${f(a.collisions)} wear ${f(a.fatigue)}`);
});

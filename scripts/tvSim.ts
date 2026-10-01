/**
 * TV mode check: runs whole racing days headless (stable → programme → field draw → odds → race)
 * and reports how often favourites win, payouts and race times.  npm run tv:sim [days]
 */
import { courseConfig } from '../src/config/course';
import { coursePresets } from '../src/config/courses';
import { raceConfig } from '../src/config/race';
import { Course } from '../src/sim/Course';
import { RaceSimulation } from '../src/sim/RaceSimulation';
import { payouts, popularity, runOdds, toOdds, tvPacing, winProbabilities } from '../src/tv/odds';
import { PRIZE_SHARE, createDay, drawField } from '../src/tv/Programme';
import { createStable } from '../src/tv/Stable';

const days = Number(process.argv[2]) || 2;
const seed = 12345;
const stable = createStable(seed);
let races = 0, favWins = 0, top3Fav = 0, sumPay = 0, maxPay = 0, falls = 0;
const popWins = new Map<number, number>();
const times: number[] = [];
for (let d = 1; d <= days; d++) {
  const day = createDay(d, seed);
  const venue = coursePresets.find((v) => v.id === day.venueId)!;
  Object.assign(courseConfig, venue.config);
  const course = new Course(courseConfig);
  for (const r of day.races) {
    r.field = drawField(stable, day, r, seed);
    const race = { ...raceConfig, distance: r.distance };
    const field = r.field.map((id) => stable[id].profile);
    let wins: number[] = [];
    runOdds({ id: 0, course: courseConfig, race, field, sims: 40, seed: d * 1000 + r.no, pacing: tvPacing }, (p) => (wins = p.wins));
    const prob = winProbabilities(wins, 40, r.field.map((id) => stable[id].earnings));
    const odds = toOdds(prob);
    const pop = popularity(odds);
    const sim = new RaceSimulation(course, race, field, 777 + d * 100 + r.no);
    sim.start();
    for (let i = 0; i < 60 * 600 && !sim.allFinished; i++) sim.step(1 / 60);
    const st = sim.state;
    const [a, b, c] = st.finishOrder;
    const pay = payouts(prob, odds, a, b, c);
    races++;
    if (pop[a] === 1) favWins++;
    if ([a, b, c].some((i) => i !== undefined && pop[i] === 1)) top3Fav++;
    popWins.set(pop[a], (popWins.get(pop[a]) ?? 0) + 1);
    sumPay += pay.win;
    maxPay = Math.max(maxPay, pay.win);
    falls += st.horses.reduce((s, h) => s + h.falls, 0);
    times.push(st.horses[a].finishTime!);
    st.order.forEach((gi, pos) => {
      const h = stable[r.field![gi]];
      const place = st.horses[gi].finished ? pos + 1 : 0;
      h.starts++;
      if (place === 1) h.wins++;
      if (place >= 1 && place <= 5) h.earnings += Math.round(r.prize * PRIZE_SHARE[place - 1]);
      h.form = [place, ...h.form].slice(0, 5);
      h.lastRaceKey = r.key;
    });
    console.log(`D${d} ${String(r.no).padStart(2)}R ${r.name.padEnd(10, '　')} ${r.distance}m ${field.length}頭 1着 ${pop[a]}番人気 単勝${pay.win}円 fav odds ${Math.min(...odds).toFixed(1)} time ${st.horses[a].finishTime!.toFixed(1)}s`);
  }
}
const top = [...stable].sort((x, y) => y.wins - x.wins).slice(0, 3).map((h) => `${h.profile.name} ${h.starts}戦${h.wins}勝`);
console.log(`races=${races} 1番人気勝率=${((favWins / races) * 100).toFixed(0)}% 1番人気3着内=${((top3Fav / races) * 100).toFixed(0)}% 平均単勝=${Math.round(sumPay / races)}円 最高=${maxPay}円 falls/race=${(falls / races).toFixed(2)} avgTime=${(times.reduce((s, t) => s + t, 0) / times.length).toFixed(0)}s`);
console.log('勝ち馬の人気', [...popWins].sort((x, y) => x[0] - y[0]).map(([p, n]) => `${p}:${n}`).join(' '));
console.log('最多勝', top.join(' / '));

/**
 * Network smoke test: two clients join a running server, one starts the race,
 * intros/replays are skipped, and the race must reach the results.
 *   npx tsx scripts/netSmoke.ts [http://localhost:3000]
 */
import { io } from 'socket.io-client';
import { referenceBody } from '../src/config/build';
const URL = process.argv[2] ?? 'http://localhost:3000';
const a = io(URL, { auth: { role: 'admin' } }); // admin role: allowed to skip the intros
const b = io(URL);
let gotSetup = 0, snaps = 0, bytes = 0, phases = new Set<string>(), myGateA: number | null = null, myGateB: number | null = null;
let lastSeq = 0, gaps = 0; let events = 0; let started = Date.now();
a.on('setup', () => gotSetup++);
a.on('assigned', (m) => { myGateA = m.gate; });
b.on('assigned', (m) => { myGateB = m.gate; });
a.on('snap', (s) => {
  snaps++; bytes += JSON.stringify(s).length; phases.add(s.flow.phase); events += s.events.length;
  if (lastSeq && s.seq !== lastSeq + 1) gaps++; lastSeq = s.seq;
  if (s.flow.phase === 'running' && snaps % 40 === 0) a.emit('input', { throttle: 1, brake: 0, steer: 0, brace: false });
  if (s.flow.phase === 'intro' || s.flow.phase === 'paddock' || s.flow.phase === 'replay') a.emit('skip');
  if (s.flow.phase === 'results') {
    const t = s.race.time;
    console.log('RESULT gateA', myGateA, 'gateB', myGateB, 'setups', gotSetup, 'snaps', snaps, 'avgBytes', Math.round(bytes / snaps), 'gaps', gaps, 'events', events, 'phases', [...phases].join('>'), 'raceTime', t.toFixed(1), 'wall', ((Date.now() - started)/1000).toFixed(0)+'s', 'order', s.race.finishOrder.join(','));
    process.exit(0);
  }
});
a.on('connect', () => { a.emit('join', { name: 'テストA', silkColor: '#ff0000', body: referenceBody }); b.emit('join', { name: 'テストB<script>', silkColor: 'bad', body: { ...referenceBody, legLength: 99 } }); setTimeout(() => a.emit('start'), 500); });
setTimeout(() => { console.log('TIMEOUT phases', [...phases]); process.exit(1); }, 200000);

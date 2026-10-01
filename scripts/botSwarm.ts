/**
 * Bot simulation / load test: N bot "phones" join a running server and ride with a simple
 * telemetry-based AI (brake when tipping, brace when it gets bad). With --tournament they all
 * register and an admin bot runs the whole tournament; otherwise they play free races.
 * Reports server tick cost, snapshot size (raw and compressed) and arrival jitter.
 *
 *   DATA_DIR=/tmp/x SIM_SPEED=8 GAME_PORT=3300 npx tsx server/index.ts &
 *   npx tsx scripts/botSwarm.ts http://localhost:3300 40 --tournament
 */
import { deflateRawSync } from 'node:zlib';
import { io, type Socket } from 'socket.io-client';
import { buildParams } from '../src/config/build';
import type { HorseBody } from '../src/config/horses';
import { decodeHorse, raceStateSkeleton, type AdminCommand, type AdminState, type RaceSetup, type Snapshot } from '../src/net/protocol';
import { createParts } from '../src/sim/damage';

const URL = process.argv[2] ?? 'http://localhost:3000';
const N = Number(process.argv[3] ?? 40);
const TOURNAMENT = process.argv.includes('--tournament');
const MAX_MS = Number(process.env.BOT_MINUTES ?? 8) * 60000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Bot {
  s: Socket;
  publicId: string;
  setup: RaceSetup | null;
  inputs: number;
  lastKey: string;
  lastSent: number;
}

const arrivals: number[] = [];
let rawBytes = 0;
let zipBytes = 0;
let snaps = 0;

function randomBody(): HorseBody {
  const b = {} as HorseBody;
  for (const p of buildParams) b[p.key] = Math.round((p.min + Math.random() * (p.max - p.min)) / p.step) * p.step;
  return b;
}

function makeBot(i: number): Bot {
  const s = io(URL, { forceNew: true, auth: { role: 'player' }, transports: ['websocket'] });
  const bot: Bot = { s, publicId: '', setup: null, inputs: 0, lastKey: '', lastSent: 0 };
  s.on('welcome', (m) => (bot.publicId = m.publicId));
  s.on('setup', (m) => (bot.setup = m));
  s.on('connect', () => s.emit('join', { jockey: `ボット${i + 1}`, name: `ボット${i + 1}号`, silkColor: '#888888', body: randomBody() }));
  s.on('snap', (snap: Snapshot) => {
    if (i === 0) {
      // measure on one client
      const now = performance.now();
      arrivals.push(now);
      const json = JSON.stringify(snap);
      rawBytes += json.length;
      zipBytes += deflateRawSync(json).length;
      snaps++;
    }
    const setup = bot.setup;
    if (!setup || snap.raceId !== setup.raceId || snap.flow.phase !== 'running') return;
    const id = setup.horses.findIndex((h) => h.owner === bot.publicId);
    if (id < 0) return;
    const st = raceStateSkeleton(setup, createParts);
    const h = st.horses[id];
    decodeHorse(snap.horses[id], h);
    // simple rider: full throttle, ease off when the body leans, brace when it gets scary
    const input = {
      throttle: h.tipRisk > 0.35 ? 0 : 1,
      brake: h.tipRisk > 0.5 ? 0.6 : 0,
      steer: Math.max(-1, Math.min(1, (2 - h.lateral) * 0.3)),
      brace: h.tipRisk > 0.55,
      pit: false,
    };
    const key = JSON.stringify(input);
    const now = Date.now();
    if (key !== bot.lastKey || now - bot.lastSent > 100) {
      s.emit('input', input);
      bot.lastKey = key;
      bot.lastSent = now;
      bot.inputs++;
    }
  });
  return bot;
}

async function main(): Promise<void> {
  const admin = io(URL, { forceNew: true, auth: { role: 'admin' } });
  let state = null as AdminState | null;
  let phase = 'build';
  let label: string | null = null;
  admin.on('admin:state', (s) => (state = s));
  admin.on('snap', (s: Snapshot) => {
    phase = s.flow.phase;
    label = s.lobby?.raceLabel ?? label;
  });
  const cmd = (c: AdminCommand) => new Promise<{ ok: boolean; message?: string }>((r) => admin.emit('admin:command', c, r));
  await new Promise((r) => admin.emit('admin:auth', '', r));
  await cmd({ type: 'treset', keepEntrants: false });
  await cmd({ type: 'settings', settings: { mode: TOURNAMENT ? 'tournament' : 'free', autoCountdown: null } });

  const bots: Bot[] = [];
  for (let i = 0; i < N; i++) {
    bots.push(makeBot(i));
    await wait(30);
  }
  await wait(2000);
  console.log(`${N} bots connected`, TOURNAMENT ? `/ entrants ${state!.tournament.entrants.length}` : '');
  if (TOURNAMENT) {
    await cmd({ type: 'tdraw' });
    console.log('tstart:', (await cmd({ type: 'tstart' })).ok, '/', state!.tournament.rounds[0]?.races.length, 'heats');
  }

  const t0 = Date.now();
  let races = 0;
  let maxTick = 0;
  let sumTick = 0;
  let samples = 0;
  const poll = setInterval(async () => {
    try {
      const st = (await (await fetch(`${URL}/api/stats`)).json()) as { tickMsAvg: number; tickMsMax: number };
      maxTick = Math.max(maxTick, st.tickMsMax);
      sumTick += st.tickMsAvg;
      samples++;
    } catch {
      /* ignore */
    }
  }, 1000);
  while (Date.now() - t0 < MAX_MS) {
    if (TOURNAMENT && state?.tournament.status === 'finished') break;
    if (!TOURNAMENT && races >= 2 && phase === 'results') break;
    if (phase === 'build') {
      if ((await cmd({ type: 'start' })).ok) {
        races++;
        console.log(`  race ${races} ${label ?? ''}`);
      }
      await wait(800);
    } else if (phase === 'intro' || phase === 'paddock' || phase === 'replay') {
      await cmd({ type: 'skip' });
      await wait(300);
    } else if (phase === 'results') {
      await cmd({ type: 'toLobby' });
      await wait(500);
    } else await wait(200);
  }
  clearInterval(poll);
  // jitter of snapshot arrivals on one client
  const gaps = arrivals.slice(1).map((t, i) => t - arrivals[i]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
  const inputs = bots.reduce((a, b) => a + b.inputs, 0);
  const secs = (Date.now() - t0) / 1000;
  console.log(`races ${races} in ${secs.toFixed(0)}s${TOURNAMENT ? ` / tournament ${state!.tournament.status}` : ''}`);
  console.log(`server tick: avg ${(sumTick / Math.max(1, samples)).toFixed(3)}ms, worst ${maxTick.toFixed(2)}ms (budget 16.7ms)`);
  console.log(`snapshot: ${(rawBytes / snaps).toFixed(0)} B raw, ~${(zipBytes / snaps).toFixed(0)} B compressed per client → ~${((zipBytes / snaps) * 20 / 1024).toFixed(1)} KB/s per phone`);
  console.log(`arrival interval: ${mean.toFixed(1)}ms ± ${sd.toFixed(1)}ms; inputs sent: ${(inputs / secs / N).toFixed(1)}/s per bot`);
  if (TOURNAMENT) {
    const t = state!.tournament;
    console.log('rounds:', t.rounds.map((r) => `${r.label}×${r.races.length}`).join(' → '));
    for (const a of t.awards.slice(0, 4)) console.log(`  ${a.title}: ${t.entrants.find((e) => e.id === a.entrantId)?.horseName ?? '-'} ${a.value}`);
  }
  await cmd({ type: 'settings', settings: { mode: 'free', autoCountdown: 15 } });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

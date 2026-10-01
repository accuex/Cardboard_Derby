/**
 * Phase 7 network test against a running server:
 * join -> start -> disconnect (CPU stand-in) -> reconnect with the same token (control back)
 * -> page hidden (stand-in) -> visible (control back) -> pit tap is not lost.
 *   npx tsx scripts/netReconnect.ts [http://localhost:3000]
 * Run it against a server at normal speed (no SIM_SPEED): at 10x the race is over before the pit check.
 */
import { io, type Socket } from 'socket.io-client';
import { referenceBody } from '../src/config/build';
import { decodeHorse, raceStateSkeleton, type RaceSetup, type Snapshot } from '../src/net/protocol';
import { createParts } from '../src/sim/damage';

const URL = process.argv[2] ?? 'http://localhost:3000';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let setup: RaceSetup | null = null;
let last: Snapshot | null = null;
let token = '';
let publicId = '';
let mine = '';

function connect(auth: { token: string }): Socket {
  const s = io(URL, { auth: { ...auth, role: 'admin' }, forceNew: true }); // admin role: allowed to skip
  s.on('welcome', (m) => {
    token = m.clientId;
    publicId = m.publicId;
  });
  s.on('setup', (m) => (setup = m));
  s.on('snap', (m) => (last = m));
  s.on('notice', (t) => console.log('  notice:', t));
  return s;
}

function myHorse() {
  if (!setup || !last) return null;
  const st = raceStateSkeleton(setup, createParts);
  const id = setup.horses.findIndex((h) => h.owner === mine);
  if (id < 0) return null;
  decodeHorse(last.horses[id], st.horses[id]);
  return st.horses[id];
}

async function until(cond: () => boolean, ms = 60000, label = ''): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${label}`);
    await wait(50);
  }
}

const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) process.exitCode = 1;
};

async function main(): Promise<void> {
  let a = connect({ token: '' });
  await until(() => !!token && !!setup, 5000, 'welcome');
  const myToken = token;
  mine = publicId; // setup lists owners by public id, never by token
  a.emit('join', { jockey: 'テスト騎手', name: 'テスト号', silkColor: '#ff0000', body: referenceBody });
  await until(() => !!setup?.horses.some((h) => h.owner === mine), 5000, 'joined');
  a.emit('start');
  await until(() => last?.flow.phase === 'intro' || last?.flow.phase === 'paddock' || last?.flow.phase === 'gate', 5000, 'started');
  a.emit('skip');
  await until(() => last?.flow.phase === 'gate', 10000, 'gate');
  await until(() => last?.flow.phase === 'running', 10000, 'running');
  await wait(1500);
  check(myHorse()?.autopilot === false, 'racing under player control');

  a.disconnect();
  const b = connect({ token: '' }); // observer
  await wait(800);
  check(myHorse()?.autopilot === true, 'disconnect -> CPU stand-in');
  b.disconnect();

  token = '';
  a = connect({ token: myToken });
  await until(() => token === myToken, 5000, 'same identity');
  await wait(800);
  check(myHorse()?.autopilot === false, 'reconnect with token -> control back');

  a.emit('presence', false);
  await wait(500);
  check(myHorse()?.autopilot === true, 'page hidden -> CPU stand-in');
  a.emit('presence', true);
  await wait(500);
  check(myHorse()?.autopilot === false, 'page visible -> control back');

  // A single quick pit tap (press + release within one message pair) must still register
  a.emit('input', { throttle: null, brake: 0, steer: 0, brace: false, pit: true });
  a.emit('input', { throttle: null, brake: 0, steer: 0, brace: false, pit: false });
  await wait(400);
  check(myHorse()?.pitRequested === true, 'quick pit tap latched by the server');
  a.emit('input', { throttle: null, brake: 0, steer: 0, brace: false, pit: true });
  a.emit('input', { throttle: null, brake: 0, steer: 0, brace: false, pit: false });
  a.disconnect();
  process.exit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

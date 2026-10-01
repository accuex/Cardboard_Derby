/**
 * Admin permission test against a server started with ADMIN_PIN=4321:
 * a remote (LAN) admin needs the PIN, players can't skip, and can't start when the Admin forbids it.
 *   ADMIN_PIN=4321 GAME_PORT=3300 npx tsx server/index.ts &  npx tsx scripts/netAdmin.ts http://localhost:3300
 */
import { io } from 'socket.io-client';
import type { AdminState, Snapshot } from '../src/net/protocol';

const URL = process.argv[2] ?? 'http://localhost:3000';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) process.exitCode = 1;
};

async function main(): Promise<void> {
  // Pretend to come from a phone on the LAN through the local dev proxy
  const remote = io(URL, { forceNew: true, auth: { role: 'admin' }, extraHeaders: { 'x-forwarded-for': '192.168.1.50' } });
  const local = io(URL, { forceNew: true, auth: { role: 'admin' } });
  const player = io(URL, { forceNew: true, auth: { role: 'player' } });
  let snap: Snapshot | null = null;
  let adminState: AdminState | null = null;
  player.on('snap', (s) => (snap = s));
  local.on('admin:state', (s) => (adminState = s));
  await wait(800);

  const ask = (s: typeof remote, pin: string) => new Promise<boolean>((r) => s.emit('admin:auth', pin, r));
  check((await ask(remote, '')) === false, 'remote admin without PIN is refused');
  check((await ask(remote, '0000')) === false, 'remote admin with wrong PIN is refused');
  const refused = await new Promise<{ ok: boolean }>((r) => remote.emit('admin:command', { type: 'start' }, r));
  check(!refused.ok, 'commands are refused before auth');
  check((await ask(remote, '4321')) === true, 'remote admin with correct PIN is accepted');
  check((await ask(local, '')) === true, 'admin on this PC needs no PIN');
  await wait(700);
  check(!!adminState, 'admin receives state');

  const set = (settings: object) => new Promise<{ ok: boolean }>((r) => local.emit('admin:command', { type: 'settings', settings }, r));
  await set({ playersCanStart: false });
  player.emit('join', { jockey: 'P', name: 'テスト', silkColor: '#ff0000', body: { legLength: 1, stanceWidth: 0.5, ply: 1, reinforcement: 1, tape: 1, cgAdjust: 0 } });
  await wait(300);
  player.emit('start');
  await wait(500);
  check(snap!.flow.phase === 'build', 'player cannot start when not allowed');
  check(snap!.lobby?.playersCanStart === false, 'lobby tells clients start is admin-only');

  await new Promise((r) => local.emit('admin:command', { type: 'start' }, r));
  await wait(500);
  check(snap!.flow.phase === 'intro', 'admin starts the race');
  player.emit('skip');
  await wait(400);
  check(snap!.flow.phase === 'intro', 'player cannot skip');
  await new Promise((r) => local.emit('admin:command', { type: 'skip' }, r));
  await wait(400);
  check(snap!.flow.phase === 'gate', 'admin can skip');
  await new Promise((r) => local.emit('admin:command', { type: 'abort' }, r));
  await wait(400);
  check(snap!.flow.phase === 'build', 'admin abort returns to the lobby');
  await set({ playersCanStart: true });
  process.exit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

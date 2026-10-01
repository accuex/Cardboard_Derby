/**
 * End-to-end tournament over the network: Admin switches to 大会, CPU + 2 human entrants register,
 * 組分け → 大会開始 → every race run (intros/replays skipped) → 決勝 → 特別賞 + history.
 * Start a throwaway server first:
 *   DATA_DIR=/tmp/derby-test SIM_SPEED=10 GAME_PORT=3300 npx tsx server/index.ts &
 *   npx tsx scripts/netTournament.ts http://localhost:3300
 */
import { io } from 'socket.io-client';
import { referenceBody } from '../src/config/build';
import type { TournamentView } from '../src/game/Tournament';
import type { AdminCommand, AdminState, Snapshot } from '../src/net/protocol';

const URL = process.argv[2] ?? 'http://localhost:3000';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) process.exitCode = 1;
};

async function main(): Promise<void> {
  const admin = io(URL, { forceNew: true, auth: { role: 'admin' } });
  // (cast: the callbacks below assign these, which TypeScript's narrowing can't see)
  let state = null as AdminState | null;
  let snap = null as Snapshot | null;
  admin.on('admin:state', (s) => (state = s));
  admin.on('snap', (s) => (snap = s));
  const cmd = (c: AdminCommand) => new Promise<{ ok: boolean; message?: string }>((r) => admin.emit('admin:command', c, r));
  await new Promise<boolean>((r) => admin.emit('admin:auth', '', r));
  await cmd({ type: 'treset', keepEntrants: false });
  await cmd({ type: 'settings', settings: { mode: 'tournament', autoCountdown: null } });
  await cmd({ type: 'tconfig', name: 'テスト杯' });
  await cmd({ type: 'tadd', count: 10 });

  const humans = [1, 2].map((i) => {
    const s = io(URL, { forceNew: true, auth: { role: 'player' } });
    const me = { socket: s, entrant: null as string | null, view: null as TournamentView | null, notices: [] as string[] };
    s.on('entry', (m) => (me.entrant = m.entrantId));
    s.on('tournament', (v) => (me.view = v));
    s.on('assigned', (m) => m.reason && me.notices.push(m.reason));
    s.on('connect', () => s.emit('join', { jockey: `人間${i}`, name: `ヒト${i}号`, silkColor: '#ff0000', body: referenceBody }));
    return me;
  });
  await wait(1200);
  check(humans.every((h) => !!h.entrant), 'humans registered as entrants');
  check(state!.tournament.entrants.length === 12, `12 entrants (got ${state!.tournament.entrants.length})`);

  await cmd({ type: 'tdraw' });
  await wait(600);
  check(state!.tournament.rounds[0]?.races.length === 2, 'drawn into 2 heats');
  check((await cmd({ type: 'tstart' })).ok, 'tournament started');
  await wait(600);
  check(humans[0].view?.status === 'running', 'players see the tournament running');

  // A late registration is refused
  const late = io(URL, { forceNew: true, auth: { role: 'player' } });
  let lateMsg = '';
  late.on('assigned', (m) => (lateMsg = m.reason ?? ''));
  late.emit('join', { jockey: '遅刻', name: 'チコク号', silkColor: '#00ff00', body: referenceBody });
  await wait(500);
  check(/終了/.test(lateMsg), 'late entry refused');
  late.disconnect();

  let races = 0;
  let droppedHuman = false;
  const t0 = Date.now();
  while (state!.tournament.status !== 'finished' && Date.now() - t0 < 600000) {
    const ph = snap?.flow.phase;
    if (ph === 'build' && state!.tournament.currentRaceId) {
      const label = snap!.lobby?.raceLabel;
      await cmd({ type: 'start' });
      races++;
      console.log(`  race ${races}: ${label}`);
      if (races === 2 && !droppedHuman) {
        humans[1].socket.disconnect(); // CPU stand-in from here
        droppedHuman = true;
      }
      await wait(800);
    } else if (ph === 'intro' || ph === 'paddock' || ph === 'replay') {
      await cmd({ type: 'skip' });
      await wait(300);
    } else if (ph === 'results') {
      await cmd({ type: 'toLobby' });
      await wait(500);
    } else {
      await wait(250);
    }
  }
  const t = state!.tournament;
  check(t.status === 'finished', `tournament finished after ${races} races`);
  check(t.rounds.map((r) => r.kind).join('>') === 'heat>final', `rounds ${t.rounds.map((r) => r.label).join('→')}`);
  check(t.rounds[t.rounds.length - 1].races[0].entrants.length === 6, 'final has 6 runners');
  check(t.awards.length >= 8 && !!t.awards[0].entrantId, `awards (${t.awards.map((a) => a.title).join(', ')})`);
  check(state!.history.filter((h) => h.tournament?.startsWith('テスト杯')).length === races, 'every race saved in the history');
  check(!!state!.history[0].rows[0].stats, 'history rows carry statistics');
  const champ = t.entrants.find((e) => e.id === t.awards[0].entrantId);
  console.log(`  優勝: ${champ?.horseName}`);
  for (const a of t.awards) console.log(`  ${a.title}: ${t.entrants.find((e) => e.id === a.entrantId)?.horseName ?? '-'} ${a.value}`);
  await cmd({ type: 'settings', settings: { mode: 'free', autoCountdown: 15 } });
  process.exit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

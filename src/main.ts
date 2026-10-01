import './styles.css';
import { courseConfig } from './config/course';
import { horseRoster, pacingConfig } from './config/horses';
import { raceConfig } from './config/race';
import { LocalSession } from './game/LocalSession';
import type { Session, SessionEvents } from './game/Session';
import { NetSession } from './net/NetSession';
import { AdminApp } from './admin/AdminApp';
import { CommentaryApp } from './commentary/CommentaryApp';
import { PlayerApp } from './phone/PlayerApp';
import { TvApp } from './tv/TvApp';
import { showMenu } from './ui/Menu';
import { applyDocumentPrefs, isPhone, prefs } from './ui/prefs';
import { applyQuality } from './config/render';
import { Course } from './sim/Course';
import { loadSavedBuild } from './ui/BuildScreen';
import { BroadcastUi } from './ui/BroadcastUi';

/**
 * Entry point / router.
 *   /            menu
 *   /host        big screen (broadcast, lobby with QR)
 *   /player      smartphone controller (the QR links here)
 *   /commentary  telemetry for the commentator
 *   /admin       race management
 *   /play        play on this PC with the keyboard (?offline = everything in this tab)
 *   /tv          競馬中継: AI races one after another, like a TV racing programme (offline)
 * Online screens talk to the game server; /play falls back to offline when no server answers.
 *
 * Extra URL options: ?quick ?horse=N ?seed=N ?speed=N ?grade=G1 ?race=名前 (offline)
 */
const params = new URLSearchParams(location.search);
const skipIntro = params.has('quick');
const path = location.pathname.replace(/\/+$/, '') || '/';
// Older links: /?player and /?watch
const route = params.has('player') ? '/player' : params.has('watch') && path === '/' ? '/host' : path;
const watch = route === '/host' || params.has('watch');
applyDocumentPrefs();
if (params.has('speed')) raceConfig.simulation.timeScale = Number(params.get('speed')) || 1;
// offline CPU strength: ?cpu=easy|hard (online: Admin → CPUの強さ)
const cpuParam = params.get('cpu');
if (cpuParam === 'easy' || cpuParam === 'hard') pacingConfig.level = cpuParam;

async function boot(): Promise<void> {
  // Handlers are bound late: the session may report before the UI exists.
  let ui: BroadcastUi | null = null;
  const handlers: SessionEvents = {
    onPhase: (p) => ui?.onPhase(p),
    onReplaySegment: (r) => ui?.onReplaySegment(r),
    onSetup: () => ui?.onSetup(),
    onLobby: () => {},
    onNotice: (t) => ui?.notice(t),
  };

  let session: Session;
  let notice = '';
  const net = params.has('offline') ? null : new NetSession(raceConfig, handlers, watch ? 'host' : 'play');
  if (net && (await net.ready())) {
    // The server decides the race and the venue
    const info = net.raceInfo!;
    Object.assign(raceConfig, { edition: info.edition, name: info.name, grade: info.grade, distance: info.distance, weather: info.weather });
    Object.assign(courseConfig, net.courseSetup!.config);
    session = net;
  } else {
    if (net) notice = 'サーバーに接続できないため、オフラインで開始します';
    const gradeParam = params.get('grade')?.toUpperCase();
    if (gradeParam && ['G1', 'G2', 'G3', 'OP'].includes(gradeParam)) raceConfig.grade = gradeParam as typeof raceConfig.grade;
    if (params.get('race')) raceConfig.name = params.get('race')!.slice(0, 20);
    const gate = watch ? null : Number(params.get('horse')) || raceConfig.playerGate;
    const seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e9);
    session = new LocalSession(new Course(courseConfig), raceConfig, seed, gate && gate <= horseRoster.length ? gate : null, loadSavedBuild(), handlers, skipIntro);
  }
  applyAutoQuality();
  ui = new BroadcastUi(session, { canPlay: !watch, skipIntro });
  ui.onSetup();
  if (notice) ui.notice(notice);
  ui.begin();
}

function applyAutoQuality(): void {
  const q = prefs().quality;
  applyQuality(q === 'auto' ? (isPhone() ? 'low' : 'high') : q);
}

/** Fade out the loading screen. */
function bootDone(): void {
  const b = document.getElementById('boot');
  if (!b) return;
  b.style.opacity = '0';
  setTimeout(() => b.remove(), 450);
}

switch (route) {
  case '/player':
    new PlayerApp();
    bootDone();
    break;
  case '/commentary':
    new CommentaryApp();
    bootDone();
    break;
  case '/admin':
    new AdminApp();
    bootDone();
    break;
  case '/tv':
    applyAutoQuality();
    new TvApp(params).start();
    bootDone();
    break;
  case '/host':
  case '/play':
    void boot().finally(bootDone);
    break;
  default:
    showMenu();
    bootDone();
}

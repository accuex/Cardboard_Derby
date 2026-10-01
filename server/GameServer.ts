import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server, Socket } from 'socket.io';
import { buildParams } from '../src/config/build';
import { courseConfig } from '../src/config/course';
import { coursePresets, validDistances } from '../src/config/courses';
import { horseRoster, pacingConfig, type HorseProfile } from '../src/config/horses';
import { raceConfig } from '../src/config/race';
import { RaceFlow } from '../src/game/RaceFlow';
import { RaceStatsTracker } from '../src/game/RaceStats';
import { ROUND_GRADE, Tournament, type TournamentData } from '../src/game/Tournament';
import {
  encodeHorse,
  encodeParts,
  NET,
  type AdminCommand,
  type AdminSettings,
  type AdminState,
  type ClientRole,
  type ClientToServer,
  type LobbyInfo,
  type PlayerBuildMsg,
  type RaceRecord,
  type RaceSetup,
  type ServerToClient,
  type Snapshot,
} from '../src/net/protocol';
import { judgeBuildType } from '../src/sim/buildType';
import { Course } from '../src/sim/Course';
import { neutralInput, type HorseInput } from '../src/sim/input';

type ClientSocket = Socket<ClientToServer, ServerToClient>;

/**
 * One person, identified by a secret token their browser keeps, so a reload or a phone
 * waking up from sleep gets the same horse back. Others only ever see `publicId`.
 */
interface Player {
  token: string;
  publicId: string;
  socket: ClientSocket | null;
  connected: boolean;
  /** Seconds since the connection dropped. */
  offlineFor: number;
  build: PlayerBuildMsg | null;
  /** Gate in free play (tournament gates come from the bracket). */
  gate: number | null;
  input: HorseInput;
  /** Pit taps are latched so a short tap between two sim steps is never lost. */
  pitLatch: boolean;
  /** Page is visible (a locked phone stays connected but can't steer). */
  visible: boolean;
  role: ClientRole;
  admin: boolean;
}

/** Who rides which gate in the race being prepared / run. */
interface Slot {
  gate: number;
  profile: HorseProfile;
  /** Human-controlled (by `token`, who may be offline → CPU stand-in). */
  human: boolean;
  token: string | null;
  entrantId: string | null;
}

/** Where results and the tournament are kept (DATA_DIR overrides, e.g. for tests). */
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const HISTORY_FILE = join(DATA_DIR, 'results.json');
const TOURNAMENT_FILE = join(DATA_DIR, 'tournament.json');
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const ROLES: ClientRole[] = ['player', 'play', 'host', 'commentary', 'admin'];
const CPU_NAMES = ['ミカンバコ', 'ハイタツイン', 'オリコミチラシ', 'リサイクルマーク', 'ワレモノチュウイ', 'テンチムヨウ', 'ガムテープ巻', 'クッションザイ', 'プチプチ', 'ミカンノカワ'];

const clean = (s: unknown, max: number) => String(s ?? '').replace(/[<>&"']/g, '').trim().slice(0, max);

function readJson<T>(file: string): T | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null;
  } catch (e) {
    console.warn(`[server] could not read ${file}:`, e);
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn(`[server] could not save ${file}:`, e);
  }
}

/**
 * Authoritative game server: owns the RaceFlow (same code as offline play), steps it in
 * real time, takes player inputs, runs free play or a tournament, and broadcasts snapshots.
 */
export class GameServer {
  private course = new Course(courseConfig);
  private flow: RaceFlow;
  private settings: AdminSettings;
  private pendingCourseId: string | null = null;
  private history: RaceRecord[] = readJson<RaceRecord[]>(HISTORY_FILE) ?? [];
  private tournament = new Tournament(readJson<TournamentData>(TOURNAMENT_FILE) ?? undefined, `${raceConfig.name}杯`);
  private recordedRaceId = -1;
  private readonly adminPin = process.env.ADMIN_PIN || String(randomInt(1000, 10000));
  private readonly players = new Map<string, Player>();
  private raceId = 0;
  private seq = 0;
  private lastEventSeq = 0;
  private countdown: number | null = null;
  private resultsTimer = 0;
  private setup!: RaceSetup;
  private lastTick = Date.now();
  /** The field on the track (gate order). */
  private slots: Slot[] = [];
  /** Tournament race the current field belongs to. */
  private tRaceId: string | null = null;
  private readonly stats = new RaceStatsTracker();
  /** Last part state sent per horse (parts go out only when they change). */
  private sentParts: string[] = [];
  /** Load metrics for /api/stats. */
  private readonly perf = { tickMsAvg: 0, tickMsMax: 0, snapBytes: 0, snapsSent: 0 };

  constructor(private readonly io: Server<ClientToServer, ServerToClient>) {
    this.settings = {
      mode: 'free',
      cpuLevel: 'normal',
      raceName: raceConfig.name,
      edition: raceConfig.edition,
      grade: raceConfig.grade,
      weather: raceConfig.weather,
      distance: raceConfig.distance,
      courseId: coursePresets[0].id,
      autoCountdown: NET.lobbyCountdownSeconds,
      playersCanStart: true,
      autoEdition: true,
    };
    this.flow = this.makeFlow();
    this.toLobby(null);
    io.on('connection', (socket) => this.onConnect(socket));
    setInterval(() => this.tick(), 1000 / 60);
    setInterval(() => this.broadcast(), 1000 / NET.snapshotRate);
    setInterval(() => this.sendAdminState(), 500);
    console.log(`[server] Admin PIN: ${this.adminPin}  (not needed from this PC)`);
  }

  private makeFlow(): RaceFlow {
    return new RaceFlow(this.course, raceConfig, horseRoster, this.newSeed(), { onPhase: () => {} });
  }

  private get tMode(): boolean {
    return this.settings.mode === 'tournament';
  }

  /** Lobby countdown to use after a join / return to lobby. */
  private countdownFor(minimum = 0): number | null {
    const c = this.settings.autoCountdown;
    const hasField = this.tMode ? !!this.tournament.current : this.freeEntrants().length > 0;
    return c === null || !hasField ? null : Math.max(c, minimum);
  }

  private newSeed(): number {
    return Math.floor(Math.random() * 1e9);
  }

  private get inLobby(): boolean {
    return this.flow.phase === 'build';
  }

  private notice(text: string): void {
    this.io.emit('notice', text);
    console.log(`[server] ${text}`);
  }

  private byPublicId(id: string): Player | undefined {
    for (const p of this.players.values()) if (p.publicId === id) return p;
    return undefined;
  }

  // ------------------------------------------------------------ connections

  private onConnect(socket: ClientSocket): void {
    const auth = (socket.handshake.auth ?? {}) as { token?: unknown; role?: unknown };
    const claimed = clean(auth.token, 64);
    const role: ClientRole = ROLES.includes(auth.role as ClientRole) ? (auth.role as ClientRole) : 'play';
    let player = claimed ? this.players.get(claimed) : undefined;
    if (player) {
      // Same browser coming back: take over its slot (a stale socket is dropped)
      player.socket?.disconnect(true);
      Object.assign(player, { socket, connected: true, visible: true, offlineFor: 0, role });
    } else {
      player = {
        token: claimed || randomUUID(), publicId: randomUUID().slice(0, 8), socket, connected: true, offlineFor: 0,
        build: null, gate: null, input: neutralInput(), pitLatch: false, visible: true, role, admin: false,
      };
      this.players.set(player.token, player);
    }
    const p = player;
    socket.emit('welcome', { clientId: p.token, publicId: p.publicId });
    // entry before setup, so a reloading client knows it is already entered
    socket.emit('tournament', this.tournament.view());
    this.sendEntry(p);
    socket.emit('setup', this.setup);
    if (p.gate !== null && p.build && !this.tMode) socket.emit('assigned', { gate: p.gate });
    this.onReconnected(p);
    console.log(`[server] ${p.publicId} connected (${this.onlineCount()} online)`);

    socket.on('join', (build) => this.onJoin(p, build));
    socket.on('leave', () => this.onLeave(p));
    socket.on('input', (input) => {
      const pit = !!input?.pit;
      if (pit) p.pitLatch = true;
      p.input = {
        throttle: input?.throttle == null ? null : Math.max(0, Math.min(1, Number(input.throttle) || 0)),
        brake: Math.max(0, Math.min(1, Number(input?.brake) || 0)),
        steer: Math.max(-1, Math.min(1, Number(input?.steer) || 0)),
        brace: !!input?.brace,
        pit,
      };
    });
    socket.on('presence', (visible) => {
      p.visible = !!visible;
      if (p.visible) this.onReconnected(p);
      else this.onDisconnected(p, '画面オフ');
    });
    socket.on('ping', (t, ack) => {
      if (typeof ack === 'function') ack(t);
    });
    // Players may only start/rematch when the Admin allows it (never during a tournament); skipping is Admin-only
    const mayStart = () => p.admin || (this.settings.playersCanStart && !this.tMode);
    socket.on('start', () => {
      if (this.inLobby && mayStart()) this.startRace();
    });
    socket.on('skip', () => {
      if (p.admin) this.flow.skip();
    });
    socket.on('rematch', () => {
      if (this.flow.phase === 'results' && mayStart()) this.toLobby(this.countdownFor(NET.rematchCountdownSeconds));
    });
    if (role === 'admin' && this.isLocal(socket)) this.grantAdmin(p);
    socket.on('admin:auth', (pin, ack) => {
      const ok = p.admin || this.isLocal(socket) || clean(pin, 16) === this.adminPin;
      if (ok) this.grantAdmin(p);
      if (typeof ack === 'function') ack(ok);
    });
    socket.on('admin:command', (cmd, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!p.admin) return reply({ ok: false, message: '管理者として認証されていません' });
      try {
        reply(this.onAdmin(cmd));
      } catch (e) {
        console.error(e);
        reply({ ok: false, message: String(e) });
      }
      this.sendAdminState();
    });
    socket.on('disconnect', () => {
      if (p.socket !== socket) return; // replaced by a newer connection
      Object.assign(p, { socket: null, connected: false, offlineFor: 0, input: neutralInput() });
      console.log(`[server] ${p.publicId} disconnected (${this.onlineCount()} online)`);
      this.onDisconnected(p);
    });
  }

  /** Loopback peer = this PC (behind the Vite dev proxy, trust its X-Forwarded-For only then). */
  private isLocal(socket: ClientSocket): boolean {
    const peer = socket.handshake.address;
    if (!LOOPBACK.has(peer)) return false;
    const fwd = socket.handshake.headers['x-forwarded-for'];
    const origin = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim();
    return !origin || LOOPBACK.has(origin);
  }

  private grantAdmin(p: Player): void {
    p.admin = true;
    p.socket?.join('admins');
  }

  private onlineCount(): number {
    return [...this.players.values()].filter((p) => p.connected).length;
  }

  /** Read by the simulation each tick. */
  private reader(token: string | null): () => HorseInput {
    return () => {
      const p = token ? this.players.get(token) : undefined;
      if (!p) return neutralInput();
      const input = { ...p.input, pit: p.pitLatch };
      p.pitLatch = false;
      return input;
    };
  }

  private horseInRace(p: Player): number | null {
    const slot = this.slots.find((s) => s.human && s.token === p.token);
    return slot ? slot.gate - 1 : null;
  }

  private riderName(p: Player): string {
    return p.build?.jockey || p.build?.name || 'プレイヤー';
  }

  private onDisconnected(p: Player, why = '通信切断'): void {
    const id = this.horseInRace(p);
    if (id !== null && !this.inLobby && !this.flow.sim.state.horses[id]?.autopilot) {
      this.flow.sim.setAutopilot(id, true);
      this.notice(`${id + 1}番 ${this.riderName(p)} ${why} — CPUが代走します`);
    }
  }

  private onReconnected(p: Player): void {
    const id = this.horseInRace(p);
    if (id !== null && !this.inLobby && this.flow.sim.state.horses[id]?.autopilot) {
      this.flow.sim.setAutopilot(id, false);
      this.notice(`${id + 1}番 ${this.riderName(p)} 復帰しました`);
    }
  }

  private sanitizeBuild(raw: PlayerBuildMsg): PlayerBuildMsg | null {
    const b = raw?.body;
    if (!b) return null;
    const num = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || lo));
    return {
      jockey: clean(raw.jockey, 12) || 'ゲスト',
      name: clean(raw.name, 12) || 'ダンボール号',
      silkColor: /^#[0-9a-f]{6}$/i.test(raw.silkColor) ? raw.silkColor : '#e04848',
      body: {
        legLength: num(b.legLength, 0.8, 1.3),
        stanceWidth: num(b.stanceWidth, 0.4, 0.72),
        ply: num(b.ply, 0.6, 1.5),
        reinforcement: num(b.reinforcement, 0.6, 2),
        tape: num(b.tape, 0.5, 2),
        cgAdjust: Math.max(-0.25, Math.min(0.15, Number(b.cgAdjust) || 0)),
      },
    };
  }

  private onJoin(p: Player, raw: PlayerBuildMsg): void {
    const build = this.sanitizeBuild(raw);
    if (!build) return;
    p.build = build;
    if (this.tMode) return this.registerEntrant(p);
    if (p.gate === null) p.gate = this.freeGate();
    if (p.gate === null) {
      p.socket?.emit('assigned', { gate: null, reason: '満員のため観戦モードです' });
      return;
    }
    p.socket?.emit('assigned', { gate: p.gate, reason: this.inLobby ? undefined : '次のレースから出走します' });
    console.log(`[server] ${p.publicId} joined as gate ${p.gate} "${build.name}" (${build.jockey})`);
    if (this.inLobby) {
      const auto = this.countdownFor(NET.lobbyMinCountdownAfterJoin);
      this.toLobby(auto === null ? null : Math.max(this.countdown ?? auto, NET.lobbyMinCountdownAfterJoin));
    }
  }

  private onLeave(p: Player): void {
    p.build = null;
    p.gate = null;
    if (this.inLobby && !this.tMode) this.toLobby(this.countdown);
  }

  private freeGate(): number | null {
    const used = new Set([...this.players.values()].map((p) => p.gate));
    for (let g = 1; g <= horseRoster.length; g++) if (!used.has(g)) return g;
    return null;
  }

  private freeEntrants(): Player[] {
    return [...this.players.values()].filter((p) => p.build && p.gate !== null);
  }

  // ------------------------------------------------------------ tournament

  private entrantOf(p: Player): string | null {
    return this.tournament.data.entrants.find((e) => e.owner === p.token)?.id ?? null;
  }

  private sendEntry(p: Player): void {
    p.socket?.emit('entry', { entrantId: this.entrantOf(p) });
  }

  /** 参加者登録 from a phone (or PC). */
  private registerEntrant(p: Player): void {
    const b = p.build!;
    const id = this.entrantOf(p) ?? randomUUID().slice(0, 8);
    const r = this.tournament.register({ id, owner: p.token, jockey: b.jockey ?? 'ゲスト', horseName: b.name, silkColor: b.silkColor, body: b.body, nickname: judgeBuildType(b.body).name });
    p.socket?.emit('assigned', { gate: null, reason: r.ok ? (r.message ?? `${this.tournament.data.config.name} にエントリーしました`) : r.message });
    if (r.ok) console.log(`[server] entry: ${b.jockey} / ${b.name}`);
    this.sendEntry(p);
    this.tournamentChanged();
  }

  private tournamentChanged(): void {
    writeJson(TOURNAMENT_FILE, this.tournament.data);
    this.io.emit('tournament', this.tournament.view());
  }

  private addCpuEntrants(count: number): void {
    for (let i = 0; i < count; i++) {
      const body = {} as PlayerBuildMsg['body'];
      for (const prm of buildParams) body[prm.key] = Math.round((prm.min + Math.random() * (prm.max - prm.min)) / prm.step) * prm.step;
      const n = this.tournament.data.entrants.length + 1;
      this.tournament.register({
        id: randomUUID().slice(0, 8), cpu: true, jockey: `CPU${n}`, horseName: `${CPU_NAMES[n % CPU_NAMES.length]}${n}号`,
        silkColor: ['#8a5ad8', '#20b8c8', '#f0a020', '#2fa36b', '#d85aa8', '#3a62d8', '#e04848'][n % 7], body, nickname: judgeBuildType(body).name,
      });
    }
  }

  // ------------------------------------------------------------ admin

  private onAdmin(cmd: AdminCommand): { ok: boolean; message?: string } {
    const t = this.tournament;
    switch (cmd.type) {
      case 'start':
        if (!this.inLobby) return { ok: false, message: 'ロビーにいる時だけ発走できます' };
        if (this.tMode && !t.current) return { ok: false, message: '大会のレースがありません（大会開始が必要です）' };
        this.startRace();
        return { ok: true };
      case 'skip':
        this.flow.skip();
        return { ok: true };
      case 'abort':
        this.notice('管理者によりレースが中止されました');
        this.toLobby(this.countdownFor());
        return { ok: true };
      case 'restart':
        if (this.tMode && !t.current) return { ok: false, message: 'やり直すレースがありません' };
        this.notice('管理者によりレースをやり直します');
        this.startRace();
        return { ok: true };
      case 'toLobby':
        this.toLobby(this.countdownFor());
        return { ok: true };
      case 'settings':
        return this.applySettings(cmd.settings);
      case 'kick': {
        const p = this.byPublicId(cmd.id);
        if (!p) return { ok: false, message: '見つかりません' };
        const id = this.horseInRace(p);
        if (id !== null && !this.inLobby) {
          this.flow.sim.setAutopilot(id, true);
          this.slots[id].human = false;
        }
        p.build = null;
        p.gate = null;
        p.socket?.emit('assigned', { gate: null, reason: '管理者により出走が取り消されました' });
        if (this.inLobby) this.toLobby(this.countdown);
        return { ok: true };
      }
      case 'setGate': {
        const p = this.byPublicId(cmd.id);
        const gate = Math.round(cmd.gate);
        if (!p || !p.build || gate < 1 || gate > horseRoster.length) return { ok: false, message: '枠を変更できません' };
        if (!this.inLobby || this.tMode) return { ok: false, message: '枠の変更はフリーモードのロビーでのみ可能です' };
        const other = [...this.players.values()].find((o) => o !== p && o.gate === gate);
        if (other) other.gate = p.gate;
        p.gate = gate;
        for (const q of [p, other]) if (q) q.socket?.emit('assigned', { gate: q.gate });
        this.toLobby(this.countdown);
        return { ok: true };
      }
      case 'deleteResult':
        this.history = this.history.filter((r) => r.id !== cmd.id);
        writeJson(HISTORY_FILE, this.history);
        return { ok: true };
      case 'clearResults':
        this.history = [];
        writeJson(HISTORY_FILE, this.history);
        return { ok: true };
      case 'tconfig':
        if (cmd.name !== undefined) t.data.config.name = clean(cmd.name, 24) || t.data.config.name;
        if (cmd.heatQualifiers !== undefined && t.data.status === 'registration') t.data.config.heatQualifiers = Math.max(1, Math.min(5, Math.round(cmd.heatQualifiers)));
        if (cmd.autoGrade !== undefined) t.data.config.autoGrade = !!cmd.autoGrade;
        this.tournamentChanged();
        if (this.inLobby) this.toLobby(this.countdown);
        return { ok: true };
      case 'tdraw':
        if (t.data.status !== 'registration') return { ok: false, message: '組分けは受付中のみ' };
        t.draw();
        this.tournamentChanged();
        return { ok: true, message: '組分けしました' };
      case 'tmove':
        t.move(cmd.entrantId, cmd.race);
        this.tournamentChanged();
        return { ok: true };
      case 'tadd':
        if (t.data.status !== 'registration') return { ok: false, message: '受付中のみ追加できます' };
        this.addCpuEntrants(Math.max(1, Math.min(60, Math.round(cmd.count))));
        this.tournamentChanged();
        return { ok: true };
      case 'tremove':
        t.withdraw(cmd.entrantId);
        this.tournamentChanged();
        if (this.inLobby && this.tMode) this.toLobby(this.countdown);
        return { ok: true, message: t.data.status === 'registration' ? 'エントリーを削除しました' : '棄権にしました' };
      case 'tstart': {
        if (!this.tMode) return { ok: false, message: '先に「大会モード」にしてください' };
        const r = t.start();
        if (!r.ok) return r;
        this.tournamentChanged();
        this.notice(`${t.data.config.name} 開幕！`);
        this.toLobby(this.countdownFor());
        return { ok: true };
      }
      case 'treset':
        t.reset(cmd.keepEntrants);
        this.tournamentChanged();
        if (this.inLobby) this.toLobby(null);
        return { ok: true, message: cmd.keepEntrants ? '大会をリセットしました（エントリーは保持）' : '大会とエントリーを消去しました' };
    }
    return { ok: false, message: '不明なコマンド' };
  }

  private applySettings(next: Partial<AdminSettings>): { ok: boolean; message?: string } {
    const s = this.settings;
    if (next.mode !== undefined && (next.mode === 'free' || next.mode === 'tournament')) s.mode = next.mode;
    if (next.cpuLevel !== undefined && ['easy', 'normal', 'hard'].includes(next.cpuLevel)) s.cpuLevel = next.cpuLevel;
    pacingConfig.level = s.cpuLevel;
    if (next.raceName !== undefined) s.raceName = clean(next.raceName, 24) || s.raceName;
    if (next.edition !== undefined) s.edition = Math.max(1, Math.min(999, Math.round(Number(next.edition)) || 1));
    if (next.grade !== undefined && ['G1', 'G2', 'G3', 'OP', ''].includes(next.grade)) s.grade = next.grade;
    if (next.weather !== undefined) s.weather = clean(next.weather, 8) || s.weather;
    if (next.autoCountdown !== undefined) s.autoCountdown = next.autoCountdown === null ? null : Math.max(5, Math.min(300, Number(next.autoCountdown) || 15));
    if (next.playersCanStart !== undefined) s.playersCanStart = !!next.playersCanStart;
    if (next.autoEdition !== undefined) s.autoEdition = !!next.autoEdition;
    if (next.courseId !== undefined && coursePresets.some((c) => c.id === next.courseId)) s.courseId = next.courseId;
    // distance must suit the (new) course
    const preset = coursePresets.find((c) => c.id === s.courseId)!;
    const allowed = validDistances(preset.config);
    const wanted = next.distance !== undefined ? Number(next.distance) : s.distance;
    s.distance = allowed.includes(wanted) ? wanted : allowed.reduce((a, b) => (Math.abs(b - wanted) < Math.abs(a - wanted) ? b : a));
    raceConfig.edition = s.edition;
    raceConfig.weather = s.weather;
    if (this.inLobby) {
      this.toLobby(this.countdown);
      return { ok: true };
    }
    // Mid-race changes wait for the next field
    this.pendingCourseId = s.courseId;
    return { ok: true, message: '次のレースから反映されます' };
  }

  private applyCourseAndDistance(): void {
    const s = this.settings;
    raceConfig.distance = s.distance;
    const preset = coursePresets.find((c) => c.id === s.courseId)!;
    if (preset.config.venueName !== this.course.config.venueName || this.pendingCourseId) {
      Object.assign(courseConfig, preset.config);
      this.course = new Course({ ...preset.config });
      this.flow = this.makeFlow();
    }
    this.pendingCourseId = null;
  }

  /** Race name and grade shown on every screen (tournament races are named after the round). */
  private applyRaceTitle(): void {
    const s = this.settings;
    const race = this.tMode ? this.tournament.current : null;
    raceConfig.name = race ? `${this.tournament.data.config.name} ${race.label}` : this.tMode ? this.tournament.data.config.name : s.raceName;
    raceConfig.grade = race && this.tournament.data.config.autoGrade ? ROUND_GRADE[race.round] : s.grade;
  }

  // ------------------------------------------------------------ race control

  /** Who rides which gate in the next race. */
  private fieldPlan(): Slot[] {
    const cpuSlot = (i: number): Slot => ({ gate: i + 1, profile: horseRoster[i], human: false, token: null, entrantId: null });
    if (this.tMode) {
      const race = this.tournament.current;
      this.tRaceId = race?.id ?? null;
      return horseRoster.map((cpu, i) => {
        const e = race ? this.tournament.entrant(race.entrants[i]) : undefined;
        if (!e) return cpuSlot(i);
        const profile: HorseProfile = { ...cpu, name: e.horseName, jockey: e.cpu ? undefined : e.jockey, silkColor: e.silkColor, body: { ...e.body } };
        return { gate: i + 1, profile, human: !e.cpu && !e.withdrawn, token: e.owner ?? null, entrantId: e.id };
      });
    }
    this.tRaceId = null;
    const byGate = new Map(this.freeEntrants().map((p) => [p.gate!, p]));
    return horseRoster.map((cpu, i) => {
      const p = byGate.get(i + 1);
      if (!p?.build) return cpuSlot(i);
      const b = p.build;
      return { gate: i + 1, profile: { ...cpu, name: b.name, jockey: b.jockey, silkColor: b.silkColor, body: { ...b.body } }, human: true, token: p.token, entrantId: null };
    });
  }

  private applyField(): void {
    this.applyCourseAndDistance();
    this.applyRaceTitle();
    this.slots = this.fieldPlan();
    this.flow.setRoster(this.slots.map((s) => s.profile));
    this.flow.setPlayers(this.slots.filter((s) => s.human).map((s) => ({ id: s.gate - 1, read: this.reader(s.token) })));
  }

  /** Rebuild the field and park it in the lobby. */
  private toLobby(countdown: number | null): void {
    this.applyField();
    this.flow.prepare(this.newSeed());
    this.countdown = this.slots.some((s) => s.human || s.entrantId) ? countdown : null;
    this.newRace();
  }

  private startRace(): void {
    this.applyField();
    this.flow.restart(this.newSeed());
    // Anyone offline (or with the screen off) starts with a stand-in rider
    for (const s of this.slots) {
      if (!s.human) continue;
      const p = s.token ? this.players.get(s.token) : undefined;
      if (!p?.connected || !p.visible) this.flow.sim.setAutopilot(s.gate - 1, true);
    }
    this.stats.reset(this.slots.length);
    this.countdown = null;
    this.resultsTimer = 0;
    this.newRace();
    console.log(`[server] race ${this.raceId} "${raceConfig.name}" started (${this.slots.filter((s) => s.human).length} human)`);
  }

  private newRace(): void {
    this.raceId++;
    this.lastEventSeq = 0;
    this.sentParts = [];
    const st = this.flow.sim.state;
    this.setup = {
      raceId: this.raceId,
      seed: this.flow.seed,
      courseId: this.settings.courseId,
      course: { ...this.course.config },
      race: { edition: raceConfig.edition, name: raceConfig.name, grade: raceConfig.grade, distance: raceConfig.distance, weather: raceConfig.weather },
      startS: st.startS,
      horses: st.horses.map((h) => {
        const slot = this.slots[h.id];
        const owner = slot?.token ? this.players.get(slot.token)?.publicId ?? null : null;
        return {
          id: h.id, gate: h.gate, name: h.name, silkColor: h.silkColor, style: h.style, body: h.body,
          mass: h.mass, nickname: h.nickname, human: h.isPlayer, owner, jockey: h.jockey, entrant: slot?.entrantId ?? null,
        };
      }),
    };
    this.io.emit('setup', this.setup);
  }

  /** 結果管理: store the official result once per race (history + tournament). */
  private recordResult(): void {
    if (this.recordedRaceId === this.raceId) return;
    this.recordedRaceId = this.raceId;
    const st = this.flow.sim.state;
    const s = this.settings;
    const stats = this.stats.result(st);
    const preset = coursePresets.find((c) => c.id === s.courseId)!;
    const rows = st.order.map((id) => {
      const h = st.horses[id];
      const place = st.finishOrder.indexOf(id);
      return {
        rank: place >= 0 ? place + 1 : null, gate: h.gate, name: h.name, jockey: h.jockey, nickname: h.nickname,
        human: h.isPlayer, time: h.finishTime, falls: h.falls, repairs: h.repairs, stats: stats[id],
      };
    });
    const tRace = this.tRaceId ? this.tournament.data.rounds.flat().find((r) => r.id === this.tRaceId) : null;
    this.history.unshift({
      id: randomUUID(), at: Date.now(), title: `第${raceConfig.edition}回 ${raceConfig.name}`, grade: raceConfig.grade,
      distance: st.distance, course: preset.config.venueName, rows,
      tournament: tRace ? `${this.tournament.data.config.name} ${tRace.label}` : undefined,
    });
    this.history = this.history.slice(0, 500);
    writeJson(HISTORY_FILE, this.history);

    if (tRace) {
      // official order: finishers, then the rest by distance covered
      const results = st.order
        .map((id, k) => ({ entrantId: this.slots[id]?.entrantId, place: k + 1, time: st.horses[id].finishTime, stats: stats[id] }))
        .filter((r): r is { entrantId: string; place: number; time: number | null; stats: typeof stats[number] } => !!r.entrantId)
        .map((r, k) => ({ ...r, place: k + 1 }));
      this.tournament.recordResult(tRace.id, results);
      this.tournamentChanged();
      if (this.tournament.data.status === 'finished') this.notice(`${this.tournament.data.config.name} 全レース終了！ 表彰式へ`);
      for (const p of this.players.values()) this.sendEntry(p);
    } else if (s.autoEdition) {
      s.edition++;
      raceConfig.edition = s.edition;
    }
  }

  private tick(): void {
    const t0 = performance.now();
    this.tickInner();
    const ms = performance.now() - t0;
    this.perf.tickMsAvg = this.perf.tickMsAvg * 0.98 + ms * 0.02;
    this.perf.tickMsMax = Math.max(this.perf.tickMsMax * 0.999, ms);
  }

  metrics(): Record<string, number | string> {
    return {
      phase: this.flow.phase,
      clients: this.onlineCount(),
      tickMsAvg: Math.round(this.perf.tickMsAvg * 1000) / 1000,
      tickMsMax: Math.round(this.perf.tickMsMax * 100) / 100,
      snapshotBytes: this.perf.snapBytes,
      snapshotsSent: this.perf.snapsSent,
      entrants: this.tournament.data.entrants.length,
      mode: this.settings.mode,
    };
  }

  private tickInner(): void {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.expireOffline(dt);
    if (this.inLobby) {
      if (this.countdown !== null) {
        this.countdown -= dt;
        if (this.countdown <= 0) this.startRace();
      }
      return;
    }
    this.flow.update(dt);
    if (this.flow.phase === 'running' || this.flow.phase === 'finish') this.stats.update(this.flow.sim.state);
    if (this.flow.phase === 'replay' || this.flow.phase === 'results') this.recordResult();
    if (this.flow.phase === 'results') {
      this.resultsTimer += dt;
      // On to the next race (tournament) / back to the lobby (free play)
      if (this.resultsTimer > (this.tMode ? 25 : 40)) this.toLobby(this.countdownFor());
    }
  }

  /** Spectators vanish at once; free-play players keep their gate for a grace period. Tournament entries never expire. */
  private expireOffline(dt: number): void {
    for (const p of [...this.players.values()]) {
      if (p.connected) continue;
      p.offlineFor += dt;
      const racingNow = !this.inLobby && this.horseInRace(p) !== null;
      const entered = !!this.entrantOf(p);
      if (!p.build && !entered && p.offlineFor > 5) this.players.delete(p.token);
      else if (!this.tMode && p.build && p.gate !== null && !racingNow && p.offlineFor > NET.lobbyGraceSeconds) {
        this.notice(`${p.gate}番 ${this.riderName(p)} の接続が戻らないため、枠を空けました`);
        p.gate = null;
        p.build = null;
        if (this.inLobby) this.toLobby(this.countdown);
      }
    }
  }

  private lobbyInfo(): LobbyInfo {
    const humans = this.slots
      .filter((s) => s.human || s.entrantId)
      .map((s) => {
        const p = s.token ? this.players.get(s.token) : undefined;
        return { id: p?.publicId ?? s.entrantId ?? `cpu${s.gate}`, gate: s.gate, name: s.profile.name, jockey: s.profile.jockey ?? 'CPU', connected: !s.human || !!p?.connected };
      });
    return {
      countdown: this.countdown === null ? null : Math.max(0, this.countdown),
      players: humans,
      spectators: [...this.players.values()].filter((p) => p.connected && !this.slots.some((s) => s.token === p.token)).length,
      playersCanStart: this.settings.playersCanStart && !this.tMode,
      mode: this.settings.mode,
      raceLabel: this.tMode ? (this.tournament.current?.label ?? null) : null,
    };
  }

  private sendAdminState(): void {
    const admins = this.io.sockets.adapter.rooms.get('admins');
    if (!admins?.size) return;
    const roles = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<ClientRole, number>;
    for (const p of this.players.values()) if (p.connected) roles[p.role]++;
    const t = this.tournament;
    const connected: Record<string, boolean> = {};
    for (const e of t.data.entrants) connected[e.id] = e.cpu || !!(e.owner && this.players.get(e.owner)?.connected);
    const state: AdminState = {
      settings: this.settings,
      phase: this.flow.phase,
      raceTime: this.flow.sim.state.time,
      countdown: this.countdown,
      players: [...this.players.values()]
        .filter((p) => p.build || p.connected)
        .map((p) => ({
          id: p.publicId, jockey: p.build?.jockey ?? '', horse: p.build?.name ?? '', gate: p.build && !this.tMode ? p.gate : null,
          connected: p.connected, visible: p.visible, role: p.role,
        })),
      roles,
      courses: coursePresets.map((c) => ({ id: c.id, label: c.label, distances: validDistances(c.config) })),
      history: this.history,
      tournament: { ...t.view(), config: { name: t.data.config.name, heatQualifiers: t.data.config.heatQualifiers, autoGrade: t.data.config.autoGrade }, connected },
    };
    this.io.to('admins').emit('admin:state', state);
  }

  private broadcast(): void {
    if (!this.onlineCount()) return;
    const flow = this.flow;
    const st = flow.sim.state;
    const events = st.events.filter((e) => e.seq > this.lastEventSeq);
    if (events.length) this.lastEventSeq = events[events.length - 1].seq;
    const snap: Snapshot = {
      raceId: this.raceId,
      seq: ++this.seq,
      serverTime: Date.now(),
      flow: { phase: flow.phase, phaseTime: flow.phaseTime, paddockIndex: flow.paddockIndex },
      race: { phase: st.phase, time: st.time, order: st.order, finishOrder: st.finishOrder },
      horses: st.horses.map((h) => {
        const parts = encodeParts(h);
        const key = JSON.stringify(parts);
        // keyframe every 2s so new / reconnecting screens catch up
        const send = key !== this.sentParts[h.id] || this.seq % (NET.snapshotRate * 2) === 0;
        this.sentParts[h.id] = key;
        return encodeHorse(h, send ? parts : null);
      }),
      events,
      replay: flow.phase === 'replay' && flow.replay ? { segments: flow.replay.segments, index: flow.replay.segmentIndex } : null,
      lobby: flow.phase === 'build' || flow.phase === 'results' ? this.lobbyInfo() : null,
    };
    this.io.emit('snap', snap);
    this.perf.snapBytes = JSON.stringify(snap).length;
    this.perf.snapsSent++;
  }
}

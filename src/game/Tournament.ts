import type { HorseBody } from '../config/horses';
import { Rng } from '../core/rng';
import { emptyStats, type HorseRaceStats } from './RaceStats';

/**
 * 大会モード: registration, heats (予選), semi-finals (準決勝), final (決勝),
 * advancement, statistics and special awards. Pure data + logic (persisted by the server).
 */

export type RoundKind = 'heat' | 'semi' | 'final';

export interface Entrant {
  /** Public id (shown to everyone). */
  id: string;
  /** Secret reconnect token of the owning browser (server only, never sent to clients). */
  owner?: string;
  jockey: string;
  horseName: string;
  silkColor: string;
  body: HorseBody;
  nickname: string;
  /** Added by the Admin as a CPU-ridden entrant (bots / walk-ins without a phone). */
  cpu: boolean;
  withdrawn: boolean;
  registeredAt: number;
}

export interface EntrantResult {
  entrantId: string;
  place: number;
  time: number | null;
  stats: HorseRaceStats;
}

export interface TRace {
  id: string;
  round: RoundKind;
  /** 1-based within the round. */
  index: number;
  label: string;
  /** Entrant ids in gate order. */
  entrants: string[];
  status: 'pending' | 'done';
  results: EntrantResult[];
  qualifiers: string[];
}

export interface TournamentConfig {
  name: string;
  raceSize: number;
  /** Advancing from each heat (予選). */
  heatQualifiers: number;
  finalSize: number;
  /** Escalate the grade by round (予選 OP → 準決勝 G2 → 決勝 G1). */
  autoGrade: boolean;
}

export interface Award {
  id: string;
  title: string;
  description: string;
  entrantId: string | null;
  value: string;
}

export interface TournamentData {
  id: string;
  status: 'registration' | 'running' | 'finished';
  config: TournamentConfig;
  entrants: Entrant[];
  rounds: TRace[][];
  createdAt: number;
}

/** What screens (host, phones) are told. */
export interface TournamentView {
  name: string;
  status: TournamentData['status'];
  heatQualifiers: number;
  finalSize: number;
  entrants: { id: string; jockey: string; horseName: string; nickname: string; cpu: boolean; withdrawn: boolean }[];
  rounds: { kind: RoundKind; label: string; races: { id: string; label: string; entrants: string[]; status: TRace['status']; results: { entrantId: string; place: number; time: number | null }[]; qualifiers: string[] }[] }[];
  currentRaceId: string | null;
  awards: Award[];
}

export const ROUND_LABEL: Record<RoundKind, string> = { heat: '予選', semi: '準決勝', final: '決勝' };
export const ROUND_GRADE: Record<RoundKind, 'OP' | 'G2' | 'G1'> = { heat: 'OP', semi: 'G2', final: 'G1' };

const uid = () => Math.random().toString(36).slice(2, 10);

/** Split n entrants into the fewest races of at most `size`, as evenly as possible (35 → 6,6,6,6,6,5). */
export function splitSizes(n: number, size: number): number[] {
  const races = Math.max(1, Math.ceil(n / size));
  const base = Math.floor(n / races);
  const extra = n % races;
  return Array.from({ length: races }, (_, i) => base + (i < extra ? 1 : 0));
}

export class Tournament {
  data: TournamentData;

  constructor(data?: TournamentData, name = '段ボール競馬 大会') {
    this.data = data ?? {
      id: uid(),
      status: 'registration',
      config: { name, raceSize: 6, heatQualifiers: 2, finalSize: 6, autoGrade: true },
      entrants: [],
      rounds: [],
      createdAt: Date.now(),
    };
  }

  // ------------------------------------------------------------ registration

  get active(): Entrant[] {
    return this.data.entrants.filter((e) => !e.withdrawn);
  }

  entrant(id: string): Entrant | undefined {
    return this.data.entrants.find((e) => e.id === id);
  }

  /** Register or update (builds can change until the tournament starts). */
  register(e: Omit<Entrant, 'registeredAt' | 'withdrawn' | 'cpu'> & { cpu?: boolean }): { ok: boolean; message?: string } {
    const existing = this.entrant(e.id);
    if (this.data.status !== 'registration') {
      if (!existing) return { ok: false, message: '大会のエントリー受付は終了しています' };
      return { ok: true, message: '大会中は馬体を変更できません' };
    }
    if (existing) {
      Object.assign(existing, { ...e, withdrawn: false });
      return { ok: true };
    }
    if (this.active.length >= 96) return { ok: false, message: 'エントリーが上限に達しました' };
    this.data.entrants.push({ ...e, cpu: !!e.cpu, withdrawn: false, registeredAt: Date.now() });
    // already drawn: slot the newcomer into the smallest race instead of throwing the draw away
    const round = this.data.rounds[0];
    if (round) {
      const smallest = [...round].sort((a, b) => a.entrants.length - b.entrants.length)[0];
      if (smallest.entrants.length < this.data.config.raceSize && round[0].round !== 'final') smallest.entrants.push(e.id);
      else this.draw(); // no room (or it was a single final): redraw
    }
    return { ok: true };
  }

  withdraw(id: string): void {
    const e = this.entrant(id);
    if (!e) return;
    if (this.data.status === 'registration') {
      this.data.entrants = this.data.entrants.filter((x) => x.id !== id);
      for (const r of this.data.rounds[0] ?? []) r.entrants = r.entrants.filter((x) => x !== id);
      if (this.data.rounds[0]?.some((r) => r.entrants.length === 0)) this.draw();
    } else e.withdrawn = true;
  }

  // ------------------------------------------------------------ bracket

  /** 組分け: random heats (or a single final when few enough). */
  draw(seed = Date.now()): void {
    if (this.data.status !== 'registration') return;
    const rng = new Rng(seed);
    const ids = this.active.map((e) => e.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const kind: RoundKind = ids.length <= this.data.config.finalSize ? 'final' : 'heat';
    this.data.rounds = [this.makeRound(kind, ids)];
  }

  private makeRound(kind: RoundKind, ids: string[]): TRace[] {
    const sizes = kind === 'final' ? [ids.length] : splitSizes(ids.length, this.data.config.raceSize);
    let k = 0;
    return sizes.map((n, i) => ({
      id: uid(),
      round: kind,
      index: i + 1,
      label: kind === 'final' ? ROUND_LABEL.final : `${ROUND_LABEL[kind]}${i + 1}組`,
      entrants: ids.slice(k, (k += n)),
      status: 'pending' as const,
      results: [],
      qualifiers: [],
    }));
  }

  /** Move an entrant to another race of the first round (before the start). */
  move(entrantId: string, raceIndex: number): void {
    const round = this.data.rounds[0];
    if (this.data.status !== 'registration' || !round) return;
    const target = round[raceIndex - 1];
    const source = round.find((r) => r.entrants.includes(entrantId));
    if (!target || !source || target === source) return;
    source.entrants = source.entrants.filter((id) => id !== entrantId);
    if (target.entrants.length >= this.data.config.raceSize) {
      // full: swap with the last horse of the target race
      source.entrants.push(target.entrants.pop()!);
    }
    target.entrants.push(entrantId);
  }

  start(): { ok: boolean; message?: string } {
    if (this.data.status !== 'registration') return { ok: false, message: '既に開始しています' };
    if (this.active.length < 2) return { ok: false, message: 'エントリーが2名以上必要です' };
    if (!this.data.rounds.length) this.draw();
    // anyone registered after the draw goes to the smallest race
    const placed = new Set(this.data.rounds[0].flatMap((r) => r.entrants));
    for (const e of this.active) {
      if (placed.has(e.id)) continue;
      const smallest = [...this.data.rounds[0]].sort((a, b) => a.entrants.length - b.entrants.length)[0];
      smallest.entrants.push(e.id);
    }
    this.data.status = 'running';
    return { ok: true };
  }

  get current(): TRace | null {
    if (this.data.status !== 'running') return null;
    for (const round of this.data.rounds) for (const r of round) if (r.status === 'pending') return r;
    return null;
  }

  /** Record the official result of the current race and build the next round when one completes. */
  recordResult(raceId: string, results: EntrantResult[]): void {
    const race = this.data.rounds.flat().find((r) => r.id === raceId);
    if (!race || race.status === 'done') return;
    race.results = results.filter((r) => race.entrants.includes(r.entrantId)).sort((a, b) => a.place - b.place);
    race.status = 'done';
    const round = this.data.rounds[this.data.rounds.length - 1];
    if (round.every((r) => r.status === 'done')) this.advance(round);
  }

  /** Withdrawn entrants and empty races are skipped automatically. */
  private advance(round: TRace[]): void {
    const kind = round[0].round;
    if (kind === 'final') {
      this.data.status = 'finished';
      return;
    }
    const alive = (id: string) => !this.entrant(id)?.withdrawn;
    const cfg = this.data.config;
    let qualifiers: string[];
    if (kind === 'heat') {
      for (const r of round) r.qualifiers = r.results.map((x) => x.entrantId).filter(alive).slice(0, cfg.heatQualifiers);
      qualifiers = round.flatMap((r) => r.qualifiers);
    } else {
      // semi-finals: an equal share of the final, the rest by fastest time
      const share = Math.floor(cfg.finalSize / round.length);
      for (const r of round) r.qualifiers = r.results.map((x) => x.entrantId).filter(alive).slice(0, share);
      qualifiers = round.flatMap((r) => r.qualifiers);
      const rest = round
        .flatMap((r) => r.results)
        .filter((x) => alive(x.entrantId) && !qualifiers.includes(x.entrantId) && x.time !== null)
        .sort((a, b) => a.time! - b.time!);
      while (qualifiers.length < cfg.finalSize && rest.length) {
        const next = rest.shift()!;
        qualifiers.push(next.entrantId);
        round.find((r) => r.entrants.includes(next.entrantId))!.qualifiers.push(next.entrantId);
      }
    }
    const nextKind: RoundKind = qualifiers.length <= cfg.finalSize || kind === 'semi' ? 'final' : 'semi';
    if (kind === 'heat' && nextKind === 'final') {
      // few entrants: fill the final with the next best (by placing, then time)
      const rest = round
        .flatMap((r) => r.results)
        .filter((x) => alive(x.entrantId) && !qualifiers.includes(x.entrantId))
        .sort((a, b) => a.place - b.place || (a.time ?? 999) - (b.time ?? 999));
      while (qualifiers.length < cfg.finalSize && rest.length) qualifiers.push(rest.shift()!.entrantId);
    }
    // seed the next round so qualifiers from the same race are spread out
    const seeded = [...qualifiers].sort((a, b) => this.placeIn(round, a) - this.placeIn(round, b));
    const next = this.makeRound(nextKind, nextKind === 'final' ? seeded.slice(0, cfg.finalSize) : seeded);
    if (nextKind === 'semi') {
      // deal round-robin so 1st-placed horses are split between semis
      const n = next.length;
      next.forEach((r) => (r.entrants = []));
      seeded.forEach((id, i) => next[i % n].entrants.push(id));
    }
    this.data.rounds.push(next);
  }

  private placeIn(round: TRace[], id: string): number {
    for (const r of round) {
      const res = r.results.find((x) => x.entrantId === id);
      if (res) return res.place * 1000 + (res.time ?? 999);
    }
    return 1e9;
  }

  reset(keepEntrants = true): void {
    this.data.status = 'registration';
    this.data.rounds = [];
    if (!keepEntrants) this.data.entrants = [];
    for (const e of this.data.entrants) e.withdrawn = false;
  }

  /** Where an entrant stands: next race, eliminated, champion… */
  standing(id: string): { state: 'none' | 'waiting' | 'racing-next' | 'eliminated' | 'finalist' | 'champion'; race?: TRace; place?: number } {
    const e = this.entrant(id);
    if (!e) return { state: 'none' };
    const all = this.data.rounds.flat();
    const pending = all.find((r) => r.status === 'pending' && r.entrants.includes(id));
    if (pending) return { state: pending === this.current ? 'racing-next' : 'waiting', race: pending };
    const final = all.find((r) => r.round === 'final' && r.status === 'done');
    if (final?.results[0]?.entrantId === id) return { state: 'champion', race: final, place: 1 };
    if (final?.entrants.includes(id)) return { state: 'finalist', race: final, place: final.results.find((x) => x.entrantId === id)?.place };
    const lastDone = [...all].reverse().find((r) => r.status === 'done' && r.entrants.includes(id));
    if (lastDone && this.data.status !== 'registration') return { state: 'eliminated', race: lastDone, place: lastDone.results.find((x) => x.entrantId === id)?.place };
    return { state: 'waiting' };
  }

  // ------------------------------------------------------------ statistics & awards

  /** Totals per entrant over every race they ran. */
  totals(): Map<string, HorseRaceStats & { races: number; finishes: number }> {
    const out = new Map<string, HorseRaceStats & { races: number; finishes: number }>();
    for (const r of this.data.rounds.flat()) {
      for (const res of r.results) {
        const t = out.get(res.entrantId) ?? { ...emptyStats(), races: 0, finishes: 0 };
        const s = res.stats;
        t.topSpeed = Math.max(t.topSpeed, s.topSpeed);
        t.maxImpact = Math.max(t.maxImpact, s.maxImpact);
        t.maxFatigue = Math.max(t.maxFatigue, s.maxFatigue);
        t.comeback = Math.max(t.comeback, s.comeback);
        t.falls += s.falls;
        t.repairs += s.repairs;
        t.braces += s.braces;
        t.partsLost += s.partsLost;
        t.avgSpeed = (t.avgSpeed * t.races + s.avgSpeed) / (t.races + 1);
        t.races++;
        if (res.time !== null) t.finishes++;
        out.set(res.entrantId, t);
      }
    }
    return out;
  }

  /** 特別賞. Each award goes to the record holder (ties: earliest registrant). */
  awards(): Award[] {
    const totals = [...this.totals().entries()].filter(([id]) => !this.entrant(id)?.withdrawn);
    const best = (score: (t: HorseRaceStats & { races: number; finishes: number }) => number, filter: (t: HorseRaceStats & { races: number; finishes: number }) => boolean = () => true) => {
      let top: [string, number] | null = null;
      for (const [id, t] of totals) {
        if (!filter(t)) continue;
        const v = score(t);
        if (v > 0 && (!top || v > top[1])) top = [id, v];
      }
      return top;
    };
    const kmh = (v: number) => `${Math.round(v * 3.6)}km/h`;
    const champion = this.data.rounds.flat().find((r) => r.round === 'final' && r.status === 'done')?.results[0]?.entrantId ?? null;
    const make = (id: string, title: string, description: string, hit: [string, number] | null, fmt: (v: number) => string): Award => ({
      id, title, description, entrantId: hit?.[0] ?? null, value: hit ? fmt(hit[1]) : '該当なし',
    });
    return [
      { id: 'champion', title: '優勝', description: '決勝1着', entrantId: champion, value: champion ? '🏆' : '-' },
      make('impact', '最大衝撃記録賞', '最も激しくぶつかった', best((t) => t.maxImpact), (v) => `${v.toFixed(1)}m/s`),
      make('repair', '最多修理賞', 'ガムテープで何度でも蘇る', best((t) => t.repairs), (v) => `${v}回`),
      make('fall', '七転び八起き賞', '最も多く転んだ', best((t) => t.falls), (v) => `${v}回`),
      make('speed', '最速記録賞', '大会最高速度', best((t) => t.topSpeed), kmh),
      make('brace', '踏ん張り王', '最も多く踏ん張った', best((t) => t.braces), (v) => `${v}回`),
      make('comeback', '大逆転賞', '最も順位を上げた', best((t) => t.comeback), (v) => `${v}人抜き`),
      make('parts', '部品紛失賞', '最も多くパーツを落とした', best((t) => t.partsLost), (v) => `${v}個`),
      make('fatigue', '満身創痍賞', '構造疲労の最高記録', best((t) => t.maxFatigue), (v) => `${Math.round(v * 100)}%`),
      // slowest average speed, but never fell and always finished
      make('turtle', '亀さん賞', '遅くても、転ばず、最後まで走った', best((t) => 30 - t.avgSpeed, (t) => t.falls === 0 && t.finishes === t.races), (v) => kmh(30 - v)),
    ];
  }

  view(): TournamentView {
    const d = this.data;
    return {
      name: d.config.name,
      status: d.status,
      heatQualifiers: d.config.heatQualifiers,
      finalSize: d.config.finalSize,
      entrants: d.entrants.map((e) => ({ id: e.id, jockey: e.jockey, horseName: e.horseName, nickname: e.nickname, cpu: e.cpu, withdrawn: e.withdrawn })),
      rounds: d.rounds.map((round) => ({
        kind: round[0]?.round ?? 'heat',
        label: ROUND_LABEL[round[0]?.round ?? 'heat'],
        races: round.map((r) => ({
          id: r.id, label: r.label, entrants: r.entrants, status: r.status,
          results: r.results.map((x) => ({ entrantId: x.entrantId, place: x.place, time: x.time })), qualifiers: r.qualifiers,
        })),
      })),
      currentRaceId: this.current?.id ?? null,
      awards: d.status === 'finished' ? this.awards() : [],
    };
  }
}

/** Client-side: where an entrant stands, from the public view. */
export function viewStanding(v: TournamentView, entrantId: string | null): { text: string; mine: string | null; next: boolean } {
  if (!entrantId) return { text: '', mine: null, next: false };
  const races = v.rounds.flatMap((r) => r.races);
  if (v.status === 'registration') return { text: `${v.name} にエントリー済み（組分け待ち）`, mine: races.find((r) => r.entrants.includes(entrantId))?.label ?? null, next: false };
  const pending = races.filter((r) => r.status === 'pending');
  const mine = pending.find((r) => r.entrants.includes(entrantId));
  if (mine) {
    const ahead = pending.indexOf(mine);
    return {
      text: ahead === 0 ? `次はあなたの出走！ ${mine.label}` : `${mine.label} に出走（あと${ahead}レース後）`,
      mine: mine.label,
      next: ahead === 0,
    };
  }
  const done = [...races].reverse().find((r) => r.entrants.includes(entrantId));
  const place = done?.results.find((x) => x.entrantId === entrantId)?.place;
  if (done?.label === ROUND_LABEL.final && v.status === 'finished') return { text: place === 1 ? '🏆 優勝おめでとうございます！' : `決勝 ${place}着`, mine: null, next: false };
  if (done && v.status === 'running' && done.qualifiers.length && !done.qualifiers.includes(entrantId)) return { text: `${done.label} ${place}着 — 敗退。お疲れさまでした`, mine: null, next: false };
  if (done) return { text: `${done.label} ${place ?? '-'}着 — 次のラウンドの組分け待ち`, mine: null, next: false };
  return { text: '大会進行中', mine: null, next: false };
}

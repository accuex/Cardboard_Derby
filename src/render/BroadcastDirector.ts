import * as THREE from 'three';
import type { CameraConfig, ShotDef, ShotRule } from '../config/camera';
import type { RaceConfig } from '../config/race';
import { damp } from '../core/rng';
import type { Course } from '../sim/Course';
import type { HorseState, RaceState } from '../sim/types';
import type { ReplaySegment } from '../game/Replay';
import { reducedMotion } from '../ui/prefs';
import { venueLayout } from './layout';
import { paradePose, paradeWalk } from './parade';

import type { FlowPhase } from '../game/phase';
export type { FlowPhase };

const UP_HORSE = 1.6;

/**
 * TV-style race director: chooses shots from rules, cuts between them,
 * and frames the leading group with telephoto lenses.
 */
export class BroadcastDirector {
  /** Runners in the race (centres the gate shot). */
  fieldSize = 6;
  readonly camera: THREE.PerspectiveCamera;
  /** Point the action is centred on (also used for shadows/crowd). */
  readonly focus = new THREE.Vector3();
  private currentId = '';
  private shotTime = 0;
  private flowTime = 0;
  private readonly lookAt = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private fov = 40;
  private cut = true;
  private focusS = 0;
  private fieldRadius = 10;
  onShotChange: ((label: string) => void) | null = null;
  /** Live accident cut-away. */
  private crash: { id: number; until: number } | null = null;
  private lastEventSeq = 0;
  private clock = 0;
  private shake = 0;
  private specialKey = '';
  private specialLabel = '';

  constructor(
    private readonly course: Course,
    private readonly cfg: CameraConfig,
    private readonly race: RaceConfig,
    aspect: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.5, 6000);
  }

  get shotLabel(): string {
    return this.specialKey ? this.specialLabel : (this.cfg.shots[this.currentId]?.label ?? '');
  }

  /** Extra context for the special shots. */
  paddockIndex = 0;
  paddockSeconds = 2.8;
  replaySegment: ReplaySegment | null = null;
  replayTime = 0;

  update(state: RaceState, phase: FlowPhase, phaseTime: number, dt: number): void {
    this.flowTime = phaseTime;
    this.clock += dt;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    if (phase === 'paddock') return this.paddockShot(state, dt);
    if (phase === 'replay' && this.replaySegment) return this.replayShot(state, dt);
    this.watchAccidents(state, phase);
    if (this.crash && this.clock < this.crash.until) return this.crashShot(state, dt);
    this.crash = null;
    if (this.specialKey) {
      // back to the regular coverage
      this.specialKey = '';
      this.currentId = '';
    }
    this.computeFocus(state, phase);
    const shotPhase: ShotRule['phase'] = phase === 'results' || phase === 'replay' ? 'finish' : phase === 'build' ? 'intro' : (phase as ShotRule['phase']);
    const leader = this.leader(state);
    const remaining = leader ? Math.max(0, state.distance - leader.progress) : state.distance;
    const nextId = this.pickShot(shotPhase, state, leader, remaining);
    if (nextId !== this.currentId) {
      this.currentId = nextId;
      this.shotTime = 0;
      this.cut = true;
      this.onShotChange?.(this.shotLabel);
    } else {
      this.shotTime += dt;
    }
    this.applyShot(this.cfg.shots[this.currentId], state, dt);
  }

  // ---------------------------------------------------------------- special shots

  private setSpecial(key: string, label: string): boolean {
    if (this.specialKey === key) return false;
    this.specialKey = key;
    this.specialLabel = label;
    this.cut = true;
    this.onShotChange?.(label);
    return true;
  }

  /** 出走馬紹介: close-up of each horse in the parade with a slow dolly. */
  private paddockShot(state: RaceState, dt: number): void {
    const i = this.paddockIndex;
    const h = state.horses[i];
    this.setSpecial(`paddock-${i}`, `出走馬紹介 ${h.gate}番`);
    const p = paradePose(this.course, state.startS, i, state.horses.length, paradeWalk(this.flowTime));
    const local = this.flowTime - i * this.paddockSeconds;
    const along = 4.5 - local * 0.6;
    this.desiredPos.set(p.x + p.normalX * 9 + p.dirX * along, 2.1 + local * 0.08, p.z + p.normalZ * 9 + p.dirZ * along);
    this.desiredLook.set(p.x + p.dirX * 0.3, 1.45, p.z + p.dirZ * 0.3);
    this.focus.set(p.x, 1.6, p.z);
    this.finish(30, 6, dt);
  }

  /** Live cut-away when a horse near the front (or the player) crashes. */
  private watchAccidents(state: RaceState, phase: FlowPhase): void {
    for (const ev of state.events) {
      if (ev.seq <= this.lastEventSeq) continue;
      this.lastEventSeq = ev.seq;
      if (phase !== 'running' || (ev.type !== 'fall' && ev.type !== 'partLost')) continue;
      const h = state.horses[ev.horseId];
      const leader = state.horses[state.order[0]];
      const remaining = state.distance - leader.progress;
      if (ev.type === 'fall' && !reducedMotion()) this.shake = 1;
      if (remaining < 150 || this.crash) continue;
      if (h.isPlayer || h.rank <= 3 || ev.type === 'partLost') this.crash = { id: h.id, until: this.clock + 3.2 };
    }
  }

  private crashShot(state: RaceState, dt: number): void {
    const h = state.horses[this.crash!.id];
    this.setSpecial(`crash-${h.id}`, 'アクシデント');
    const p = this.course.sample(h.courseS, h.lateral);
    // low camera on the outside, slightly ahead, looking back at the wreck
    this.desiredPos.set(h.x + p.normalX * 8 + p.dirX * 6, 2, h.z + p.normalZ * 8 + p.dirZ * 6);
    this.desiredLook.set(h.x, 0.9, h.z);
    this.focus.set(h.x, 1, h.z);
    this.finish(26, 5, dt);
  }

  private replayShot(state: RaceState, dt: number): void {
    const seg = this.replaySegment!;
    const h = state.horses[seg.focusId];
    const p = this.course.sample(h.courseS, h.lateral);
    const length = (seg.to - seg.from) / seg.speed;
    const W = this.course.config.trackWidth;
    if (seg.kind === 'goal' && this.replayTime < length * 0.55) {
      this.setSpecial('replay-headon', 'リプレイ 正面');
      this.desiredPos.set(h.x + p.dirX * 18 + p.normalX * 1.5, 1.3, h.z + p.dirZ * 18 + p.normalZ * 1.5);
      this.desiredLook.set(h.x, 1.3, h.z);
      this.focus.set(h.x, 1.4, h.z);
      this.finish(20, 8, dt);
    } else if (seg.kind === 'goal') {
      this.setSpecial('replay-line', 'リプレイ 決勝線');
      const f = this.course.sample(this.course.finishS, W + 6);
      this.desiredPos.set(f.x, 1.6, f.z);
      this.desiredLook.set(h.x, 1.3, h.z);
      this.focus.set(h.x, 1.4, h.z);
      this.finish(14, 100, dt);
    } else {
      this.setSpecial(`replay-crash-${seg.from}`, 'リプレイ アクシデント');
      const a = this.replayTime * 0.35;
      const ox = p.normalX * Math.cos(a) + p.dirX * Math.sin(a);
      const oz = p.normalZ * Math.cos(a) + p.dirZ * Math.sin(a);
      this.desiredPos.set(h.x + ox * 7, 1.4, h.z + oz * 7);
      this.desiredLook.set(h.x, 1, h.z);
      this.focus.set(h.x, 1, h.z);
      this.finish(34, 5, dt);
    }
  }

  /** Shared camera update for special shots. */
  private finish(fov: number, stiffness: number, dt: number): void {
    const cam = this.camera;
    if (this.cut) {
      cam.position.copy(this.desiredPos);
      this.lookAt.copy(this.desiredLook);
      this.fov = fov;
      this.cut = false;
    } else {
      cam.position.lerp(this.desiredPos, damp(stiffness, dt));
      this.lookAt.lerp(this.desiredLook, damp(8, dt));
      this.fov += (fov - this.fov) * damp(3, dt);
    }
    this.applyLens();
  }

  /** FOV, aim and crash shake. */
  private applyLens(): void {
    const cam = this.camera;
    cam.fov = this.fov;
    cam.lookAt(this.lookAt);
    if (this.shake > 0) {
      const k = this.shake * this.shake * 0.02;
      cam.rotation.x += (Math.random() - 0.5) * k;
      cam.rotation.y += (Math.random() - 0.5) * k;
    }
    cam.updateProjectionMatrix();
  }

  private leader(state: RaceState): HorseState | null {
    for (const id of state.order) {
      const h = state.horses[id];
      if (!h.finished) return h;
    }
    return state.horses[state.order[0]] ?? null;
  }

  private pickShot(phase: ShotRule['phase'], state: RaceState, leader: HorseState | null, remaining: number): string {
    const holdOk = this.shotTime >= this.cfg.minShotSeconds;
    for (const rule of this.cfg.rules) {
      if (rule.phase !== phase) continue;
      if (!this.matches(rule, state, leader, remaining)) continue;
      if (rule.shot === this.currentId) return rule.shot;
      // A phase change always cuts; inside a phase respect the minimum shot length.
      const samePhase = this.currentRulePhase(phase);
      if (!samePhase || holdOk || rule.force) return rule.shot;
      return this.currentId;
    }
    return this.currentId;
  }

  private currentRulePhase(phase: ShotRule['phase']): boolean {
    return this.cfg.rules.some((r) => r.shot === this.currentId && r.phase === phase);
  }

  private matches(rule: ShotRule, state: RaceState, leader: HorseState | null, remaining: number): boolean {
    if (rule.timeMax !== undefined && state.time > rule.timeMax) return false;
    if (!leader) return rule.segment === undefined;
    const seg = this.course.segmentAt(leader.courseS);
    if (rule.segment !== undefined && seg.index !== rule.segment) return false;
    const frac = this.course.segmentFraction(leader.courseS);
    if (rule.fractionMin !== undefined && frac < rule.fractionMin) return false;
    if (rule.fractionMax !== undefined && frac > rule.fractionMax) return false;
    if (rule.remainingMin !== undefined && remaining < rule.remainingMin) return false;
    if (rule.remainingMax !== undefined && remaining > rule.remainingMax) return false;
    if (rule.finalLap && remaining > this.course.finishS + 1) return false;
    return true;
  }

  /** Focus: leading group centroid in course space, plus the spread of the field. */
  private computeFocus(state: RaceState, phase: FlowPhase): void {
    const hs = state.horses;
    let s = 0;
    let lat = 0;
    let w = 0;
    const winnerId = state.finishOrder[0];
    const focusWinner = (phase === 'finish' || phase === 'results') && winnerId !== undefined;
    if (focusWinner) {
      const h = hs[winnerId];
      s = h.progress;
      lat = h.lateral;
      w = 1;
    } else {
      const k = Math.max(2, Math.ceil(hs.length / 2));
      state.order.slice(0, k).forEach((id, i) => {
        const h = hs[id];
        const weight = i === 0 ? 2 : 1;
        s += h.progress * weight;
        lat += h.lateral * weight;
        w += weight;
      });
    }
    s /= w;
    lat /= w;
    // Spread of the leading group for framing (stragglers may drop out of shot, like on TV)
    let spread = 0;
    if (!focusWinner) {
      const k = Math.min(hs.length, Math.ceil(hs.length / 2) + 1);
      for (const id of state.order.slice(0, k)) spread = Math.max(spread, Math.abs(hs[id].progress - s));
    }
    this.fieldRadius = THREE.MathUtils.clamp(spread, 4, 12);
    this.focusS = state.startS + s;
    const p = this.course.sample(this.focusS, lat);
    this.focus.set(p.x, UP_HORSE, p.z);
  }

  private coursePoint(s: number, lateral: number, height: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.course.sample(s, lateral);
    return out.set(p.x, height, p.z);
  }

  private applyShot(shot: ShotDef, _state: RaceState, dt: number): void {
    const cam = this.camera;
    let stiffness = shot.stiffness ?? 4;
    switch (shot.type) {
      case 'orbit': {
        const o = this.cfg.orbit;
        const lay = venueLayout(this.course);
        const [cx, cy, cz] = lay.orbitCenter;
        const a = o.startAngle + this.flowTime * o.speed;
        this.desiredPos.set(cx + Math.cos(a) * lay.orbitRadius, o.height - this.flowTime * 4, cz + Math.sin(a) * lay.orbitRadius);
        this.desiredLook.set(cx, cy, cz);
        stiffness = 100;
        break;
      }
      case 'gate': {
        const startS = this.course.wrap(this.course.finishS - this.race.distance);
        const gateMid = this.race.gateFirstLateral + (this.race.gateSpacing * (this.fieldSize - 1)) / 2;
        const push = this.flowTime * 1.5;
        this.coursePoint(startS + 24 - push, gateMid + 14, 2.6, this.desiredPos);
        this.coursePoint(startS, gateMid, 1.6, this.desiredLook);
        stiffness = 100;
        break;
      }
      case 'follow':
      case 'headOn': {
        this.coursePoint(this.focusS + (shot.along ?? 0), shot.lateral ?? 0, shot.height ?? 5, this.desiredPos);
        this.desiredLook.copy(this.focus);
        if (shot.type === 'headOn') this.desiredLook.y = 1.2;
        break;
      }
      case 'fixed': {
        const at = shot.at!;
        this.coursePoint(this.course.sAt(at.segment, at.fraction), at.lateral, at.height, this.desiredPos);
        this.desiredLook.copy(this.focus);
        break;
      }
    }

    let fov = shot.fov ?? this.autoFov(shot);
    if (this.cut) {
      cam.position.copy(this.desiredPos);
      this.lookAt.copy(this.desiredLook);
      this.fov = fov;
      this.cut = false;
    } else {
      const k = damp(stiffness, dt);
      cam.position.lerp(this.desiredPos, k);
      this.lookAt.lerp(this.desiredLook, damp(6, dt));
      fov = this.fov + (fov - this.fov) * damp(2.5, dt);
      this.fov = fov;
    }
    this.applyLens();
  }

  /** Telephoto framing: pick a vertical FOV that keeps the field across the frame. */
  private autoFov(shot: ShotDef): number {
    const dist = this.desiredPos.distanceTo(this.focus);
    const halfW = this.fieldRadius * (shot.frameScale ?? 1.3) + 3;
    const hHalf = Math.atan(halfW / Math.max(dist, 1));
    const vFov = 2 * Math.atan(Math.tan(hHalf) / this.camera.aspect);
    return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(vFov), shot.minFov ?? 8, shot.maxFov ?? 45);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  reset(): void {
    this.currentId = '';
    this.shotTime = 0;
    this.cut = true;
    this.crash = null;
    this.lastEventSeq = 0;
    this.specialKey = '';
    this.shake = 0;
  }
}

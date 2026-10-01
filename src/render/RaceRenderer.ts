import * as THREE from 'three';
import { cameraConfig } from '../config/camera';
import type { RaceConfig } from '../config/race';
import { renderConfig } from '../config/render';
import type { Course } from '../sim/Course';
import type { RaceState } from '../sim/types';
import { BroadcastDirector, type FlowPhase } from './BroadcastDirector';
import { Environment } from './Environment';
import { BigScreen, Grandstand, StartingGate } from './Facilities';
import { HorseView } from './HorseView';
import { Dust } from './Dust';
import { buildTrack } from './TrackBuilder';
import { paradePose, paradeWalk } from './parade';

/** Owns the Three.js scene. Reads RaceState, never writes it. */
export class RaceRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly director: BroadcastDirector;
  private readonly env: Environment;
  private readonly stand: Grandstand;
  private readonly screen: BigScreen;
  private gate: StartingGate | null = null;
  private horses: HorseView[] = [];
  private readonly horseGroup = new THREE.Group();
  /** Parts that fell off, bouncing then lying on the turf. */
  private readonly debrisGroup = new THREE.Group();
  private debris: { obj: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; resting: boolean }[] = [];
  private lastEventSeq = 0;
  private readonly dust = new Dust(renderConfig.particles);
  /** Adaptive resolution: smoothed frame time and the current pixel ratio. */
  private frameMs = 16;
  private slowFor = 0;
  private fastFor = 0;
  private pixelRatio = Math.min(window.devicePixelRatio, renderConfig.maxPixelRatio);
  private clock = 0;
  /** Chase camera behind the local player's horse (picture-in-picture). */
  private readonly chase = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 4000);
  private readonly chaseLook = new THREE.Vector3();
  private chaseReady = false;
  /** When true the chase view is full screen and the broadcast goes into the PiP. */
  swapViews = false;
  /** 'chase': the phone controller view — only our own horse, full screen, no picture-in-picture. */
  viewMode: 'broadcast' | 'chase' = 'broadcast';
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly course: Course,
    private readonly race: RaceConfig,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: renderConfig.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, renderConfig.maxPixelRatio));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = renderConfig.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.director = new BroadcastDirector(course, cameraConfig, race, container.clientWidth / container.clientHeight);
    this.env = new Environment(this.scene, course);
    this.scene.add(buildTrack(course, race.distance));
    this.stand = new Grandstand(course);
    this.scene.add(this.stand.group);
    this.screen = new BigScreen(race, course);
    this.scene.add(this.screen.group);
    this.scene.add(this.horseGroup);
    this.scene.add(this.debrisGroup);
    this.scene.add(this.dust.points);

    // Follow the container (full window on the big screen, a panel on phones)
    this.resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h);
      this.director.resize(w / h);
    });
    this.resizeObserver.observe(container);
  }

  /** (Re)create horse views for a new race. */
  setRace(state: RaceState): void {
    for (const v of this.horses) this.horseGroup.remove(v.object);
    this.horses = state.horses.map((h) => new HorseView(h));
    for (const v of this.horses) this.horseGroup.add(v.object);
    if (this.gate) this.scene.remove(this.gate.group);
    this.gate = new StartingGate(this.course, this.race, state.horses.length, state.startS);
    this.scene.add(this.gate.group);
    this.director.fieldSize = state.horses.length;
    this.director.reset();
    this.paradeState = null;
    this.chaseReady = false;
    this.debrisGroup.clear();
    this.debris = [];
    this.dust.reset();
    this.lastEventSeq = 0;
  }

  /** Free the GPU resources and remove the canvas (the TV mode builds a new view per race). */
  dispose(): void {
    this.resizeObserver.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  openGate(): void {
    this.gate?.open();
  }

  /** Before the start the horses parade in front of the gate (presentation only). */
  private paradeState: RaceState | null = null;

  private parade(state: RaceState, phase: FlowPhase, phaseTime: number): RaceState {
    if (!this.paradeState || this.paradeState.horses.length !== state.horses.length) this.paradeState = structuredClone(state);
    const ps = this.paradeState;
    const walk = phase === 'paddock' ? paradeWalk(phaseTime) : 0;
    ps.horses.forEach((h, i) => {
      const p = paradePose(this.course, state.startS, i, state.horses.length, walk);
      h.x = p.x;
      h.z = p.z;
      h.dirX = p.dirX;
      h.dirZ = p.dirZ;
      h.speed = phase === 'paddock' ? 1.6 : 0;
      h.status = 'running';
      h.roll = 0;
    });
    ps.events = state.events;
    return ps;
  }

  render(liveState: RaceState, phase: FlowPhase, phaseTime: number, dt: number): void {
    this.clock += dt;
    const state = phase === 'build' || phase === 'intro' || phase === 'paddock' ? this.parade(liveState, phase, phaseTime) : liveState;
    state.horses.forEach((h, i) => this.horses[i]?.update(h, dt, this.clock));
    this.spawnDebris(state);
    this.updateDebris(dt);
    this.dust.setViewportHeight(this.renderer.domElement.height);
    this.dust.update(state, dt, true);
    this.adaptResolution(dt);
    this.gate?.update(dt);
    this.director.update(state, phase, phaseTime, dt);
    this.env.follow(this.director.focus);

    // Crowd excitement rises as the leaders approach the line
    const leader = state.horses[state.order[0]];
    const remaining = state.distance - leader.progress;
    let excite = 0.1;
    if (phase === 'running') excite = remaining < 400 ? 0.4 + 0.6 * (1 - remaining / 400) : 0.25;
    else if (phase === 'finish') excite = 1;
    else if (phase === 'results') excite = 0.5;
    this.stand.update(this.clock, excite);
    this.screen.update(state, phase, this.clock);

    const player = state.horses.find((h) => h.isPlayer);
    const w = this.container.clientWidth;
    const hgt = this.container.clientHeight;
    const r = this.renderer;
    if (!player) {
      r.setScissorTest(false);
      r.setViewport(0, 0, w, hgt);
      r.render(this.scene, this.director.camera);
      return;
    }
    this.updateChase(player, dt);
    if (this.viewMode === 'chase') {
      const racing = phase === 'gate' || phase === 'running' || phase === 'finish';
      const cam = racing ? this.chase : this.director.camera;
      this.setAspect(cam, w / hgt);
      r.setScissorTest(false);
      r.setViewport(0, 0, w, hgt);
      r.render(this.scene, cam);
      return;
    }
    const main = this.swapViews ? this.chase : this.director.camera;
    const pip = this.swapViews ? this.director.camera : this.chase;
    this.setAspect(main, w / hgt);
    r.setScissorTest(false);
    r.setViewport(0, 0, w, hgt);
    r.render(this.scene, main);
    if (phase === 'intro' || phase === 'build' || phase === 'paddock' || phase === 'replay') return;
    const rect = pipRect(w);
    this.setAspect(pip, rect.w / rect.h);
    r.setScissorTest(true);
    r.setScissor(rect.x, rect.y, rect.w, rect.h);
    r.setViewport(rect.x, rect.y, rect.w, rect.h);
    r.render(this.scene, pip);
    r.setScissorTest(false);
    this.setAspect(this.director.camera, w / hgt);
  }

  /** Keep the frame rate up by trading resolution (0.6x .. preset max). */
  private adaptResolution(dt: number): void {
    if (!renderConfig.adaptiveResolution || dt <= 0) return;
    this.frameMs = this.frameMs * 0.95 + dt * 1000 * 0.05;
    const max = Math.min(window.devicePixelRatio, renderConfig.maxPixelRatio);
    if (this.frameMs > 24) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.frameMs < 17.5) {
      this.fastFor += dt;
      this.slowFor = 0;
    }
    let next = this.pixelRatio;
    if (this.slowFor > 2 && this.pixelRatio > 0.6) next = Math.max(0.6, this.pixelRatio - 0.15);
    else if (this.fastFor > 6 && this.pixelRatio < max) next = Math.min(max, this.pixelRatio + 0.1);
    if (next !== this.pixelRatio) {
      this.pixelRatio = next;
      this.slowFor = 0;
      this.fastFor = 0;
      this.renderer.setPixelRatio(next);
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }
  }

  /** Current drawing resolution scale (for the settings panel). */
  get resolutionScale(): number {
    return this.pixelRatio;
  }

  private spawnDebris(state: RaceState): void {
    for (const ev of state.events) {
      if (ev.seq <= this.lastEventSeq) continue;
      this.lastEventSeq = ev.seq;
      if (ev.type !== 'partLost' || !ev.part) continue;
      const h = state.horses[ev.horseId];
      const obj = this.horses[ev.horseId].spawnDebris(ev.part);
      const vel = new THREE.Vector3(h.dirX * h.speed * 0.6, 3 + Math.random() * 2, h.dirZ * h.speed * 0.6);
      const spin = new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
      this.debrisGroup.add(obj);
      this.debris.push({ obj, vel, spin, resting: false });
      if (this.debris.length > 40) this.debrisGroup.remove(this.debris.shift()!.obj);
    }
  }

  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      if (d.resting) continue;
      d.vel.y -= 9.8 * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.y += d.spin.y * dt;
      d.obj.rotation.z += d.spin.z * dt;
      if (d.obj.position.y <= 0.15 && d.vel.y < 0) {
        d.vel.y *= -0.3;
        d.vel.x *= 0.5;
        d.vel.z *= 0.5;
        d.spin.multiplyScalar(0.5);
        d.obj.position.y = 0.15;
        if (Math.abs(d.vel.y) < 0.6) {
          // settle lying on its side
          d.resting = true;
          d.obj.rotation.set(Math.PI / 2, d.obj.rotation.y, 0);
          d.obj.position.y = 0.12;
        }
      }
    }
  }

  private setAspect(cam: THREE.PerspectiveCamera, aspect: number): void {
    if (Math.abs(cam.aspect - aspect) > 1e-3) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
  }

  private updateChase(h: RaceState['horses'][number], dt: number): void {
    const back = 8.5;
    const desired = new THREE.Vector3(h.x - h.dirX * back, 3.6, h.z - h.dirZ * back);
    const look = new THREE.Vector3(h.x + h.dirX * 10, 1.3, h.z + h.dirZ * 10);
    if (!this.chaseReady) {
      this.chase.position.copy(desired);
      this.chaseLook.copy(look);
      this.chaseReady = true;
    } else {
      this.chase.position.lerp(desired, Math.min(1, dt * 5));
      this.chaseLook.lerp(look, Math.min(1, dt * 8));
    }
    this.chase.lookAt(this.chaseLook);
  }
}

/** Picture-in-picture rectangle (CSS pixels, origin bottom-left), mirrored by .pip-frame in CSS. */
export function pipRect(w: number): { x: number; y: number; w: number; h: number } {
  const pw = Math.round(Math.min(w * 0.3, 520));
  const ph = Math.round((pw * 9) / 16);
  return { x: w - pw - 20, y: 20, w: pw, h: ph };
}

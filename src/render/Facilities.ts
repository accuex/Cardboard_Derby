import { raceTitle } from '../ui/format';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gateColors } from '../config/horses';
import type { RaceConfig } from '../config/race';
import { renderConfig } from '../config/render';
import { Rng } from '../core/rng';
import type { Course } from '../sim/Course';
import type { HorseState, RaceState } from '../sim/types';
import { venueLayout } from './layout';
import { concreteTexture, labelTexture, windowsTexture } from './textures';

const ROW_DEPTH = 1.2;
const ROW_RISE = 0.6;

/** Grandstand along the home straight with an animated crowd. */
export class Grandstand {
  readonly group = new THREE.Group();
  private readonly crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0.1 } };

  constructor(course: Course) {
    const lay = venueLayout(course);
    const cfg = { ...renderConfig.stand, xFrom: lay.standFrom, xTo: lay.standTo };
    const R = course.config.cornerRadius;
    const railZ = R + course.config.trackWidth;
    const z0 = railZ + cfg.setback;
    const xLen = cfg.xTo - cfg.xFrom;
    const xMid = (cfg.xTo + cfg.xFrom) / 2;
    const rows = renderConfig.crowd.rows;

    // Apron between rail and stand
    const conc = concreteTexture();
    conc.repeat.set(xLen / 8, 2);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(xLen + 40, cfg.setback - 1.5), new THREE.MeshLambertMaterial({ map: conc }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(xMid, 0.01, railZ + 1.5 + (cfg.setback - 1.5) / 2);
    apron.receiveShadow = true;
    this.group.add(apron);

    // Tiered seating
    const seatMat = new THREE.MeshLambertMaterial({ color: '#8d9399' });
    const stepGeos: THREE.BufferGeometry[] = [];
    for (let r = 0; r < rows; r++) {
      const h = 1.2 + r * ROW_RISE;
      const g = new THREE.BoxGeometry(xLen, h, ROW_DEPTH);
      g.translate(xMid, h / 2, z0 + r * ROW_DEPTH + ROW_DEPTH / 2);
      stepGeos.push(g);
    }
    const steps = new THREE.Mesh(mergeGeometries(stepGeos), seatMat);
    steps.receiveShadow = true;
    this.group.add(steps);

    // Front wall
    const wall = new THREE.Mesh(new THREE.BoxGeometry(xLen, 1.3, 0.3), new THREE.MeshLambertMaterial({ color: '#2d5f3a' }));
    wall.position.set(xMid, 0.65, z0 - 0.15);
    this.group.add(wall);

    // Main building behind the stand
    const backZ = z0 + rows * ROW_DEPTH;
    const bh = 30;
    const win = windowsTexture();
    win.repeat.set(xLen / 30, 3);
    const buildingMat = new THREE.MeshLambertMaterial({ color: '#e3e6ea' });
    const building = new THREE.Mesh(new THREE.BoxGeometry(xLen + 10, bh, 16), [
      buildingMat, buildingMat, buildingMat, buildingMat, buildingMat,
      new THREE.MeshLambertMaterial({ map: win }),
    ]);
    building.position.set(xMid, bh / 2, backZ + 8);
    building.castShadow = true;
    this.group.add(building);
    // Cantilever roof
    const roofDepth = rows * ROW_DEPTH + 6;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(xLen + 6, 0.6, roofDepth), new THREE.MeshLambertMaterial({ color: '#f4f5f7' }));
    roof.position.set(xMid, bh - 4, backZ - roofDepth / 2 + 2);
    roof.rotation.x = -0.08;
    roof.castShadow = true;
    this.group.add(roof);
    const colMat = new THREE.MeshLambertMaterial({ color: '#c8ccd0' });
    for (let x = cfg.xFrom; x <= cfg.xTo; x += 40) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, bh - 4, 0.6), colMat);
      col.position.set(x, (bh - 4) / 2, backZ - 1);
      this.group.add(col);
    }

    // Name banner on the roof edge
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 4.5),
      new THREE.MeshBasicMaterial({ map: labelTexture(course.config.venueName, { bg: '#123a7a', fg: '#ffd84a', w: 2048, h: 102, font: '900 76px "Noto Serif JP", serif' }) }),
    );
    banner.position.set(Math.min(xMid + 60, cfg.xTo - 50), bh - 1.2, backZ - roofDepth + 1.4);
    this.group.add(banner);

    this.group.add(this.createCrowd(z0, cfg.xFrom, cfg.xTo, railZ, lay.finishX));
  }

  private createCrowd(z0: number, xFrom: number, xTo: number, railZ: number, finishX: number): THREE.InstancedMesh {
    const c = renderConfig.crowd;
    const rng = new Rng(2024);
    const body = new THREE.BoxGeometry(0.5, 0.75, 0.32);
    body.translate(0, 0.38, 0);
    const head = new THREE.BoxGeometry(0.28, 0.3, 0.28);
    head.translate(0, 0.92, 0);
    const person = mergeGeometries([body, head])!;

    const positions: THREE.Vector3[] = [];
    for (let r = 0; r < c.rows; r++) {
      const y = 1.2 + r * ROW_RISE;
      const z = z0 + r * ROW_DEPTH + ROW_DEPTH * 0.55;
      for (let x = xFrom + 1; x < xTo - 1; x += c.spacing) {
        if (rng.next() < c.occupancy) positions.push(new THREE.Vector3(x + rng.range(-0.15, 0.15), y, z));
      }
    }
    // Standing crowd on the apron near the finish
    for (let i = 0; i < c.apronPeople; i++) {
      positions.push(new THREE.Vector3(rng.range(Math.max(xFrom, finishX - 150), Math.min(xTo, finishX + 50)), 0, rng.range(railZ + 2.5, z0 - 1)));
    }

    const mat = new THREE.MeshLambertMaterial();
    const uniforms = this.crowdUniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uExcite = uniforms.uExcite;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPhase;\nuniform float uTime;\nuniform float uExcite;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed.y += uExcite * abs(sin(uTime * (5.0 + aPhase * 3.0) + aPhase * 17.0)) * 0.35;',
        );
    };
    const mesh = new THREE.InstancedMesh(person, mat, positions.length);
    const phases = new Float32Array(positions.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    const shirt = ['#e74c3c', '#3498db', '#f1c40f', '#ecf0f1', '#2ecc71', '#9b59b6', '#34495e', '#e67e22', '#1abc9c', '#fdfdfd'];
    positions.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(-0.4, 0.4));
      const s = rng.range(0.9, 1.1);
      m.compose(p, q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(shirt[Math.floor(rng.next() * shirt.length)]));
      phases[i] = rng.next();
    });
    person.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    return mesh;
  }

  /** excitement: 0 = calm, 1 = going wild. */
  update(time: number, excitement: number): void {
    this.crowdUniforms.uTime.value = time;
    this.crowdUniforms.uExcite.value += (0.08 + excitement * 0.92 - this.crowdUniforms.uExcite.value) * 0.05;
  }
}

/** Infield LED board showing the running order. */
export class BigScreen {
  readonly group = new THREE.Group();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastDraw = -1;

  constructor(private readonly race: RaceConfig, course: Course) {
    const lay = venueLayout(course);
    const cfg = { ...renderConfig.bigScreen, x: lay.screenX, z: lay.screenZ };
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 360;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    const frame = new THREE.Mesh(new THREE.BoxGeometry(cfg.width + 1.6, cfg.height + 1.6, 1.2), new THREE.MeshLambertMaterial({ color: '#2a2d33' }));
    frame.castShadow = true;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(cfg.width, cfg.height), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    screen.position.z = 0.62;
    const legMat = new THREE.MeshLambertMaterial({ color: '#555b63' });
    for (const x of [-cfg.width / 3, cfg.width / 3]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1, cfg.elevation + cfg.height / 2, 1), legMat);
      leg.position.set(x, -(cfg.elevation + cfg.height / 2) / 2, -0.2);
      this.group.add(leg);
    }
    this.group.add(frame, screen);
    this.group.position.set(cfg.x, cfg.elevation + cfg.height / 2, cfg.z);
  }

  update(state: RaceState, flowPhase: string, wallTime: number): void {
    if (wallTime - this.lastDraw < 0.3) return;
    this.lastDraw = wallTime;
    const ctx = this.ctx;
    const W = 1024;
    const H = 360;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#0f2b5c';
    ctx.fillRect(0, 0, W, 70);
    ctx.fillStyle = '#ffd84a';
    ctx.font = '900 46px "Noto Sans JP", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(raceTitle(this.race, true), 24, 37, W - 260);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    const label = flowPhase === 'results' || state.phase === 'finished' ? '確定' : state.phase === 'running' ? formatClock(state.time) : '発走前';
    ctx.fillText(label, W - 24, 37);

    const horses = state.order.slice(0, 6).map((id) => state.horses[id]);
    const colW = W / 3;
    horses.forEach((h, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = col * colW + 20;
      const y = 120 + row * 130;
      drawRankEntry(ctx, h, i + 1, x, y, colW - 40);
    });
    this.texture.needsUpdate = true;
  }
}

function drawRankEntry(ctx: CanvasRenderingContext2D, h: HorseState, rank: number, x: number, y: number, w: number): void {
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffb000';
  ctx.font = '900 64px "Noto Sans JP", sans-serif';
  ctx.fillText(String(rank), x, y);
  const gc = gateColors[(h.gate - 1) % gateColors.length];
  ctx.fillStyle = gc.bg;
  ctx.fillRect(x + 52, y - 30, 60, 60);
  ctx.fillStyle = gc.fg;
  ctx.textAlign = 'center';
  ctx.font = '900 48px "Noto Sans JP", sans-serif';
  ctx.fillText(String(h.gate), x + 82, y + 2);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8f0ff';
  ctx.font = '700 30px "Noto Sans JP", sans-serif';
  const name = h.name.length > 8 ? h.name.slice(0, 8) : h.name;
  ctx.fillText(name, x + 124, y + 2, w - 124);
}

export function formatClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** Starting gate with opening front doors; after the break it rolls off the track and fades out. */
export class StartingGate {
  readonly group = new THREE.Group();
  private readonly leaves: { pivot: THREE.Object3D; sign: number }[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly home = new THREE.Vector3();
  private readonly outward = new THREE.Vector3();
  private openAmount = 0;
  private opening = false;
  private retractAmount = 0;
  private retracting = false;
  private retractDelay = 0;
  /** Metres rolled toward the outer rail after the doors open. */
  private readonly retractDist: number;

  constructor(course: Course, race: RaceConfig, stalls: number, startS: number) {
    const sp = race.gateSpacing;
    const lat0 = race.gateFirstLateral;
    const front = 1.5;
    const back = -1.9;
    const len = front - back;
    const frameMat = new THREE.MeshLambertMaterial({ color: '#f2f2ee' });
    const padMat = new THREE.MeshLambertMaterial({ color: '#2f8a4a' });
    const doorMat = new THREE.MeshLambertMaterial({ color: '#d9dde0' });

    const edgeL = lat0 - sp / 2;
    const edgeR = lat0 + (stalls - 1) * sp + sp / 2;
    this.retractDist = course.config.trackWidth - edgeL + 18;

    for (let i = 0; i <= stalls; i++) {
      const z = edgeL + i * sp;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(len, 1.5, 0.12), padMat);
      pad.position.set((front + back) / 2, 1.25, z);
      const postF = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.0, 0.14), frameMat);
      postF.position.set(front, 1.5, z);
      const postB = postF.clone();
      postB.position.x = back;
      this.group.add(pad, postF, postB);
    }
    const width = edgeR - edgeL;
    for (const x of [front, back]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, width + 0.3), frameMat);
      beam.position.set(x, 3.0, (edgeL + edgeR) / 2);
      this.group.add(beam);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, width + 0.3), frameMat);
    roof.position.set((front + back) / 2, 3.15, (edgeL + edgeR) / 2);
    this.group.add(roof);

    // End towers with wheels
    for (const z of [edgeL - 0.5, edgeR + 0.5]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(len, 3.4, 0.8), frameMat);
      tower.position.set((front + back) / 2, 1.9, z);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.4, 16), new THREE.MeshLambertMaterial({ color: '#222' }));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set((front + back) / 2, 0.6, z + (z < edgeL ? -0.6 : 0.6));
      this.group.add(tower, wheel);
    }

    for (let i = 0; i < stalls; i++) {
      const c = lat0 + i * sp;
      const gc = gateColors[i % gateColors.length];
      const numMat = new THREE.MeshLambertMaterial({ map: labelTexture(String(i + 1), { bg: gc.bg, fg: gc.fg, w: 128, h: 128 }) });
      const num = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.55), [numMat, numMat, frameMat, frameMat, frameMat, frameMat]);
      num.position.set(front + 0.1, 2.55, c);
      this.group.add(num);
      for (const sign of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.position.set(front, 0, c - (sign * sp) / 2);
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.7, sp / 2 - 0.06), doorMat);
        leaf.position.set(0, 1.25, (sign * sp) / 4);
        pivot.add(leaf);
        this.group.add(pivot);
        this.leaves.push({ pivot, sign });
      }
    }
    this.group.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) if (!this.materials.includes(mat)) this.materials.push(mat);
    });

    const p = course.sample(startS, 0);
    this.group.position.set(p.x, 0, p.z);
    this.group.rotation.y = Math.atan2(-p.dirZ, p.dirX);
    this.home.copy(this.group.position);
    // Local +Z is track-lateral (inner → outer); roll the car that way off the course.
    this.outward.set(0, 0, 1).applyQuaternion(this.group.quaternion);
  }

  open(): void {
    this.opening = true;
  }

  reset(): void {
    this.opening = false;
    this.openAmount = 0;
    this.retracting = false;
    this.retractAmount = 0;
    this.retractDelay = 0;
    this.group.visible = true;
    this.group.position.copy(this.home);
    this.applyDoors();
    this.applyFade(1);
  }

  update(dt: number): void {
    if (this.opening && this.openAmount < 1) {
      this.openAmount = Math.min(1, this.openAmount + dt * 4);
      this.applyDoors();
      if (this.openAmount >= 1) {
        this.retracting = true;
        this.retractDelay = 0.45;
      }
    }
    if (!this.retracting) return;
    if (this.retractDelay > 0) {
      this.retractDelay -= dt;
      return;
    }
    // ~2.2s to clear the track
    this.retractAmount = Math.min(1, this.retractAmount + dt / 2.2);
    const t = this.retractAmount;
    const ease = t * t * (3 - 2 * t);
    this.group.position.copy(this.home).addScaledVector(this.outward, this.retractDist * ease);
    // Fade during the second half of the roll-off
    this.applyFade(t < 0.45 ? 1 : 1 - (t - 0.45) / 0.55);
    if (t >= 1) {
      this.group.visible = false;
      this.retracting = false;
    }
  }

  private applyDoors(): void {
    const a = (1 - (1 - this.openAmount) ** 3) * 1.5;
    for (const l of this.leaves) l.pivot.rotation.y = l.sign * a;
  }

  private applyFade(opacity: number): void {
    const o = Math.max(0, Math.min(1, opacity));
    for (const mat of this.materials) {
      mat.transparent = o < 1;
      mat.opacity = o;
      mat.depthWrite = o >= 0.95;
      mat.needsUpdate = true;
    }
  }
}

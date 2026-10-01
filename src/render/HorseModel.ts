import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PartId } from '../sim/types';
import { gateColors, type HorseBody } from '../config/horses';
import { cardboardTexture, eyeTexture, labelTexture, numberClothTexture, tapeTexture } from './textures';

export interface LegRig {
  hip: THREE.Object3D;
  knee: THREE.Object3D;
  /** Gallop phase offset (0..1). */
  offset: number;
  front: boolean;
}

export interface HorseRig {
  root: THREE.Group;
  /** Rest height of the body centre. */
  bodyHeight: number;
  stanceWidth: number;
  /** Bobbing body (everything above the legs). */
  body: THREE.Object3D;
  neck: THREE.Object3D;
  tail: THREE.Object3D;
  jockey: THREE.Object3D;
  legs: LegRig[];
  torso: THREE.Mesh;
  /** Detachable / damageable part groups. */
  parts: Record<PartId, THREE.Object3D>;
  tag: THREE.Sprite | null;
}

export interface HorseLook {
  gate: number;
  silkColor: string;
  body: HorseBody;
  isPlayer: boolean;
  showTag: boolean;
}

const shared = (() => {
  let cache: {
    cardboard: THREE.MeshStandardMaterial[];
    tape: THREE.MeshStandardMaterial;
    dark: THREE.MeshStandardMaterial;
    eye: THREE.MeshBasicMaterial;
    white: THREE.MeshStandardMaterial;
    boot: THREE.MeshStandardMaterial;
  } | null = null;
  return () => {
    if (!cache) {
      cache = {
        cardboard: [1, 2, 3, 4].map((seed) =>
          new THREE.MeshStandardMaterial({ map: cardboardTexture(seed, seed % 2 ? '#c79d66' : '#bb8f58'), roughness: 0.95, metalness: 0 }),
        ),
        tape: new THREE.MeshStandardMaterial({ map: tapeTexture(), roughness: 0.35, metalness: 0.25 }),
        dark: new THREE.MeshStandardMaterial({ color: '#4a3826', roughness: 0.9 }),
        eye: new THREE.MeshBasicMaterial({ map: eyeTexture(), transparent: true, alphaTest: 0.1 }),
        white: new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.8 }),
        boot: new THREE.MeshStandardMaterial({ color: '#161616', roughness: 0.6 }),
      };
    }
    return cache;
  };
})();

function box(w: number, h: number, d: number, mat: THREE.Material | THREE.Material[]): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  return m;
}

/** Shared duct-tape material (also used for repair patches). */
export const tapeMaterial = (): THREE.Material => shared().tape;

/**
 * Builds a cardboard racehorse facing +x, standing on y=0.
 * Made purely from boxes: cardboard panels, silver duct tape, a marker-pen eye.
 * The build shows: leg length, stance, cardboard thickness, braces, tape and ballast.
 */
export function createHorseModel(look: HorseLook): HorseRig {
  const { gate, silkColor, showTag } = look;
  const B = look.body;
  const mats = shared();
  const raise = Math.max(0, B.cgAdjust);
  const bodyHeight = 0.3 + 1.25 * B.legLength + raise;
  // Thicker cardboard = darker, chunkier panels
  const plyTint = new THREE.Color(1, 1, 1).lerp(new THREE.Color('#9c8670'), THREE.MathUtils.clamp((B.ply - 0.6) / 0.9, 0, 1) * 0.6);
  const tinted = mats.cardboard.map((m) => {
    const c = m.clone();
    c.color.copy(plyTint);
    return c;
  });
  const cb = (i: number) => tinted[i % tinted.length];
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = bodyHeight;
  root.add(body);

  // Torso: a long box with flaps on top. Width follows the stance, height the cardboard thickness.
  const torsoW = 0.72 * (B.stanceWidth / 0.5) ** 0.6;
  const torsoH = 0.85 * (0.85 + 0.15 * B.ply);
  const torso = box(2.1, torsoH, torsoW, cb(gate));
  body.add(torso);
  const flapL = box(0.9, 0.04 * B.ply, 0.3, cb(gate + 1));
  flapL.position.set(-0.55, torsoH / 2 + 0.03, torsoW / 3);
  flapL.rotation.x = -0.35;
  const flapR = flapL.clone();
  flapR.position.z = -torsoW / 3;
  flapR.rotation.x = 0.35;
  body.add(flapL, flapR);

  // Duct tape: more tape = more bands, and at the extreme a silver lump
  const bands = THREE.MathUtils.clamp(Math.round(B.tape * 2), 1, 5);
  for (let i = 0; i < bands; i++) {
    const band = box(0.14, torsoH + 0.03, torsoW + 0.03, mats.tape);
    band.position.x = bands === 1 ? 0 : -0.75 + (1.5 * i) / (bands - 1);
    body.add(band);
  }
  const strip = box(1.6, 0.06, 0.12, mats.tape);
  strip.position.set(0, torsoH / 2 + 0.01, 0);
  body.add(strip);
  if (B.tape >= 1.5) {
    const patches = Math.round((B.tape - 1.4) * 14);
    for (let i = 0; i < patches; i++) {
      const p = box(0.35, 0.3, 0.02, mats.tape);
      const side = i % 2 ? 1 : -1;
      p.position.set(-0.9 + ((i * 0.53) % 1.8), -0.2 + ((i * 0.31) % 0.4), side * (torsoW / 2 + 0.015));
      p.rotation.z = (i * 1.7) % 3;
      body.add(p);
    }
  }

  // 補強: diagonal cardboard braces along the flanks
  const braces = THREE.MathUtils.clamp(Math.round((B.reinforcement - 0.6) * 3), 0, 5);
  for (let i = 0; i < braces; i++) {
    for (const side of [1, -1]) {
      const br = box(0.95, 0.09, 0.04, cb(gate + 3));
      br.position.set(-0.7 + (1.4 * i) / Math.max(1, braces - 1 || 1), 0, side * (torsoW / 2 + 0.03));
      br.rotation.z = i % 2 ? 0.6 : -0.6;
      body.add(br);
    }
  }

  // 重り: ballast slung under the belly
  if (B.cgAdjust < -0.01) {
    const size = 0.18 + -B.cgAdjust * 1.2;
    const ballast = box(size * 1.6, size, size, new THREE.MeshStandardMaterial({ color: '#6c6f73', roughness: 0.9 }));
    ballast.position.set(0, -torsoH / 2 - size / 2 - 0.12, 0);
    const rope = box(0.03, 0.14, 0.03, mats.dark);
    rope.position.set(0, -torsoH / 2 - 0.06, 0);
    body.add(ballast, rope);
  }

  // Saddle cloth with number
  const gc = gateColors[(gate - 1) % gateColors.length];
  const clothMat = new THREE.MeshStandardMaterial({ map: numberClothTexture(gate, gc.bg, gc.fg), roughness: 0.8 });
  const clothPlain = new THREE.MeshStandardMaterial({ color: gc.bg, roughness: 0.8 });
  const cloth = box(0.75, 0.55, 0.76, [clothPlain, clothPlain, clothPlain, clothPlain, clothMat, clothMat]);
  cloth.position.set(0.05, 0.12, 0);
  body.add(cloth);

  // Neck + head
  const neck = new THREE.Group();
  neck.position.set(0.9, 0.3, 0);
  neck.rotation.z = -0.65;
  body.add(neck);
  const neckBox = box(0.42, 1.05, 0.4, cb(gate + 2));
  neckBox.position.y = 0.5;
  neck.add(neckBox);
  const neckTape = box(0.45, 0.12, 0.43, mats.tape);
  neckTape.position.y = 0.08;
  neck.add(neckTape);
  // mane: zig-zag cardboard teeth
  for (let i = 0; i < 4; i++) {
    const tooth = box(0.16, 0.18, 0.06, cb(gate + 3));
    tooth.position.set(-0.24, 0.25 + i * 0.22, 0);
    tooth.rotation.z = 0.7;
    neck.add(tooth);
  }
  const head = new THREE.Group();
  head.position.set(0.05, 1.0, 0);
  head.rotation.z = -1.6;
  neck.add(head);
  const skull = box(0.36, 0.95, 0.36, cb(gate));
  skull.position.y = 0.38;
  head.add(skull);
  const muzzle = box(0.3, 0.26, 0.33, mats.dark);
  muzzle.position.set(0, 0.82, 0);
  head.add(muzzle);
  for (const z of [0.12, -0.12]) {
    const ear = box(0.08, 0.28, 0.12, cb(gate + 1));
    ear.position.set(-0.12, -0.06, z);
    ear.rotation.z = -0.5;
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), mats.eye);
    eye.position.set(0.02, 0.2, z > 0 ? 0.185 : -0.185);
    if (z < 0) eye.rotation.y = Math.PI;
    head.add(eye);
  }

  // Tail: a strip of cardboard with tape
  const tail = new THREE.Group();
  tail.position.set(-1.05, 0.3, 0);
  body.add(tail);
  const tailBox = box(0.12, 0.75, 0.22, cb(gate + 2));
  tailBox.position.y = -0.35;
  tail.add(tailBox);
  const tailTape = box(0.15, 0.1, 0.25, mats.tape);
  tailTape.position.y = -0.05;
  tail.add(tailTape);
  tail.rotation.z = -0.5;

  // Legs (two segments each), rotary gallop offsets
  const legs: LegRig[] = [];
  const hz = B.stanceWidth / 2;
  const legDefs = [
    { x: 0.8, z: hz, front: true, offset: 0.55 },
    { x: 0.8, z: -hz, front: true, offset: 0.65 },
    { x: -0.8, z: hz, front: false, offset: 0.0 },
    { x: -0.8, z: -hz, front: false, offset: 0.1 },
  ];
  for (const d of legDefs) {
    // かさ上げ: cardboard spacer between the legs and the body
    if (raise > 0.01) {
      const spacer = box(0.2, raise + 0.02, 0.18, cb(gate + 1));
      spacer.position.set(d.x, -torsoH / 2 - raise / 2, d.z);
      body.add(spacer);
    }
    const hip = new THREE.Group();
    hip.position.set(d.x, -0.3 - raise, d.z);
    const thick = B.ply ** 0.4;
    hip.scale.set(thick, B.legLength, thick);
    body.add(hip);
    const upper = box(0.24, 0.66, 0.2, cb(gate + (d.front ? 1 : 3)));
    upper.position.y = -0.33;
    hip.add(upper);
    const knee = new THREE.Group();
    knee.position.y = -0.66;
    hip.add(knee);
    const kneeTape = box(0.27, 0.12, 0.23, mats.tape);
    knee.add(kneeTape);
    const lower = box(0.18, 0.5, 0.16, cb(gate + 2));
    lower.position.y = -0.27;
    knee.add(lower);
    const hoof = box(0.24, 0.1, 0.2, mats.tape);
    hoof.position.set(0.02, -0.55, 0);
    knee.add(hoof);
    if (B.reinforcement > 1.3) {
      // leg splints
      const splint = box(0.05, 0.6, 0.05, cb(gate + 2));
      splint.position.set(0.14, -0.33, 0);
      hip.add(splint);
    }
    legs.push({ hip, knee, offset: d.offset, front: d.front });
  }

  // Jockey
  const silk = new THREE.MeshStandardMaterial({ color: silkColor, roughness: 0.6 });
  const cap = new THREE.MeshStandardMaterial({ color: gc.bg, roughness: 0.5 });
  const jockey = new THREE.Group();
  jockey.position.set(0.15, 0.55, 0);
  body.add(jockey);
  for (const z of [0.2, -0.2]) {
    const thigh = box(0.42, 0.14, 0.14, mats.white);
    thigh.position.set(0.05, 0.12, z);
    thigh.rotation.z = 0.35;
    const boot = box(0.14, 0.32, 0.12, mats.boot);
    boot.position.set(0.24, -0.08, z);
    jockey.add(thigh, boot);
  }
  const torsoJ = box(0.55, 0.32, 0.36, silk);
  torsoJ.position.set(0.12, 0.42, 0);
  torsoJ.rotation.z = -0.35;
  jockey.add(torsoJ);
  const sleeves = box(0.5, 0.1, 0.5, silk);
  sleeves.position.set(0.38, 0.4, 0);
  sleeves.rotation.z = 0.3;
  jockey.add(sleeves);
  const headJ = box(0.24, 0.24, 0.24, cap);
  headJ.position.set(0.48, 0.62, 0);
  jockey.add(headJ);
  const visor = box(0.1, 0.04, 0.22, cap);
  visor.position.set(0.62, 0.54, 0);
  jockey.add(visor);

  let tag: THREE.Sprite | null = null;
  if (showTag) {
    const tex = labelTexture(String(gate), { bg: gc.bg, fg: gc.fg, w: 128, h: 128, round: true, border: '#ffffff' });
    // Constant on-screen size so numbers stay readable on telephoto and close-up shots alike
    tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    tag.scale.set(0.011, 0.011, 1);
    tag.position.set(0, 3.6, 0);
    tag.renderOrder = 10;
    root.add(tag);
  }

  if (look.isPlayer) {
    const you = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: labelTexture('▼ YOU', { bg: '#ffd84a', fg: '#1a1000', w: 256, h: 96, font: '900 60px "Noto Sans JP", sans-serif' }),
        depthTest: false,
        transparent: true,
        sizeAttenuation: false,
      }),
    );
    you.scale.set(0.028, 0.0105, 1);
    you.position.set(0, 4.0, 0);
    you.renderOrder = 11;
    root.add(you);
  }

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.receiveShadow = false;
  });

  // Fewer draw calls: inside every animated group, boxes sharing a material become one mesh
  // (≈45 → ≈20 per horse). The torso stays separate (repair tape attaches to it).
  const groups: THREE.Object3D[] = [body, neck, tail, jockey];
  neck.traverse((o) => o !== neck && (o as THREE.Group).isGroup && groups.push(o));
  for (const l of legs) groups.push(l.hip, l.knee);
  for (const g of groups) mergeChildren(g, new Set([torso]));

  const parts: Record<PartId, THREE.Object3D> = {
    legFR: legs[0].hip,
    legFL: legs[1].hip,
    legHR: legs[2].hip,
    legHL: legs[3].hip,
    neck,
    tail,
    body: torso,
  };
  return { root, bodyHeight, stanceWidth: B.stanceWidth, body, neck, tail, jockey, legs, tag, torso, parts };
}

/** Merge a group's direct mesh children that share one material (static relative to the group). */
function mergeChildren(group: THREE.Object3D, keep: Set<THREE.Object3D>): void {
  const byMat = new Map<THREE.Material, THREE.Mesh[]>();
  for (const c of group.children) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || keep.has(m) || Array.isArray(m.material) || m.children.length) continue;
    const list = byMat.get(m.material as THREE.Material) ?? [];
    list.push(m);
    byMat.set(m.material as THREE.Material, list);
  }
  for (const [mat, meshes] of byMat) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      m.updateMatrix();
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrix);
      return g.index ? g.toNonIndexed() : g;
    });
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = meshes.some((m) => m.castShadow);
    for (const m of meshes) group.remove(m);
    group.add(mesh);
  }
}

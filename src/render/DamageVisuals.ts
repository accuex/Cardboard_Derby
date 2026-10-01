import * as THREE from 'three';
import { damageConfig } from '../config/damage';
import { LEG_IDS, PART_IDS, partHealth } from '../sim/damage';
import type { HorseState, PartId } from '../sim/types';
import { tapeMaterial, type HorseRig } from './HorseModel';
import { labelTexture } from './textures';

const tapeBox = (w: number, h: number, d: number) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), tapeMaterial());
  m.castShadow = true;
  return m;
};

/** Where repair tape goes on each part (in the part's local space). */
function tapeSpot(id: PartId, layer: number): { pos: THREE.Vector3; size: [number, number, number]; rotZ: number } {
  const j = ((layer * 37) % 10) / 10 - 0.5; // deterministic scatter
  if (id === 'neck') return { pos: new THREE.Vector3(0, 0.3 + layer * 0.17, 0), size: [0.46, 0.11, 0.44], rotZ: j * 0.6 };
  if (id === 'tail') return { pos: new THREE.Vector3(0, -0.2 - layer * 0.12, 0), size: [0.16, 0.09, 0.26], rotZ: j * 0.8 };
  if (id === 'body') return { pos: new THREE.Vector3(j * 1.6, (layer % 3) * 0.2 - 0.2, 0), size: [0.5, 0.12, 0.76], rotZ: j * 1.2 + 0.4 };
  // legs: wrap the upper leg, then the lower
  return { pos: new THREE.Vector3(0, -0.12 - layer * 0.16, 0), size: [0.28, 0.1, 0.24], rotZ: j * 0.5 };
}

/**
 * Damage presentation for one horse: missing parts, bent legs, peeling tape,
 * repair patches piling up, and the repair crew.
 */
export class DamageVisuals {
  private readonly tapeShown = new Map<PartId, number>();
  private readonly flaps = new Map<PartId, THREE.Object3D>();
  private readonly crew: THREE.Group;
  private readonly repairTag: THREE.Sprite;
  private readonly roll: THREE.Mesh;
  /** 0 (perfect) .. 1 (wrecked), for wobble. */
  wear = 0;

  constructor(private readonly rig: HorseRig) {
    for (const id of LEG_IDS) {
      const pivot = new THREE.Group();
      pivot.position.set(0.13, -0.05, 0);
      const strip = tapeBox(0.03, 0.32, 0.14);
      strip.position.y = -0.16;
      pivot.add(strip);
      pivot.visible = false;
      rig.parts[id].add(pivot);
      this.flaps.set(id, pivot);
    }
    for (const id of PART_IDS) this.tapeShown.set(id, 0);

    // Repair crew: a boxy person holding a roll of tape
    this.crew = new THREE.Group();
    const shirt = new THREE.MeshStandardMaterial({ color: '#1f6fd0', roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: '#f0c9a0', roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.3), shirt);
    torso.position.y = 1.15;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.8, 0.26), new THREE.MeshStandardMaterial({ color: '#333' }));
    legs.position.y = 0.42;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), skin);
    head.position.y = 1.6;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.32), new THREE.MeshStandardMaterial({ color: '#ffd84a' }));
    cap.position.y = 1.76;
    this.roll = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.06, 6, 12), tapeMaterial());
    this.roll.position.set(0.32, 1.1, 0.25);
    this.crew.add(torso, legs, head, cap, this.roll);
    this.crew.traverse((o) => (o.castShadow = true));
    this.crew.position.set(0.2, 0, -1.3);
    this.crew.rotation.y = -Math.PI / 2; // face the horse
    this.crew.visible = false;
    rig.root.add(this.crew);

    this.repairTag = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: labelTexture('修理中', { bg: '#1f6fd0', fg: '#ffffff', w: 256, h: 96, font: '900 60px "Noto Sans JP", sans-serif' }),
        depthTest: false,
        transparent: true,
        sizeAttenuation: false,
      }),
    );
    this.repairTag.scale.set(0.03, 0.011, 1);
    this.repairTag.position.set(0, 3.6, 0);
    this.repairTag.renderOrder = 12;
    this.repairTag.visible = false;
    rig.root.add(this.repairTag);
  }

  update(h: HorseState, time: number): void {
    let legSum = 0;
    for (const id of PART_IDS) {
      const p = h.parts[id];
      const obj = this.rig.parts[id];
      if (id !== 'body') obj.visible = !p.detached;
      this.syncTape(id, p.tape);
      if (id !== 'body' && LEG_IDS.includes(id)) legSum += partHealth(p);
      const flap = this.flaps.get(id);
      if (flap) {
        flap.visible = !p.detached && p.joint < damageConfig.peelAt;
        flap.rotation.z = 0.6 + Math.sin(time * 18 + id.length) * 0.5 * Math.min(1, h.speed / 8);
      }
    }
    this.wear = 1 - legSum / LEG_IDS.length;

    const repairing = h.status === 'repairing';
    this.crew.visible = repairing;
    this.repairTag.visible = repairing;
    if (repairing) {
      // busy taping: bob and spin the roll
      this.crew.position.y = Math.abs(Math.sin(time * 8)) * 0.08;
      this.roll.rotation.z = time * 10;
    }
  }

  /** Static bends added on top of the gallop pose (called after the pose is set). */
  applyDeformation(h: HorseState, time: number): void {
    const r = this.rig;
    r.legs.forEach((leg, i) => {
      const p = h.parts[LEG_IDS[i]];
      // bent legs: kinked knee and splayed hip
      leg.knee.rotation.z += p.deform * (leg.front ? -0.7 : 0.7);
      leg.hip.rotation.x += p.deform * 0.35 * Math.sign(leg.hip.position.z);
    });
    const neck = h.parts.neck;
    r.neck.rotation.z += neck.deform * 0.6 + (1 - neck.joint) * 0.25 * Math.sin(time * 11);
    // a crumpled torso sags in the middle
    r.body.rotation.x = (1 - h.parts.body.integrity) * 0.12;
  }

  private syncTape(id: PartId, layers: number): void {
    const shown = this.tapeShown.get(id) ?? 0;
    if (layers <= shown) return;
    const target = id === 'body' ? this.rig.torso : this.rig.parts[id];
    for (let l = shown; l < Math.min(layers, 6); l++) {
      const spot = tapeSpot(id, l);
      const m = tapeBox(...spot.size);
      m.position.copy(spot.pos);
      m.rotation.z = spot.rotZ;
      target.add(m);
    }
    this.tapeShown.set(id, layers);
  }

  /** A copy of a part to leave lying on the turf. */
  makeDebris(id: PartId): THREE.Object3D {
    const src = this.rig.parts[id];
    const copy = src.clone(true);
    copy.visible = true;
    copy.traverse((o) => (o.visible = true));
    const holder = new THREE.Group();
    holder.add(copy);
    copy.position.set(0, 0, 0);
    copy.rotation.set(0, 0, 0);
    copy.scale.set(1, src.scale.y, 1);
    return holder;
  }
}

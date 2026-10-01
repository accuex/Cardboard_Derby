import * as THREE from 'three';
import { renderConfig } from '../config/render';
import type { HorseState } from '../sim/types';
import type { PartId } from '../sim/types';
import { DamageVisuals } from './DamageVisuals';
import { createHorseModel, type HorseRig } from './HorseModel';

const STRIDE_LENGTH = 5.2;

/** Presentation of one horse: copies sim state onto the model and animates gallop, lean and falls. */
export class HorseView {
  readonly rig: HorseRig;
  private stridePhase = Math.random();
  private lastX = 0;
  private lastZ = 0;
  private yaw = 0;
  private brace = 0;
  private readonly jitterSeed = Math.random() * 100;
  private readonly damage: DamageVisuals;

  constructor(state: HorseState) {
    this.rig = createHorseModel({
      gate: state.gate,
      silkColor: state.silkColor,
      body: state.body,
      isPlayer: state.isPlayer,
      showTag: renderConfig.showHorseNumberTags,
    });
    this.damage = new DamageVisuals(this.rig);
    this.snap(state);
  }

  get object(): THREE.Object3D {
    return this.rig.root;
  }

  snap(h: HorseState): void {
    this.lastX = h.x;
    this.lastZ = h.z;
    this.yaw = Math.atan2(-h.dirZ, h.dirX);
    this.rig.root.position.set(h.x, 0, h.z);
    this.rig.root.rotation.set(0, this.yaw, 0);
    this.pose(h, 0, 0);
  }

  update(h: HorseState, dt: number, time: number): void {
    const root = this.rig.root;
    const moved = Math.hypot(h.x - this.lastX, h.z - this.lastZ);
    this.lastX = h.x;
    this.lastZ = h.z;

    // Heading follows the course, plus a little crab angle when moving sideways.
    const crab = h.status === 'running' ? Math.atan2(-h.lateralVelocity, Math.max(h.speed, 3)) : 0;
    const targetYaw = Math.atan2(-h.dirZ, h.dirX) + crab;
    let dy = targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 10);

    this.stridePhase = (this.stridePhase + moved / STRIDE_LENGTH) % 1;
    this.brace += ((h.bracing ? 1 : 0) - this.brace) * Math.min(1, dt * 8);
    const intensity = h.status === 'running' ? THREE.MathUtils.clamp(h.speed / 12, 0, 1) : 0;

    // Roll from the simulation (+ = outward = local +z). Pivot on the outer feet so the
    // inner legs visibly leave the ground; a fallen horse lies on its side.
    // Cardboard wobble, much worse once the legs are damaged
    const wobbleAmp = 0.03 + 0.12 * this.damage.wear;
    const wobble = h.status === 'running' ? Math.sin(time * 9 + this.jitterSeed) * wobbleAmp * intensity : 0;
    const roll = h.roll + wobble;
    const s = Math.abs(Math.sin(roll));
    const lift = (this.rig.stanceWidth / 2) * s + 0.2 * s * s;
    root.position.set(h.x, lift, h.z);
    root.rotation.set(roll, this.yaw, 0, 'YXZ');
    this.pose(h, intensity, time);
    this.damage.update(h, time);
    this.damage.applyDeformation(h, time);
  }

  /** Copy of a part that just fell off, placed where it was in the world. */
  spawnDebris(part: PartId): THREE.Object3D {
    const obj = this.damage.makeDebris(part);
    const src = this.rig.parts[part];
    src.updateWorldMatrix(true, false);
    src.getWorldPosition(obj.position);
    obj.quaternion.copy(src.getWorldQuaternion(new THREE.Quaternion()));
    return obj;
  }

  private pose(h: HorseState, intensity: number, time: number): void {
    const r = this.rig;
    const TAU = Math.PI * 2;
    const p = this.stridePhase * TAU;
    const down = h.status === 'fallen';
    for (const leg of r.legs) {
      const a = p + leg.offset * TAU;
      let swing = Math.sin(a) * (leg.front ? 0.75 : 0.65) * intensity;
      let bend = Math.max(0, Math.cos(a)) * (leg.front ? -1.1 : 0.9) * intensity;
      if (down) {
        // legs flailing helplessly
        swing = Math.sin(time * 14 + leg.offset * 9) * 0.6;
        bend = Math.sin(time * 11 + leg.offset * 5) * 0.5;
      }
      leg.hip.rotation.z = swing;
      leg.knee.rotation.z = bend;
      // 踏ん張る: legs splay outward
      leg.hip.rotation.x = this.brace * 0.28 * Math.sign(leg.hip.position.z);
    }
    const crouch = this.brace * 0.12;
    r.body.position.y = r.bodyHeight - crouch + Math.abs(Math.sin(p)) * 0.18 * intensity;
    r.body.rotation.z = Math.sin(p + 0.8) * 0.06 * intensity;
    r.neck.rotation.z = -0.65 + Math.sin(p + 1.4) * 0.15 * intensity + this.brace * 0.25;
    r.tail.rotation.z = -0.5 - 0.6 * intensity + Math.sin(time * 12) * 0.12 * intensity;
    r.jockey.position.y = 0.55 + Math.sin(p * 2 + 1) * 0.04 * intensity - this.brace * 0.08;
    r.jockey.rotation.z = -0.1 * intensity + this.brace * 0.35;
  }
}

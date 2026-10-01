import * as THREE from 'three';
import type { RaceState } from '../sim/types';

/**
 * Pooled particles: turf kicked up by galloping hooves, and cardboard flecks
 * when a horse falls or loses a part. One draw call for all of them.
 */
export class Dust {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly color: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private next = 0;
  private emitAcc: number[] = [];
  private lastSeq = 0;

  constructor(private readonly max: number) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max).fill(1e9);
    this.maxLife = new Float32Array(max).fill(1);
    this.color = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.color, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uHalfHeight: { value: 400 } },
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      // world-size points that also grow with telephoto lenses (projectionMatrix[1][1] = 1/tan(fov/2))
      vertexShader: `attribute float size; attribute float alpha; uniform float uHalfHeight; varying float vA; varying vec3 vC;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.5, size * projectionMatrix[1][1] * uHalfHeight / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; if (dot(d,d) > 0.25) discard; gl_FragColor = vec4(vC, vA); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number, size: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.color.set([r, g, b], i * 3);
    this.life[i] = 0;
    this.maxLife[i] = life;
    this.size[i] = size;
  }

  update(st: RaceState, dt: number, active: boolean): void {
    if (this.emitAcc.length !== st.horses.length) this.emitAcc = st.horses.map(() => 0);
    if (active) {
      for (const h of st.horses) {
        if (h.status !== 'running' || h.speed < 4) continue;
        // turf clods behind the hooves, more at speed
        this.emitAcc[h.id] += dt * h.speed * 1.4;
        while (this.emitAcc[h.id] >= 1) {
          this.emitAcc[h.id] -= 1;
          const side = (Math.random() - 0.5) * 0.6;
          const x = h.x - h.dirX * 1 + -h.dirZ * side;
          const z = h.z - h.dirZ * 1 + h.dirX * side;
          const back = 0.25 * h.speed;
          // mostly brown soil with some torn grass
          const grass = Math.random() < 0.35;
          const r = grass ? 0.32 : 0.45 + Math.random() * 0.1;
          const g = grass ? 0.55 : 0.33 + Math.random() * 0.06;
          const b = grass ? 0.2 : 0.18;
          this.spawn(x, 0.1, z, -h.dirX * back + (Math.random() - 0.5), 1.5 + Math.random() * 2, -h.dirZ * back + (Math.random() - 0.5), 0.8, r, g, b, 0.2 + Math.random() * 0.14);
        }
      }
      for (const ev of st.events) {
        if (ev.seq <= this.lastSeq) continue;
        this.lastSeq = ev.seq;
        if ((ev.type === 'fall' || ev.type === 'partLost') && ev.x !== undefined && ev.z !== undefined) {
          // cardboard flecks
          const n = ev.type === 'fall' ? 40 : 20;
          for (let k = 0; k < n; k++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 1 + Math.random() * 4;
            const c = 0.6 + Math.random() * 0.2;
            this.spawn(ev.x, 1 + Math.random(), ev.z, Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp, 1.6, c, c * 0.75, c * 0.45, 0.18 + Math.random() * 0.15);
          }
        }
      }
    }
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] > this.maxLife[i]) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] += dt;
      const j = i * 3;
      this.vel[j + 1] -= 9.8 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] = Math.max(0.03, this.pos[j + 1] + this.vel[j + 1] * dt);
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] <= 0.03) {
        this.vel[j] *= 0.6;
        this.vel[j + 2] *= 0.6;
      }
      this.alpha[i] = 0.9 * (1 - this.life[i] / this.maxLife[i]);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }

  /** Half the drawing-buffer height in pixels (point sizes are computed from it). */
  setViewportHeight(px: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uHalfHeight.value = px / 2;
  }

  reset(): void {
    this.life.fill(1e9);
    this.lastSeq = 0;
  }
}

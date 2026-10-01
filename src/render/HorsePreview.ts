import * as THREE from 'three';
import type { HorseBody } from '../config/horses';
import { createHorseModel, type HorseRig } from './HorseModel';

/** Small turntable renderer for the build screen. Independent of the race scene. */
export class HorsePreview {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private readonly turntable = new THREE.Group();
  private rig: HorseRig | null = null;
  private running = false;
  private last = 0;
  private angle = 0.6;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'preview-canvas';

    this.scene.add(new THREE.HemisphereLight('#fff6e8', '#4a5a3a', 1.3));
    const sun = new THREE.DirectionalLight('#fff4dd', 2.4);
    sun.position.set(4, 8, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4;
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), new THREE.MeshStandardMaterial({ color: '#4f9a3a', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.turntable.add(floor);
    this.scene.add(this.turntable);
    this.camera.position.set(0, 2.2, 7.2);
    this.camera.lookAt(0, 1.4, 0);
  }

  setHorse(body: HorseBody, silkColor: string, gate: number): void {
    if (this.rig) this.turntable.remove(this.rig.root);
    this.rig = createHorseModel({ gate, silkColor, body, isPlayer: false, showTag: false });
    this.rig.root.traverse((o) => (o.castShadow = true));
    this.turntable.add(this.rig.root);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt, now / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

  private frame(dt: number, t: number): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.angle += dt * 0.5;
    this.turntable.rotation.y = this.angle;
    if (this.rig) {
      // idle prance so the joints read
      const p = t * 4;
      this.rig.legs.forEach((leg) => (leg.hip.rotation.z = Math.sin(p + leg.offset * 6.28) * 0.25));
      this.rig.neck.rotation.z = -0.65 + Math.sin(p * 0.5) * 0.08;
      this.rig.tail.rotation.z = -0.6 + Math.sin(t * 6) * 0.15;
    }
    this.renderer.render(this.scene, this.camera);
  }
}

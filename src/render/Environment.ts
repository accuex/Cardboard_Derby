import * as THREE from 'three';
import { renderConfig } from '../config/render';
import { Rng } from '../core/rng';
import type { Course } from '../sim/Course';
import { venueLayout } from './layout';
import { grassTexture } from './textures';

/** Sky, lights, ground, trees and distant hills. */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly sunOffset = new THREE.Vector3(-120, 220, 160);

  constructor(scene: THREE.Scene, course: Course) {
    scene.background = new THREE.Color('#8fc4ef');
    scene.fog = new THREE.Fog('#cfe3f2', 600, 2600);

    scene.add(this.createSky());

    const hemi = new THREE.HemisphereLight('#dff0ff', '#5a7a3a', 1.1);
    scene.add(hemi);

    this.sun = new THREE.DirectionalLight('#fff4dd', 2.6);
    this.sun.position.copy(this.sunOffset);
    if (renderConfig.shadows) {
      this.sun.castShadow = true;
      const e = renderConfig.shadowExtent;
      const cam = this.sun.shadow.camera;
      cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e;
      cam.near = 10; cam.far = 600;
      this.sun.shadow.mapSize.set(renderConfig.shadowMapSize, renderConfig.shadowMapSize);
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.4;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);

    const grass = grassTexture();
    grass.repeat.set(400, 400);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshLambertMaterial({ map: grass }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    scene.add(this.createTrees(course));
    scene.add(this.createHills());
  }

  /** Keep the shadow frustum centred on the action. */
  follow(focus: THREE.Vector3): void {
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(this.sunOffset);
  }

  private createSky(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#2f78d6') },
        horizon: { value: new THREE.Color('#cfe6f7') },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55));
        // soft clouds
        float n = sin(vDir.x*9.0 + sin(vDir.z*7.0)) * sin(vDir.z*11.0 + vDir.x*3.0);
        float cloud = smoothstep(0.55, 0.95, n) * smoothstep(0.03, 0.25, h) * (1.0 - h);
        c = mix(c, vec3(1.0), cloud*0.6);
        gl_FragColor = vec4(c, 1.0); }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3500, 32, 16), mat);
    sky.renderOrder = -1;
    return sky;
  }

  private createTrees(course: Course): THREE.Group {
    const group = new THREE.Group();
    const rng = new Rng(42);
    const n = renderConfig.trees;
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, 4, 6);
    trunkGeo.translate(0, 2, 0);
    const crownGeo = new THREE.IcosahedronGeometry(4.5, 0);
    crownGeo.translate(0, 7.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#6b4a2b' }), n);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    const W = course.config.trackWidth;
    const lay = venueLayout(course);
    let placed = 0;
    for (let i = 0; i < n * 3 && placed < n; i++) {
      const s = rng.next() * course.lapLength;
      const lateral = W + 40 + rng.range(0, 90);
      const p = course.sample(s, lateral);
      // keep the area behind the stands clear
      if (p.z > lay.railZ - 10 && p.x > lay.standFrom - 30 && p.x < lay.standTo + 30) continue;
      const sc = rng.range(0.8, 1.6);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * Math.PI * 2);
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(sc, sc * rng.range(0.9, 1.3), sc));
      trunks.setMatrixAt(placed, m);
      crowns.setMatrixAt(placed, m);
      crowns.setColorAt(placed, color.setHSL(rng.range(0.25, 0.33), rng.range(0.4, 0.6), rng.range(0.25, 0.38)));
      placed++;
    }
    trunks.count = crowns.count = placed;
    crowns.castShadow = true;
    group.add(trunks, crowns);
    return group;
  }

  private createHills(): THREE.Group {
    const g = new THREE.Group();
    const rng = new Rng(77);
    const mat = new THREE.MeshLambertMaterial({ color: '#6f9a7a', fog: true });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rng.range(-0.1, 0.1);
      const r = rng.range(1500, 2000);
      const hill = new THREE.Mesh(new THREE.SphereGeometry(rng.range(220, 420), 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      hill.scale.y = rng.range(0.25, 0.45);
      hill.position.set(Math.cos(a) * r, -5, Math.sin(a) * r);
      g.add(hill);
    }
    return g;
  }
}

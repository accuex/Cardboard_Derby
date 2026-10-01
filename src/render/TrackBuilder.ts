import * as THREE from 'three';
import type { Course } from '../sim/Course';
import { dirtTexture, labelTexture, turfTexture } from './textures';

/** A closed curve following the course at a fixed lateral offset and height. */
class CourseCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private readonly course: Course, private readonly lateral: number, private readonly height: number) {
    super();
  }
  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const p = this.course.sample(t * this.course.lapLength, this.lateral);
    return target.set(p.x, this.height, p.z);
  }
}

/** Builds a flat strip following the course between two lateral offsets. */
function ribbon(course: Course, latFrom: number, latTo: number, y: number, vRepeats: number, step = 2): THREE.BufferGeometry {
  const n = Math.ceil(course.lapLength / step);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * course.lapLength;
    const a = course.sample(s, latFrom);
    const b = course.sample(s, latTo);
    pos.push(a.x, y, a.z, b.x, y, b.z);
    const v = (i / n) * vRepeats;
    uv.push(0, v, 1, v);
    if (i < n) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildTrack(course: Course, raceDistance: number): THREE.Group {
  const group = new THREE.Group();
  const W = course.config.trackWidth;

  // Turf course with mowing bands every ~12m
  const turf = turfTexture();
  const turfMesh = new THREE.Mesh(
    ribbon(course, -0.6, W + 0.6, 0.0, Math.round(course.lapLength / 24)),
    new THREE.MeshLambertMaterial({ map: turf }),
  );
  turfMesh.receiveShadow = true;
  group.add(turfMesh);

  // Inner dirt course
  const dirt = dirtTexture();
  dirt.repeat.set(2, 1);
  const dirtMesh = new THREE.Mesh(
    ribbon(course, -18, -3, 0.0, Math.round(course.lapLength / 8)),
    new THREE.MeshLambertMaterial({ map: dirt }),
  );
  dirtMesh.receiveShadow = true;
  group.add(dirtMesh);

  group.add(buildRail(course, -0.3, course.config.railHeight, course.config.railPostSpacing));
  group.add(buildRail(course, W + 0.3, course.config.railHeight, course.config.railPostSpacing));
  group.add(buildRail(course, -2.6, 0.8, 4, '#d9d9d9'));

  // Outer hedge
  const hedge = new THREE.Mesh(
    new THREE.TubeGeometry(new CourseCurve(course, W + 1.6, 0.5), 600, 0.7, 4, true),
    new THREE.MeshLambertMaterial({ color: '#2f6b2a' }),
  );
  group.add(hedge);

  group.add(buildFinishLine(course));
  group.add(buildGoalPost(course));
  group.add(buildDistanceMarkers(course, raceDistance));
  return group;
}

function buildRail(course: Course, lateral: number, height: number, spacing: number, color = '#ffffff'): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const rail = new THREE.Mesh(new THREE.TubeGeometry(new CourseCurve(course, lateral, height), Math.ceil(course.lapLength / 3), 0.09, 6, true), mat);
  rail.castShadow = true;
  g.add(rail);

  const count = Math.floor(course.lapLength / spacing);
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, height, 5);
  postGeo.translate(0, height / 2, 0);
  const posts = new THREE.InstancedMesh(postGeo, mat, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const p = course.sample(i * spacing, lateral);
    m.makeTranslation(p.x, 0, p.z);
    posts.setMatrixAt(i, m);
  }
  g.add(posts);
  return g;
}

function placeOnCourse(obj: THREE.Object3D, course: Course, s: number, lateral: number, y = 0): void {
  const p = course.sample(s, lateral);
  obj.position.set(p.x, y, p.z);
  obj.rotation.y = Math.atan2(-p.dirZ, p.dirX);
}

function buildFinishLine(course: Course): THREE.Object3D {
  const W = course.config.trackWidth;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.35, W + 1.2), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, 0.02, W / 2);
  const holder = new THREE.Group();
  holder.add(line);
  placeOnCourse(holder, course, course.finishS, 0);
  return holder;
}

/** Round red/white goal board on the inner rail, plus an arch sign by the outer rail. */
function buildGoalPost(course: Course): THREE.Group {
  const root = new THREE.Group();

  const post = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.2, 8), new THREE.MeshLambertMaterial({ color: '#ffffff' }));
  pole.position.y = 2.1;
  const disc = new THREE.MeshLambertMaterial({ map: labelTexture('', { bg: '#d42a2a', fg: '#fff', round: true, border: '#ffffff' }) });
  const board = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 32), [new THREE.MeshLambertMaterial({ color: '#ffffff' }), disc, disc]);
  board.rotation.x = Math.PI / 2; // disc faces lateral (toward the stands)
  board.position.y = 4.6;
  post.add(pole, board);
  post.traverse((o) => (o.castShadow = true));
  placeOnCourse(post, course, course.finishS, -1.2);
  root.add(post);

  const arch = new THREE.Group();
  const blue = new THREE.MeshLambertMaterial({ color: '#1f4fb8' });
  const sign = new THREE.MeshLambertMaterial({ map: labelTexture('DANBORI', { bg: '#1f4fb8', fg: '#ffffff', w: 512, h: 140, font: '900 92px sans-serif' }) });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), blue);
  const legR = legL.clone();
  legL.position.set(0, 3, -2.2);
  legR.position.set(0, 3, 2.2);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 5.0), [sign, sign, blue, blue, blue, blue]);
  top.position.y = 6.4;
  arch.add(legL, legR, top);
  arch.traverse((o) => (o.castShadow = true));
  placeOnCourse(arch, course, course.finishS + 2, course.config.trackWidth + 4.5);
  root.add(arch);
  return root;
}

/** Distance-to-go boards every `markerInterval` metres along the inner rail. */
function buildDistanceMarkers(course: Course, raceDistance: number): THREE.Group {
  const g = new THREE.Group();
  const interval = course.config.markerInterval;
  const postMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const max = Math.min(course.lapLength - interval, Math.max(raceDistance, 1000));
  for (let d = interval; d <= max; d += interval) {
    const major = d % 200 === 0;
    const marker = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.2, 0.15), postMat);
    post.position.y = 1.1;
    marker.add(post);
    const tex = labelTexture(String(d), {
      bg: major ? '#d42a2a' : '#ffffff',
      fg: major ? '#ffffff' : '#d42a2a',
      w: 256,
      h: 160,
      border: major ? '#ffffff' : '#d42a2a',
      font: '900 100px "Noto Sans JP", sans-serif',
    });
    const boardMat = new THREE.MeshLambertMaterial({ map: tex });
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.1), [postMat, postMat, postMat, postMat, boardMat, boardMat]);
    board.position.y = 2.5;
    marker.add(board);
    marker.traverse((o) => (o.castShadow = true));
    placeOnCourse(marker, course, course.finishS - d, -1.3);
    g.add(marker);
  }
  return g;
}

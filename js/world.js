import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// SPLIT SECOND — procedural city.
// Road network: avenues (4 lanes, 2 per direction), streets (2 lanes),
// one-way alleys (2 lanes, single direction). Sidewalks, traffic lights,
// buildings, trees. Everything generated in code — zero downloaded assets.
// ---------------------------------------------------------------------------

export const LINES = 11;                 // 11 road lines per axis -> 10x10 blocks
export const PITCH = 54;
export const HALF = ((LINES - 1) * PITCH) / 2;   // 270
export const BOUND = HALF + 19;                  // 289, fence line

export const linePos = (i) => -HALF + i * PITCH;
export function roadType(i) { const m = i % 5; return m === 0 ? 'avenue' : m === 2 ? 'oneway' : 'street'; }
export function roadWidth(i) { const t = roadType(i); return t === 'avenue' ? 22 : t === 'oneway' ? 9 : 12; }

// Lanes for a road. axis 'x' = road runs along z (vertical on map),
// axis 'z' = road runs along x. dir +1 = increasing coordinate.
export function lanesFor(axis, i) {
  const type = roadType(i);
  const lanes = [];
  const twoWayDir = (off) => axis === 'x' ? (off > 0 ? 1 : -1) : (off < 0 ? 1 : -1);
  if (type === 'avenue') {
    for (const off of [-8.25, -2.75, 2.75, 8.25]) lanes.push({ offset: off, dir: twoWayDir(off) });
  } else if (type === 'street') {
    for (const off of [-3, 3]) lanes.push({ offset: off, dir: twoWayDir(off) });
  } else {
    const s = i % 2 === 0 ? 1 : -1;
    lanes.push({ offset: -2.25, dir: s }, { offset: 2.25, dir: s });
  }
  return lanes;
}

export function headingFor(axis, dir) {
  if (axis === 'x') return dir > 0 ? 0 : Math.PI;
  return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
}

export function lanePos(axis, i, lane, t) {
  if (axis === 'x') return { x: linePos(i) + lane.offset, z: t };
  return { x: t, z: linePos(i) + lane.offset };
}

// Traffic-light cycle (global, synchronized): 20s loop.
export function lightPhase(time) {
  const t = time % 20;
  if (t < 8) return 0;      // vertical green
  if (t < 9.5) return 1;    // vertical yellow
  if (t < 17.5) return 2;   // horizontal green
  if (t < 19) return 3;     // horizontal yellow
  return 4;                 // all red
}
export const axisGo = (phase, axis) => (axis === 'x' ? phase === 0 : phase === 2);

// Collision solids: buildings (AABBs) + traffic-light poles (circles).
export const solids = [];   // {minX,maxX,minZ,maxZ}
export const poles = [];    // {x,z,r}

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

// --- building windows -------------------------------------------------------
function windowTexture(base, rows) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64 * rows;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 64 * rows);
  for (let y = 10; y < 64 * rows - 12; y += 30) {
    for (let x = 10; x < 118; x += 26) {
      g.fillStyle = Math.random() < 0.28 ? '#ffe9a3' : 'rgba(18,26,38,0.88)';
      g.fillRect(x, y, 15, 17);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const BUILDING_COLORS = ['#b8b2a6', '#9aa7b5', '#c4a484', '#8f9aa8', '#b59a8f', '#a8b09a'];
const roofMat = new THREE.MeshLambertMaterial({ color: 0x5a5f66 });

function makeBuilding(w, h, d) {
  const rows = h < 16 ? 2 : h < 26 ? 3 : 4;
  const wall = new THREE.MeshLambertMaterial({ map: windowTexture(pick(BUILDING_COLORS), rows) });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [wall, wall, roofMat, roofMat, wall, wall]);
  mesh.position.y = h / 2;
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function makeTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 6),
    new THREE.MeshLambertMaterial({ color: 0x6b4a2f }));
  trunk.position.y = 1.1; trunk.castShadow = true;
  const top = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4.5, 8),
    new THREE.MeshLambertMaterial({ color: pick([0x3e7d3a, 0x4c8f43, 0x35702f]) }));
  top.position.y = 4.2; top.castShadow = true;
  g.add(trunk, top);
  return g;
}

function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3d44'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.045})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  g.fillStyle = '#e8e4d8';
  g.fillRect(61, 8, 6, 44); g.fillRect(61, 76, 6, 44);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
export function buildCity(scene) {
  const span = HALF + 14;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 + 160, span * 2 + 160),
    new THREE.MeshLambertMaterial({ color: 0x7fa35c }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // roads
  const rTex = roadTexture();
  for (let i = 0; i < LINES; i++) {
    const w = roadWidth(i), p = linePos(i);
    for (const horiz of [false, true]) {
      const tex = rTex.clone(); tex.needsUpdate = true;
      tex.repeat.set(horiz ? (span * 2) / w : 1, horiz ? 1 : (span * 2) / w);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(horiz ? span * 2 : w, horiz ? w : span * 2),
        new THREE.MeshLambertMaterial({ map: tex }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(horiz ? 0 : p, 0.02, horiz ? p : 0);
      m.receiveShadow = true;
      scene.add(m);
    }
    // sidewalks: raised pavement strips on both sides
    const swMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6 });
    for (const horiz of [false, true]) {
      for (const s of [-1, 1]) {
        const off = p + s * (w / 2 + 1.6);
        const m = new THREE.Mesh(new THREE.BoxGeometry(horiz ? span * 2 : 3.2, 0.14, horiz ? 3.2 : span * 2), swMat);
        m.position.set(horiz ? 0 : off, 0.07, horiz ? off : 0);
        m.receiveShadow = true;
        scene.add(m);
      }
    }
  }

  // intersection caps
  const capMat = new THREE.MeshLambertMaterial({ color: 0x3a3d44 });
  for (let i = 0; i < LINES; i++) {
    for (let j = 0; j < LINES; j++) {
      const s = Math.max(roadWidth(i), roadWidth(j));
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(s, s), capMat);
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(linePos(i), 0.03, linePos(j));
      cap.receiveShadow = true;
      scene.add(cap);
    }
  }

  // blocks: buildings + trees (kept clear of roads + sidewalks)
  for (let i = 0; i < LINES - 1; i++) {
    for (let j = 0; j < LINES - 1; j++) {
      const x0 = linePos(i) + roadWidth(i) / 2 + 4.6;
      const x1 = linePos(i + 1) - roadWidth(i + 1) / 2 - 4.6;
      const z0 = linePos(j) + roadWidth(j) / 2 + 4.6;
      const z1 = linePos(j + 1) - roadWidth(j + 1) / 2 - 4.6;
      for (let li = 0; li < 2; li++) {
        for (let lj = 0; lj < 2; lj++) {
          const lx = x0 + (li + 0.5) * ((x1 - x0) / 2);
          const lz = z0 + (lj + 0.5) * ((z1 - z0) / 2);
          const lotW = (x1 - x0) / 2, lotD = (z1 - z0) / 2;
          if (lotW < 10 || lotD < 10) continue;
          if (Math.random() < 0.62) {
            const w = rand(9, lotW - 3), d = rand(9, lotD - 3), h = rand(9, 34);
            const b = makeBuilding(w, h, d);
            b.position.x = lx + rand(-1, 1);
            b.position.z = lz + rand(-1, 1);
            scene.add(b);
            solids.push({ minX: b.position.x - w / 2, maxX: b.position.x + w / 2, minZ: b.position.z - d / 2, maxZ: b.position.z + d / 2 });
          } else if (Math.random() < 0.5) {
            const t = makeTree();
            t.position.set(lx + rand(-4, 4), 0, lz + rand(-4, 4));
            scene.add(t);
          }
        }
      }
    }
  }

  // boundary fence
  const fenceMat = new THREE.MeshLambertMaterial({ color: 0xd8d8d8 });
  const stripeMat = new THREE.MeshLambertMaterial({ color: 0xd23b3b });
  const F = BOUND + 2;
  for (const [w, d, x, z] of [
    [F * 2, 1.2, 0, -F], [F * 2, 1.2, 0, F], [1.2, F * 2, -F, 0], [1.2, F * 2, F, 0]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), fenceMat);
    f.position.set(x, 0.8, z); f.castShadow = true; scene.add(f);
    const s = new THREE.Mesh(new THREE.BoxGeometry(w === 1.2 ? 1.3 : w, 0.4, d === 1.2 ? 1.3 : d), stripeMat);
    s.position.set(x, 1.45, z); scene.add(s);
  }

  // --- traffic lights (instanced: 1 pole + 2 heads + 6 lamps per intersection)
  const nX = LINES * LINES;
  const dummy = new THREE.Object3D();
  const poleGeo = new THREE.CylinderGeometry(0.13, 0.16, 4.6, 8); poleGeo.translate(0, 2.3, 0);
  const poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x2c2f34 }), nX);
  const headGeo = new THREE.BoxGeometry(0.55, 1.25, 0.4);
  const headMesh = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial({ color: 0x14161a }), nX * 2);
  const lampGeo = new THREE.SphereGeometry(0.15, 8, 8);
  const lampMesh = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), nX * 6);
  lampMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  poleMesh.frustumCulled = headMesh.frustumCulled = lampMesh.frustumCulled = false;

  const lampBase = [];   // {x,y,z, axis:'x'|'z', slot:0|1|2} slot: 0 red,1 yellow,2 green
  let pi = 0, hi = 0, li = 0;
  for (let i = 0; i < LINES; i++) {
    for (let j = 0; j < LINES; j++) {
      const px = linePos(i) + roadWidth(i) / 2 + 1.4;
      const pz = linePos(j) + roadWidth(j) / 2 + 1.4;
      dummy.position.set(px, 0, pz); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      poleMesh.setMatrixAt(pi++, dummy.matrix);
      poles.push({ x: px, z: pz, r: 0.55 });
      // head A faces the vertical road (controls x-axis traffic), offset toward intersection
      dummy.position.set(px - 0.9, 3.9, pz); dummy.updateMatrix();
      headMesh.setMatrixAt(hi++, dummy.matrix);
      // head B faces the horizontal road
      dummy.position.set(px, 3.9, pz - 0.9); dummy.updateMatrix();
      headMesh.setMatrixAt(hi++, dummy.matrix);
      for (const [hx, hz, axis] of [[px - 0.9, pz, 'x'], [px, pz - 0.9, 'z']]) {
        for (let s = 0; s < 3; s++) {
          lampBase.push({ x: hx, y: 4.32 - s * 0.42, z: hz, axis, slot: s });
          dummy.position.set(hx, 4.32 - s * 0.42, hz); dummy.updateMatrix();
          lampMesh.setMatrixAt(li++, dummy.matrix);
        }
      }
    }
  }
  scene.add(poleMesh, headMesh, lampMesh);

  const lampColor = new THREE.Color();
  let lastPhase = -1;
  function setPhase(phase) {
    if (phase === lastPhase) return;
    lastPhase = phase;
    const vState = phase === 0 ? 2 : phase === 1 ? 1 : 0;  // slot index lit for vertical
    const hState = phase === 2 ? 2 : phase === 3 ? 1 : 0;  // ...for horizontal
    const palette = [0xff2d2d, 0xffc21c, 0x2dff5e];
    for (let k = 0; k < lampBase.length; k++) {
      const L = lampBase[k];
      const lit = (L.axis === 'x' ? vState : hState) === L.slot;
      lampColor.setHex(palette[L.slot]).multiplyScalar(lit ? 1 : 0.14);
      lampMesh.setColorAt(k, lampColor);
    }
    lampMesh.instanceColor.needsUpdate = true;
  }
  setPhase(0);

  return { setPhase };
}

// --- circle vs solids (buildings + light poles) --------------------------------
export function hitsSolids(x, z, r) {
  for (const s of solids) {
    const cx = Math.max(s.minX, Math.min(x, s.maxX));
    const cz = Math.max(s.minZ, Math.min(z, s.maxZ));
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < r * r) return true;
  }
  for (const p of poles) {
    const dx = x - p.x, dz = z - p.z, rr = r + p.r;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Detailed hero car (player + cops). Forward = +Z.
// ---------------------------------------------------------------------------
function wheel(x, z) {
  const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.35, 12),
    new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  w.rotation.z = Math.PI / 2;
  w.position.set(x, 0.42, z);
  w.castShadow = true;
  return w;
}

export function makeCarDetailed({ color = 0xd23b3b, police = false } = {}) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.75, 4.4), bodyMat);
  body.position.y = 0.72; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.65, 2.1),
    new THREE.MeshLambertMaterial({ color: police ? 0x18202c : 0x222a36 }));
  cabin.position.set(0, 1.35, -0.25); cabin.castShadow = true; g.add(cabin);
  const hl = new THREE.MeshLambertMaterial({ color: 0xfff6c9, emissive: 0xffedb5, emissiveIntensity: 0.9 });
  for (const x of [-0.65, 0.65]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.1), hl);
    h.position.set(x, 0.72, 2.21); g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.1),
      new THREE.MeshLambertMaterial({ color: 0xaa1111, emissive: 0xaa1111, emissiveIntensity: 0.6 }));
    t.position.set(x, 0.72, -2.21); g.add(t);
  }
  const wheels = [wheel(-1.0, 1.45), wheel(1.0, 1.45), wheel(-1.0, -1.45), wheel(1.0, -1.45)];
  wheels.forEach(w => g.add(w));
  if (police) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.3, 2.6),
      new THREE.MeshLambertMaterial({ color: 0x14181f }));
    stripe.position.y = 0.72; g.add(stripe);
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x222222 }));
    barBase.position.set(0, 1.75, -0.25); g.add(barBase);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.34),
      new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 2 }));
    red.position.set(-0.33, 1.9, -0.25); g.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.34),
      new THREE.MeshLambertMaterial({ color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 2 }));
    blue.position.set(0.33, 1.9, -0.25); g.add(blue);
    g.userData.siren = { red: red.material, blue: blue.material };
  } else {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.5), bodyMat);
    sp.position.set(0, 1.25, -2.0); sp.castShadow = true; g.add(sp);
    for (const x of [-0.8, 0.8]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.3), bodyMat);
      leg.position.set(x, 1.0, -2.0); g.add(leg);
    }
  }
  g.userData.wheels = wheels;
  g.userData.body = body;
  return g;
}

// ---------------------------------------------------------------------------
// Merged, vertex-colored traffic car geometry (ONE draw call for all traffic).
// ---------------------------------------------------------------------------
function painted(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) { arr[k * 3] = c.r; arr[k * 3 + 1] = c.g; arr[k * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export function makeTrafficCarGeometry() {
  const parts = [];
  const add = (geo, hex, x, y, z, rz = 0) => {
    if (rz) geo.rotateZ(rz);
    geo.translate(x, y, z);
    parts.push(painted(geo, hex));
  };
  add(new THREE.BoxGeometry(2.0, 0.7, 4.4), 0xffffff, 0, 0.72, 0);          // body (tinted per instance)
  add(new THREE.BoxGeometry(1.7, 0.6, 2.0), 0x2a3340, 0, 1.32, -0.2);       // cabin
  for (const [x, z] of [[-1, 1.45], [1, 1.45], [-1, -1.45], [1, -1.45]])
    add(new THREE.CylinderGeometry(0.4, 0.4, 0.35, 10), 0x161616, x, 0.42, z, Math.PI / 2);
  add(new THREE.BoxGeometry(0.32, 0.18, 0.08), 0xfff2b0, -0.6, 0.72, 2.21); // headlights
  add(new THREE.BoxGeometry(0.32, 0.18, 0.08), 0xfff2b0, 0.6, 0.72, 2.21);
  add(new THREE.BoxGeometry(0.32, 0.18, 0.08), 0xcc2222, -0.6, 0.72, -2.21);
  add(new THREE.BoxGeometry(0.32, 0.18, 0.08), 0xcc2222, 0.6, 0.72, -2.21);
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------
// Merged pedestrian geometry (body + head + legs), tinted per instance.
// ---------------------------------------------------------------------------
export function makePedGeometry() {
  const parts = [];
  const add = (geo, hex, x, y, z) => { geo.translate(x, y, z); parts.push(painted(geo, hex)); };
  add(new THREE.BoxGeometry(0.34, 0.62, 0.3), 0x2c2f36, -0.13, 0.31, 0);   // legs
  add(new THREE.BoxGeometry(0.34, 0.62, 0.3), 0x2c2f36, 0.13, 0.31, 0);
  add(new THREE.BoxGeometry(0.56, 0.72, 0.34), 0xffffff, 0, 0.98, 0);       // torso (tinted)
  add(new THREE.SphereGeometry(0.2, 8, 8), 0xe0b48f, 0, 1.52, 0);           // head
  return mergeGeometries(parts);
}

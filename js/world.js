import * as THREE from 'three';

// ---------------------------------------------------------------------------
// City layout: a grid of roads; blocks between them hold buildings and trees.
// Everything is procedural (no downloaded assets) so the whole game stays
// tiny, cohesive, and license-free.
// ---------------------------------------------------------------------------

export const PITCH = 46;          // road center to road center
export const ROAD_W = 12;
export const BLOCKS = 9;          // 9x9 blocks -> 10x10 road grid
export const HALF = (BLOCKS * PITCH) / 2;   // 207, road centers run -HALF..HALF
export const BOUND = HALF + ROAD_W / 2;     // 213, playable clamp

// Collision boxes for buildings: {minX,maxX,minZ,maxZ}
export const solids = [];

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

// --- window texture: windows drawn on canvas, tinted per building color ----
function windowTexture(base, litRatio = 0.25) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  for (let y = 12; y < 244; y += 28) {
    for (let x = 12; x < 116; x += 28) {
      g.fillStyle = Math.random() < litRatio ? '#ffe9a3' : 'rgba(20,28,40,0.85)';
      g.fillRect(x, y, 16, 18);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const BUILDING_COLORS = ['#b8b2a6', '#9aa7b5', '#c4a484', '#8f9aa8', '#b59a8f', '#a8b09a'];

function buildingMaterial(heightClass) {
  const base = pick(BUILDING_COLORS);
  const tex = windowTexture(base);
  // taller buildings get more vertical repeats so windows don't stretch
  tex.repeat.set(1, heightClass === 0 ? 1 : heightClass === 1 ? 2 : 3);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshLambertMaterial({ map: tex });
}

const roofMat = new THREE.MeshLambertMaterial({ color: 0x5a5f66 });

function makeBuilding(w, h, d) {
  const cls = h < 16 ? 0 : h < 26 ? 1 : 2;
  const wall = buildingMaterial(cls);
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, [wall, wall, roofMat, roofMat, wall, wall]);
  mesh.position.y = h / 2;
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function makeTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.5, 2.2, 6),
    new THREE.MeshLambertMaterial({ color: 0x6b4a2f }));
  trunk.position.y = 1.1; trunk.castShadow = true;
  const top = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 4.5, 8),
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
  // subtle noise
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  // center dashes
  g.fillStyle = '#e8e4d8';
  g.fillRect(61, 8, 6, 44); g.fillRect(61, 76, 6, 44);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCity(scene) {
  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(BOUND * 2 + 120, BOUND * 2 + 120),
    new THREE.MeshLambertMaterial({ color: 0x7fa35c }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // roads
  const rTex = roadTexture();
  const roadMat = new THREE.MeshLambertMaterial({ map: rTex });
  const roadLen = BOUND * 2;
  for (let i = 0; i <= BLOCKS; i++) {
    const p = -HALF + i * PITCH;
    for (const horizontal of [true, false]) {
      const tex = rTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(horizontal ? roadLen / ROAD_W : 1, horizontal ? 1 : roadLen / ROAD_W);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(horizontal ? roadLen : ROAD_W, horizontal ? ROAD_W : roadLen),
        new THREE.MeshLambertMaterial({ map: tex }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(horizontal ? 0 : p, 0.02, horizontal ? p : 0);
      m.receiveShadow = true;
      scene.add(m);
    }
    // intersection caps (kill z-fighting between crossing strips)
    for (let j = 0; j <= BLOCKS; j++) {
      const q = -HALF + j * PITCH;
      const cap = new THREE.Mesh(
        new THREE.PlaneGeometry(ROAD_W, ROAD_W),
        new THREE.MeshLambertMaterial({ color: 0x3a3d44 }));
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(p, 0.035, q);
      cap.receiveShadow = true;
      scene.add(cap);
    }
  }

  // blocks: buildings + trees
  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      const bx = -HALF + i * PITCH + ROAD_W / 2;   // block min corner
      const bz = -HALF + j * PITCH + ROAD_W / 2;
      const bw = PITCH - ROAD_W;                   // 34
      // 2x2 lots
      for (let li = 0; li < 2; li++) {
        for (let lj = 0; lj < 2; lj++) {
          const lx = bx + li * (bw / 2) + bw / 4;
          const lz = bz + lj * (bw / 2) + bw / 4;
          if (Math.random() < 0.62) {
            const w = rand(9, 14), d = rand(9, 14), h = rand(9, 34);
            const b = makeBuilding(w, h, d);
            b.position.x = lx + rand(-1.5, 1.5);
            b.position.z = lz + rand(-1.5, 1.5);
            scene.add(b);
            solids.push({
              minX: b.position.x - w / 2, maxX: b.position.x + w / 2,
              minZ: b.position.z - d / 2, maxZ: b.position.z + d / 2,
            });
          } else if (Math.random() < 0.5) {
            const t = makeTree();
            t.position.set(lx + rand(-4, 4), 0, lz + rand(-4, 4));
            scene.add(t);
          }
        }
      }
    }
  }

  // boundary fence (visual + the clamp in main.js treats crossing as a crash)
  const fenceMat = new THREE.MeshLambertMaterial({ color: 0xd8d8d8 });
  const stripeMat = new THREE.MeshLambertMaterial({ color: 0xd23b3b });
  for (const [w, d, x, z] of [
    [BOUND * 2 + 8, 1.2, 0, -BOUND - 2], [BOUND * 2 + 8, 1.2, 0, BOUND + 2],
    [1.2, BOUND * 2 + 8, -BOUND - 2, 0], [1.2, BOUND * 2 + 8, BOUND + 2, 0]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), fenceMat);
    f.position.set(x, 0.8, z); f.castShadow = true;
    scene.add(f);
    const s = new THREE.Mesh(new THREE.BoxGeometry(w === 1.2 ? 1.3 : w, 0.4, d === 1.2 ? 1.3 : d), stripeMat);
    s.position.set(x, 1.45, z);
    scene.add(s);
  }
}

// ---------------------------------------------------------------------------
// Cars: low-poly procedural. Forward = +Z of the group; heading rotates .y.
// ---------------------------------------------------------------------------

function wheel(x, z) {
  const w = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.35, 12),
    new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  w.rotation.z = Math.PI / 2;
  w.position.set(x, 0.42, z);
  w.castShadow = true;
  return w;
}

export function makeCar({ color = 0xd23b3b, police = false } = {}) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.75, 4.4), bodyMat);
  body.position.y = 0.72; body.castShadow = true;
  g.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.65, 2.1),
    new THREE.MeshLambertMaterial({ color: police ? 0x18202c : 0x222a36 }));
  cabin.position.set(0, 1.35, -0.25); cabin.castShadow = true;
  g.add(cabin);

  // headlights / taillights
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
    // doors stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.3, 2.6),
      new THREE.MeshLambertMaterial({ color: 0x14181f }));
    stripe.position.y = 0.72; g.add(stripe);
    // light bar
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
    // spoiler
    const sp = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.5), bodyMat);
    sp.position.set(0, 1.25, -2.0); sp.castShadow = true; g.add(sp);
    for (const x of [-0.8, 0.8]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.3), bodyMat);
      leg.position.set(x, 1.0, -2.0); g.add(leg);
    }
  }

  g.userData.wheels = wheels;
  return g;
}

// Circle-vs-AABB test used for building collisions
export function hitsSolid(x, z, r) {
  for (const s of solids) {
    const cx = Math.max(s.minX, Math.min(x, s.maxX));
    const cz = Math.max(s.minZ, Math.min(z, s.maxZ));
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

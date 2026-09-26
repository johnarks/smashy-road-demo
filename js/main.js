import * as THREE from 'three';
import {
  buildCity, makeCarDetailed, makeTrafficCarGeometry, makePedGeometry,
  hitsSolids, lightPhase, LINES, linePos, lanesFor, headingFor, lanePos, HALF, BOUND,
} from './world.js';
import { Traffic } from './traffic.js';
import { Peds } from './peds.js';
import { input, initInput } from './input.js';

// ---------------------------------------------------------------- tuning ---
const PLAYER = {
  accel: 17, maxSpeed: 28, brake: 36, revAccel: 11, revMax: -9,
  radius: 1.7, steerRate: 7.5, maxTurn: 3.6,
};
const COP = { accel: 17, maxSpeed: 26.5, turn: 2.3, bustDist: 3.6 };
const REVERSE_DELAY = 0.7;

// ------------------------------------------------------------------- setup ---
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc5e8);
scene.fog = new THREE.Fog(0x9fc5e8, 140, 520);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x6a7a52, 0.95));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
sun.shadow.camera.far = 320;
scene.add(sun, sun.target);

const city = buildCity(scene);
const traffic = new Traffic(scene, makeTrafficCarGeometry());
const peds = new Peds(scene, makePedGeometry());

// ------------------------------------------------------------------- state ---
let state = 'menu';           // menu | playing | over
let elapsed = 0, worldTime = 0, distance = 0, brakeHeld = 0;
let steer = 0;                // analog steering: -1 (right) .. +1 (left)
let cops = [];
let sirenT = 0;

const player = { mesh: makeCarDetailed({ color: 0xd23b3b }), x: 0, z: 0, heading: 0, speed: 0 };
scene.add(player.mesh);

const el = (id) => document.getElementById(id);
const scoreEl = el('score'), menuEl = el('menu'), overEl = el('over');

function spawnCop(x, z) {
  const mesh = makeCarDetailed({ police: true });
  scene.add(mesh);
  const dx = player.x - x, dz = player.z - z;
  cops.push({ mesh, x, z, heading: Math.atan2(dx, dz), speed: 10, stun: 0, grace: 0, spin: 0, spinVel: 0 });
}

function copSpawnFar() {
  // drop a cop 100-140m from the player to keep the pressure on forever
  for (let tries = 0; tries < 12; tries++) {
    const a = Math.random() * Math.PI * 2, d = 100 + Math.random() * 40;
    const x = player.x + Math.cos(a) * d, z = player.z + Math.sin(a) * d;
    if (Math.abs(x) > BOUND - 6 || Math.abs(z) > BOUND - 6) continue;
    if (hitsSolids(x, z, 4)) continue;
    spawnCop(x, z);
    return;
  }
  spawnCop(player.x + 110, player.z);  // fallback: almost never used
}

function reset() {
  // start on the central avenue (line 5 -> x=0), in a +z lane
  const lanes = lanesFor('x', 5);
  const lane = lanes.find(l => l.dir > 0) || lanes[0];
  const p = lanePos('x', 5, lane, -60);
  player.x = p.x; player.z = p.z; player.heading = 0; player.speed = 0;
  elapsed = 0; distance = 0; brakeHeld = 0; steer = 0;
  for (const c of cops) scene.remove(c.mesh);
  cops = [];
  traffic.scatter(player.x, player.z, 60);
  copSpawnFar(); copSpawnFar();
  scoreEl.textContent = '0.0s';
}

function startGame() {
  reset();
  state = 'playing';
  menuEl.classList.add('hidden');
  overEl.classList.add('hidden');
}

function endGame(title) {
  if (state !== 'playing') return;
  state = 'over';
  el('overTitle').textContent = title;
  el('overStats').textContent = `${elapsed.toFixed(1)}s · ${Math.round(distance)}m`;
  overEl.classList.remove('hidden');
}

// ------------------------------------------------------------------ helpers ---
function turnToward(cur, target, maxDelta) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-maxDelta, Math.min(maxDelta, d));
}

// ------------------------------------------------------------------- update ---
function updatePlayer(dt) {
  const braking = input.left && input.right;

  if (braking) {
    brakeHeld += dt;
    player.speed = Math.max(0, player.speed - PLAYER.brake * dt);
    if (player.speed <= 0.01 && brakeHeld > REVERSE_DELAY) {
      player.speed = Math.max(player.speed - PLAYER.revAccel * dt, PLAYER.revMax);
    }
  } else {
    brakeHeld = 0;
    player.speed = Math.min(player.speed + PLAYER.accel * dt, PLAYER.maxSpeed);
  }

  // --- analog steering: binary input eases into a smooth steer value ---
  const target = (input.left ? 1 : 0) - (input.right ? 1 : 0);  // +1 = left
  const d = target - steer;
  steer += Math.max(-PLAYER.steerRate * dt, Math.min(PLAYER.steerRate * dt, d));

  const spd = Math.abs(player.speed);
  const grip = Math.min(1, spd / 9);                              // no turning when parked
  const taper = 1 - 0.32 * Math.min(1, Math.max(0, (spd - 19) / 9)); // stability at speed
  const dir = player.speed >= 0 ? 1 : -1;
  player.heading += steer * PLAYER.maxTurn * grip * taper * dir * dt;

  const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
  player.x += fx * player.speed * dt;
  player.z += fz * player.speed * dt;
  distance += spd * dt;

  // --- crashes: walls, buildings, poles, traffic, pedestrians ---
  if (Math.abs(player.x) > BOUND || Math.abs(player.z) > BOUND) return endGame('WRECKED!');
  if (hitsSolids(player.x, player.z, PLAYER.radius)) return endGame('WRECKED!');
  if (traffic.playerHit(player.x, player.z)) return endGame('WRECKED!');
  if (peds.playerHit(player.x, player.z)) return endGame('WRECKED!');

  player.mesh.position.set(player.x, 0, player.z);
  player.mesh.rotation.y = player.heading;
  // body roll into the turn + wheel visuals
  const sf = Math.min(1, spd / PLAYER.maxSpeed);
  player.mesh.userData.body.rotation.z = -steer * 0.07 * sf;
  const spin = (player.speed / 0.42) * dt;
  player.mesh.userData.wheels.forEach((w, i) => {
    w.rotation.x += spin;
    if (i < 2) w.rotation.y = steer * 0.42;
  });
}

let nearestCop = Infinity;

function updateCops(dt) {
  sirenT += dt;
  const phase = Math.floor(sirenT * 6) % 2 === 0;

  // heat: you never truly outrun them — fresh cops keep joining the chase
  const want = Math.min(2 + Math.floor(elapsed / 20), 7);
  if (cops.length < want) copSpawnFar();

  nearestCop = Infinity;

  for (let ci = cops.length - 1; ci >= 0; ci--) {
    const c = cops[ci];
    const dx = player.x - c.x, dz = player.z - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist < nearestCop) nearestCop = dist;
    if (dist < COP.bustDist) { endGame('BUSTED!'); return; }
    // a cop that falls way behind re-enters elsewhere — the chase never ends
    if (dist > 175) {
      scene.remove(c.mesh);
      cops.splice(ci, 1);
      copSpawnFar();
      continue;
    }
    if (c.grace > 0) c.grace -= dt;

    if (c.stun > 0) {
      // crashed into traffic: spin out, then recover
      c.stun -= dt;
      c.spin += c.spinVel * dt;
      c.spinVel *= Math.max(0, 1 - 2.2 * dt);
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = c.heading + c.spin;
    } else {
      let desired = Math.atan2(dx, dz);
      const px = c.x + Math.sin(c.heading) * 7, pz = c.z + Math.cos(c.heading) * 7;
      if (hitsSolids(px, pz, 2.5)) desired = c.heading + 1.35;          // buildings/poles
      else if (traffic.near(px, pz, 5)) desired = c.heading - 1.1;     // traffic
      if (Math.abs(px) > BOUND - 5 || Math.abs(pz) > BOUND - 5) desired = Math.atan2(-c.x, -c.z);

      c.heading = turnToward(c.heading, desired, COP.turn * dt);
      c.speed = Math.min(c.speed + COP.accel * dt, COP.maxSpeed);
      c.x += Math.sin(c.heading) * c.speed * dt;
      c.z += Math.cos(c.heading) * c.speed * dt;

      // slamming into traffic wrecks the cop — bait them into it
      const hit = traffic.near(c.x, c.z, 3.0);
      if (hit && c.grace <= 0) {
        traffic.shove(hit);
        c.stun = 2.4; c.grace = 4.0; c.speed = 0; c.spin = 0;
        c.spinVel = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 3);
      }

      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = c.heading;
    }

    const s = c.mesh.userData.siren;
    if (s) {
      s.red.emissiveIntensity = phase ? 2.5 : 0.15;
      s.blue.emissiveIntensity = phase ? 0.15 : 2.5;
    }
  }

  // cop-vs-cop separation: no more piling on top of each other
  for (let a = 0; a < cops.length; a++) {
    for (let b = a + 1; b < cops.length; b++) {
      const A = cops[a], B = cops[b];
      const dx = B.x - A.x, dz = B.z - A.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 7) {
        const push = ((7 - d) / 7) * 9 * dt;
        const nx = dx / d, nz = dz / d;
        A.x -= nx * push; A.z -= nz * push;
        B.x += nx * push; B.z += nz * push;
      }
    }
  }
}

const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(0, 0, 0);
let curFov = 62, curDist = 12.5;
function updateCamera(dt) {
  const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
  // pull back when the cops are right on your bumper — more room to see the chase
  const wantDist = 12.5 + (nearestCop < 18 ? (18 - nearestCop) * 0.45 : 0);
  curDist += (Math.min(wantDist, 19) - curDist) * (1 - Math.exp(-dt * 3));
  camPos.set(player.x - fx * curDist, 6.2 + (curDist - 12.5) * 0.35, player.z - fz * curDist);
  camLook.set(player.x + fx * 8, 1.3, player.z + fz * 8);
  const k = 1 - Math.exp(-dt * 5.5);
  camera.position.lerp(camPos, k);
  _lookCur.lerp(camLook, 1 - Math.exp(-dt * 8));
  camera.lookAt(_lookCur);
  // speed sensation: widen the FOV as you go faster
  const targetFov = 62 + 10 * Math.min(1, Math.abs(player.speed) / PLAYER.maxSpeed);
  curFov += (targetFov - curFov) * (1 - Math.exp(-dt * 4));
  if (Math.abs(curFov - camera.fov) > 0.05) {
    camera.fov = curFov;
    camera.updateProjectionMatrix();
  }
  sun.position.set(player.x + 45, 75, player.z + 28);
  sun.target.position.set(player.x, 0, player.z);
}
const _lookCur = new THREE.Vector3(0, 0, 0);

// --------------------------------------------------------------------- loop ---
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  worldTime += dt;

  city.setPhase(lightPhase(worldTime));
  traffic.update(dt, worldTime, player.x, player.z, player.heading, Math.abs(player.speed));
  peds.update(dt, worldTime);

  if (state === 'playing') {
    elapsed += dt;
    updatePlayer(dt);
    if (state === 'playing') {
      updateCops(dt);
      scoreEl.textContent = `${elapsed.toFixed(1)}s`;
    }
  }
  if (state !== 'menu') updateCamera(dt);
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ----------------------------------------------------------------------- ui ---
initInput(canvas);
el('btnStart').addEventListener('click', startGame);
el('btnAgain').addEventListener('click', startGame);
el('btnExit').addEventListener('click', () => {
  state = 'menu';
  overEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
});
el('btnRestart').addEventListener('click', () => { if (state !== 'menu') startGame(); });

camera.position.set(0, 70, 140);
camera.lookAt(0, 0, 0);
reset();
tick();

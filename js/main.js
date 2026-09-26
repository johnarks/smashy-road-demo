import * as THREE from 'three';
import { buildCity, makeCar, hitsSolid, PITCH, HALF, BOUND, BLOCKS, solids } from './world.js';
import { input, initInput } from './input.js';

// ---------------------------------------------------------------- tuning ---
const PLAYER = { accel: 16, maxSpeed: 27, brake: 34, revAccel: 10, revMax: -9, turn: 2.5, radius: 1.7 };
const COP    = { accel: 14, maxSpeed: 24.5, turn: 2.1, radius: 1.7, bustDist: 3.4 };
const REVERSE_DELAY = 0.7;          // hold brake this long at a stop -> backs up

// ------------------------------------------------------------------- setup ---
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc5e8);
scene.fog = new THREE.Fog(0x9fc5e8, 120, 420);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x6a7a52, 0.9));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
sun.shadow.camera.far = 300;
scene.add(sun, sun.target);

buildCity(scene);

// ------------------------------------------------------------------- state ---
let state = 'menu';           // menu | playing | over
let camMode = 'chase';        // chase | iso
let elapsed = 0, distance = 0, brakeHeld = 0;
let cops = [];
let sirenT = 0;

const player = {
  mesh: makeCar({ color: 0xd23b3b }),
  x: 0, z: 0, heading: 0, speed: 0,
};
scene.add(player.mesh);

const el = (id) => document.getElementById(id);
const scoreEl = el('score'), menuEl = el('menu'), overEl = el('over');
const btnCam = el('btnCam');

function roadCoord() { return -HALF + ((Math.random() * (BLOCKS + 1)) | 0) * PITCH; }

function spawnCop() {
  let x = roadCoord(), z = roadCoord(), tries = 0;
  while (tries++ < 20) {
    const dx = x - player.x, dz = z - player.z;
    if (dx * dx + dz * dz > 70 * 70 && !hitsSolid(x, z, 3)) break;
    x = roadCoord(); z = roadCoord();
  }
  const mesh = makeCar({ police: true });
  scene.add(mesh);
  const dx = player.x - x, dz = player.z - z;
  cops.push({ mesh, x, z, heading: Math.atan2(dx, dz), speed: 8 });
}

function reset() {
  // park the player on a vertical road (x=-23 is a road center), facing +z
  player.x = -HALF + 4 * PITCH; player.z = 0; player.heading = 0; player.speed = 0;
  elapsed = 0; distance = 0; brakeHeld = 0;
  for (const c of cops) scene.remove(c.mesh);
  cops = [];
  spawnCop(); spawnCop();
  scoreEl.textContent = '0.0s';
}

function startGame() {
  reset();
  state = 'playing';
  menuEl.classList.add('hidden');
  overEl.classList.add('hidden');
}

function endGame(title) {
  state = 'over';
  el('overTitle').textContent = title;
  el('overStats').textContent = `${elapsed.toFixed(1)}s · ${Math.round(distance)}m · ${cops.length} cops dodged`;
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
    player.speed -= PLAYER.brake * dt;
    if (player.speed < 0) player.speed = 0;
    // fully stopped + still holding -> start backing up
    if (player.speed <= 0.01 && brakeHeld > REVERSE_DELAY) {
      player.speed = Math.max(player.speed - PLAYER.revAccel * dt, PLAYER.revMax);
    }
  } else {
    brakeHeld = 0;
    // the car always drives: ease back up to cruising speed
    player.speed = Math.min(player.speed + PLAYER.accel * dt, PLAYER.maxSpeed);
  }

  const spd = Math.abs(player.speed);
  const grip = Math.min(1, spd / 8);              // can't turn on the spot
  const dir = player.speed >= 0 ? 1 : -1;        // reverse flips steering
  if (input.left && !input.right) player.heading += PLAYER.turn * grip * dir * dt;
  if (input.right && !input.left) player.heading -= PLAYER.turn * grip * dir * dt;

  const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
  player.x += fx * player.speed * dt;
  player.z += fz * player.speed * dt;
  distance += spd * dt;

  // crashes
  if (Math.abs(player.x) > BOUND || Math.abs(player.z) > BOUND) return endGame('WRECKED!');
  if (hitsSolid(player.x, player.z, PLAYER.radius)) return endGame('WRECKED!');

  player.mesh.position.set(player.x, 0, player.z);
  player.mesh.rotation.y = player.heading;
  // wheel spin + front-wheel steer visual
  const spin = (player.speed / 0.42) * dt;
  player.mesh.userData.wheels.forEach((w, i) => {
    w.rotation.x += spin;
    if (i < 2) w.rotation.y = (input.left && !input.right ? 0.4 : 0) + (input.right && !input.left ? -0.4 : 0);
  });
}

function updateCops(dt) {
  sirenT += dt;
  const phase = Math.floor(sirenT * 6) % 2 === 0;

  // more heat over time: +1 cop every 25s, cap 6
  const want = Math.min(2 + Math.floor(elapsed / 25), 6);
  if (cops.length < want) spawnCop();

  for (const c of cops) {
    const dx = player.x - c.x, dz = player.z - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist < COP.bustDist) { endGame('BUSTED!'); return; }

    let desired = Math.atan2(dx, dz);
    // building avoidance: probe ahead, veer if blocked
    const px = c.x + Math.sin(c.heading) * 7, pz = c.z + Math.cos(c.heading) * 7;
    if (hitsSolid(px, pz, 2.5)) desired = c.heading + 1.3;
    // stay in bounds
    if (Math.abs(px) > BOUND - 4 || Math.abs(pz) > BOUND - 4) {
      desired = Math.atan2(-c.x, -c.z);
    }

    c.heading = turnToward(c.heading, desired, COP.turn * dt);
    c.speed = Math.min(c.speed + COP.accel * dt, COP.maxSpeed);
    c.x += Math.sin(c.heading) * c.speed * dt;
    c.z += Math.cos(c.heading) * c.speed * dt;

    c.mesh.position.set(c.x, 0, c.z);
    c.mesh.rotation.y = c.heading;
    const s = c.mesh.userData.siren;
    if (s) {
      s.red.emissiveIntensity = phase ? 2.5 : 0.15;
      s.blue.emissiveIntensity = phase ? 0.15 : 2.5;
    }
  }
}

const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function updateCamera(dt) {
  const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
  if (camMode === 'chase') {
    camPos.set(player.x - fx * 11, 5.6, player.z - fz * 11);
    camLook.set(player.x + fx * 7, 1.2, player.z + fz * 7);
  } else {
    camPos.set(player.x + 20, 24, player.z + 20);
    camLook.set(player.x, 0, player.z);
  }
  const k = 1 - Math.exp(-dt * 6);
  camera.position.lerp(camPos, k);
  // lookAt needs a smoothed target too
  const lk = 1 - Math.exp(-dt * 8);
  _lookCur.lerp(camLook, lk);
  camera.lookAt(_lookCur);
  // shadow frustum follows the player
  sun.position.set(player.x + 40, 70, player.z + 25);
  sun.target.position.set(player.x, 0, player.z);
}
const _lookCur = new THREE.Vector3(0, 0, 0);

// --------------------------------------------------------------------- loop ---
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state === 'playing') {
    elapsed += dt;
    updatePlayer(dt);
    if (state === 'playing') {   // updatePlayer may have ended the game
      updateCops(dt);
      scoreEl.textContent = `${elapsed.toFixed(1)}s`;
    }
  }
  // camera keeps following even on the game-over screen (frozen scene)
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
btnCam.addEventListener('click', () => {
  camMode = camMode === 'chase' ? 'iso' : 'chase';
  btnCam.textContent = camMode === 'chase' ? 'CHASE' : 'ISO';
});

// idle camera drift behind the menu
camera.position.set(0, 60, 120);
camera.lookAt(0, 0, 0);
reset();          // park a scene behind the menu
tick();

import * as THREE from 'three';
import {
  buildCity, makeCarDetailed, makeTrafficCarGeometry, makePedGeometry, lightPhase,
} from './world.js';
import { Traffic } from './traffic.js';
import { Peds } from './peds.js';
import { input, initInput } from './input.js';
import { createSim, resetSim, stepGame, dampAngle, PLAYER } from './sim.js';

// Bump this on every release — it's shown in the HUD corner and the menu so
// players can tell whether they're on the latest deployed build.
const GAME_VERSION = '1.1.0';

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
const world = { traffic, peds };

// ------------------------------------------------------------------- state ---
// All game-logic state lives in sim (shared with the headless test harness);
// main.js only owns meshes, the camera, and UI.
const sim = createSim();
let state = 'menu';           // menu | playing | over
let worldTime = 0;
let sirenT = 0;
const copMeshes = new Map();  // cop id -> THREE.Group

const player = { mesh: makeCarDetailed({ color: 0xd23b3b }) };
scene.add(player.mesh);

const el = (id) => document.getElementById(id);
const scoreEl = el('score'), menuEl = el('menu'), overEl = el('over');

function syncPlayerMesh(dt) {
  const p = sim.player;
  player.mesh.position.set(p.x, 0, p.z);
  player.mesh.rotation.y = p.heading;
  // body roll into the turn + wheel visuals
  const sf = Math.min(1, Math.abs(p.speed) / PLAYER.maxSpeed);
  player.mesh.userData.body.rotation.z = -sim.steer * 0.07 * sf;
  const spin = (p.speed / 0.42) * dt;
  player.mesh.userData.wheels.forEach((w, i) => {
    w.rotation.x += spin;
    if (i < 2) w.rotation.y = sim.steer * 0.42;
  });
}

function syncCopMeshes(dt) {
  sirenT += dt;
  const phase = Math.floor(sirenT * 6) % 2 === 0;
  const alive = new Set();
  for (const c of sim.cops) {
    alive.add(c.id);
    let m = copMeshes.get(c.id);
    if (!m) {
      m = makeCarDetailed({ police: true });
      scene.add(m);
      copMeshes.set(c.id, m);
    }
    m.position.set(c.x, 0, c.z);
    m.rotation.y = c.stun > 0 ? c.heading + c.spin : c.heading;
    const s = m.userData.siren;
    if (s) {
      s.red.emissiveIntensity = phase ? 2.5 : 0.15;
      s.blue.emissiveIntensity = phase ? 0.15 : 2.5;
    }
  }
  for (const [id, m] of copMeshes) {
    if (!alive.has(id)) {
      scene.remove(m);
      copMeshes.delete(id);
    }
  }
}

function reset() {
  for (const [, m] of copMeshes) scene.remove(m);
  copMeshes.clear();
  resetSim(sim, traffic);
  camHeading = 0; curDist = 12.5;
  syncPlayerMesh(0);
  syncCopMeshes(0);
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
  el('overStats').textContent = `${sim.elapsed.toFixed(1)}s · ${Math.round(sim.distance)}m`;
  overEl.classList.remove('hidden');
}

// ------------------------------------------------------------------ camera ---
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(0, 0, 0);
let curFov = 62, curDist = 12.5, camHeading = 0;
function updateCamera(dt) {
  const p = sim.player;
  // the camera follows a DAMPED heading that lags the car: micro-adjustments
  // don't whip the view around, but sustained turns still swing it with you
  camHeading = dampAngle(camHeading, p.heading, 3.5, dt);
  const fx = Math.sin(camHeading), fz = Math.cos(camHeading);
  // pull back when the cops are right on your bumper — more room to see the chase
  const wantDist = 12.5 + (sim.nearestCop < 18 ? (18 - sim.nearestCop) * 0.45 : 0);
  curDist += (Math.min(wantDist, 19) - curDist) * (1 - Math.exp(-dt * 3));
  camPos.set(p.x - fx * curDist, 6.2 + (curDist - 12.5) * 0.35, p.z - fz * curDist);
  camLook.set(p.x + fx * 8, 1.3, p.z + fz * 8);
  const k = 1 - Math.exp(-dt * 5.5);
  camera.position.lerp(camPos, k);
  _lookCur.lerp(camLook, 1 - Math.exp(-dt * 8));
  camera.lookAt(_lookCur);
  // speed sensation: widen the FOV as you go faster
  const targetFov = 62 + 10 * Math.min(1, Math.abs(p.speed) / PLAYER.maxSpeed);
  curFov += (targetFov - curFov) * (1 - Math.exp(-dt * 4));
  if (Math.abs(curFov - camera.fov) > 0.05) {
    camera.fov = curFov;
    camera.updateProjectionMatrix();
  }
  sun.position.set(p.x + 45, 75, p.z + 28);
  sun.target.position.set(p.x, 0, p.z);
}
const _lookCur = new THREE.Vector3(0, 0, 0);

// --------------------------------------------------------------------- loop ---
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  worldTime += dt;

  city.setPhase(lightPhase(worldTime));
  traffic.update(dt, worldTime, sim.player.x, sim.player.z, sim.player.heading, Math.abs(sim.player.speed));
  peds.update(dt, worldTime, { player: sim.player, cops: sim.cops, traffic });

  if (state === 'playing') {
    const outcome = stepGame(sim, input, dt, world, null);
    syncPlayerMesh(dt);
    syncCopMeshes(dt);
    if (outcome) endGame(outcome);
    else scoreEl.textContent = `${sim.elapsed.toFixed(1)}s`;
  }
  if (state !== 'menu') {
    if (sim.wrapped) {
      // toroidal wrap: snap the camera across the seam instead of sweeping 540m
      updateCamera(0);
      camera.position.copy(camPos);
      _lookCur.copy(camLook);
      sim.wrapped = false;
    }
    updateCamera(dt);
  }
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
el('ver').textContent = 'v' + GAME_VERSION;
el('menuVer').textContent = 'v' + GAME_VERSION;
console.log(`[split-second] v${GAME_VERSION}`);
reset();
tick();

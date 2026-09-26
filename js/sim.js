import { WRAP, HALF, wrapCoord, lanesFor, lanePos, hitsSolids } from './world.js';

// ---------------------------------------------------------------------------
// SPLIT SECOND — pure game simulation (player + police). No THREE, no DOM.
// The browser game (main.js) and the headless test harness share this module,
// so behavior under test is exactly behavior in the shipped game.
// ---------------------------------------------------------------------------

export const PLAYER = {
  accel: 17, maxSpeed: 28, brake: 36, revAccel: 11, revMax: -9,
  radius: 1.7, steerRate: 7.5, maxTurn: 3.6,
};
export const COP = { maxSpeed: 26.5, accel: 17, turn: 2.3, bustDist: 3.6 };
export const REVERSE_DELAY = 0.7;

export function turnToward(cur, target, maxDelta) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-maxDelta, Math.min(maxDelta, d));
}

export function dampAngle(cur, target, lambda, dt) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.exp(-lambda * dt));
}

export function createSim() {
  return {
    player: { x: 0, z: 0, heading: 0, speed: 0 },
    steer: 0, brakeHeld: 0,
    elapsed: 0, distance: 0,
    cops: [], trail: [],
    nearestCop: Infinity,
    nextCopId: 1,
    wrapped: false,     // set when the player wraps around the toroidal city this tick
    lastHazard: null,   // 'solid' | 'traffic' | 'ped' — set on WRECKED
    ghost: false,       // when true, crash checks are skipped (harness only)
  };
}

export function spawnCop(s, x, z) {
  const dx = s.player.x - x, dz = s.player.z - z;
  const cop = {
    id: s.nextCopId++, x, z,
    heading: Math.atan2(dx, dz), speed: 10,
    stun: 0, grace: 0, spin: 0, spinVel: 0,
    skill: 0.85 + Math.random() * 0.3,   // turn-rate variance
    lag: Math.random() * 0.15,           // reaction-time variance
  };
  s.cops.push(cop);
  return cop;
}

export function spawnCopFar(s) {
  // drop a cop 100-140m from the player to keep the pressure on forever
  for (let tries = 0; tries < 12; tries++) {
    const a = Math.random() * Math.PI * 2, d = 100 + Math.random() * 40;
    // wrap-aware: anywhere on the torus is fair game as long as it's clear
    const x = wrapCoord(s.player.x + Math.cos(a) * d), z = wrapCoord(s.player.z + Math.sin(a) * d);
    if (hitsSolids(x, z, 4)) continue;
    return spawnCop(s, x, z);
  }
  return spawnCop(s, wrapCoord(s.player.x + 110), s.player.z);  // fallback: almost never used
}

export function resetSim(s, traffic) {
  // start on the central avenue (line 5 -> x=0), in a +z lane
  const lanes = lanesFor('x', 5);
  const lane = lanes.find(l => l.dir > 0) || lanes[0];
  const p = lanePos('x', 5, lane, -60);
  s.player.x = p.x; s.player.z = p.z; s.player.heading = 0; s.player.speed = 0;
  s.elapsed = 0; s.distance = 0; s.brakeHeld = 0; s.steer = 0;
  s.trail.length = 0; s.cops.length = 0; s.nearestCop = Infinity; s.lastHazard = null;
  s.wrapped = false;
  if (traffic) traffic.scatter(s.player.x, s.player.z, 60);
  spawnCopFar(s); spawnCopFar(s);
}

// recent player positions — cops aim at where you WERE (~0.35s ago),
// like a human reacting, instead of mirroring your every twitch
function delayedPlayerPos(s, delay) {
  const target = s.elapsed - delay;
  for (let i = s.trail.length - 1; i >= 0; i--) {
    if (s.trail[i].t <= target) return s.trail[i];
  }
  return s.trail[0] || s.player;
}

// input: {left, right}. world: {traffic, peds}.
// Returns 'WRECKED!' when the run ends, else null.
export function stepPlayer(s, input, dt, world) {
  const p = s.player;
  const braking = input.left && input.right;

  if (braking) {
    s.brakeHeld += dt;
    p.speed = Math.max(0, p.speed - PLAYER.brake * dt);
    if (p.speed <= 0.01 && s.brakeHeld > REVERSE_DELAY) {
      p.speed = Math.max(p.speed - PLAYER.revAccel * dt, PLAYER.revMax);
    }
  } else {
    s.brakeHeld = 0;
    p.speed = Math.min(p.speed + PLAYER.accel * dt, PLAYER.maxSpeed);
  }

  // --- analog steering: binary input eases into a smooth steer value ---
  const target = (input.left ? 1 : 0) - (input.right ? 1 : 0);  // +1 = left
  const d = target - s.steer;
  s.steer += Math.max(-PLAYER.steerRate * dt, Math.min(PLAYER.steerRate * dt, d));

  const spd = Math.abs(p.speed);
  const grip = Math.min(1, spd / 9);                              // no turning when parked
  const taper = 1 - 0.32 * Math.min(1, Math.max(0, (spd - 19) / 9)); // stability at speed
  const dir = p.speed >= 0 ? 1 : -1;
  p.heading += s.steer * PLAYER.maxTurn * grip * taper * dir * dt;

  const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  p.x += fx * p.speed * dt;
  p.z += fz * p.speed * dt;
  s.distance += spd * dt;

  // --- toroidal city: driving off one edge loops onto the opposite edge.
  // WRAP is a multiple of the road pitch, so the street grid lines up exactly.
  let wdx = 0, wdz = 0;
  if (p.x > HALF) wdx = -WRAP; else if (p.x < -HALF) wdx = WRAP;
  if (p.z > HALF) wdz = -WRAP; else if (p.z < -HALF) wdz = WRAP;
  if (wdx || wdz) {
    p.x += wdx; p.z += wdz;
    for (const h of s.trail) { h.x += wdx; h.z += wdz; }  // keep cop aim continuous
    for (const c of s.cops) { c.x += wdx; c.z += wdz; }   // preserve pursuit geometry
    s.wrapped = true;
  }

  // --- crashes: buildings, poles, traffic, pedestrians (no more wall death) ---
  if (!s.ghost) {
    if (hitsSolids(p.x, p.z, PLAYER.radius)) { s.lastHazard = 'solid'; return 'WRECKED!'; }
    if (world.traffic.playerHit(p.x, p.z)) { s.lastHazard = 'traffic'; return 'WRECKED!'; }
    if (world.peds.playerHit(p.x, p.z)) { s.lastHazard = 'ped'; return 'WRECKED!'; }
  }
  return null;
}

// world: {traffic}. events: optional array receiving {t, type, ...}.
// Returns 'BUSTED!' when the run ends, else null.
export function stepCops(s, dt, world, events) {
  const p = s.player;

  // heat: you never truly outrun them — fresh cops keep joining the chase
  const want = Math.min(2 + Math.floor(s.elapsed / 20), 7);
  if (s.cops.length < want) spawnCopFar(s);

  s.nearestCop = Infinity;

  for (let ci = s.cops.length - 1; ci >= 0; ci--) {
    const c = s.cops[ci];
    // the city is a torus: keep the cop's coordinates near the player's so raw
    // distance equals toroidal distance (matters at the seam)
    if (c.x - p.x > HALF) c.x -= WRAP; else if (c.x - p.x < -HALF) c.x += WRAP;
    if (c.z - p.z > HALF) c.z -= WRAP; else if (c.z - p.z < -HALF) c.z += WRAP;
    const dx = p.x - c.x, dz = p.z - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist < s.nearestCop) s.nearestCop = dist;
    if (dist < COP.bustDist) return 'BUSTED!';
    // a cop that falls way behind re-enters elsewhere — the chase never ends
    if (dist > 175) {
      s.cops.splice(ci, 1);
      spawnCopFar(s);
      continue;
    }
    if (c.grace > 0) c.grace -= dt;

    if (c.stun > 0) {
      // crashed into traffic: spin out, then recover
      c.stun -= dt;
      c.spin += c.spinVel * dt;
      c.spinVel *= Math.max(0, 1 - 2.2 * dt);
    } else {
      // human-like pursuit: aim at the delayed position, with personal skill
      const aim = delayedPlayerPos(s, 0.35 + c.lag);
      let desired = Math.atan2(aim.x - c.x, aim.z - c.z);
      const px = c.x + Math.sin(c.heading) * 7, pz = c.z + Math.cos(c.heading) * 7;
      if (hitsSolids(px, pz, 2.5)) desired = c.heading + 1.35;          // buildings/poles
      else if (world.traffic.near(px, pz, 5)) desired = c.heading - 1.1; // traffic

      c.heading = turnToward(c.heading, desired, COP.turn * c.skill * dt);
      c.speed = Math.min(c.speed + COP.accel * dt, COP.maxSpeed);
      c.x += Math.sin(c.heading) * c.speed * dt;
      c.z += Math.cos(c.heading) * c.speed * dt;

      // slamming into traffic wrecks the cop — bait them into it
      const hit = world.traffic.near(c.x, c.z, 3.0);
      if (hit && c.grace <= 0) {
        world.traffic.shove(hit);
        c.stun = 2.4; c.grace = 4.0; c.speed = 0; c.spin = 0;
        c.spinVel = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 3);
        if (events) events.push({ t: s.elapsed, type: 'cop-stun', x: c.x, z: c.z });
      }
    }
  }

  // cop-vs-cop separation: no more piling on top of each other
  for (let a = 0; a < s.cops.length; a++) {
    for (let b = a + 1; b < s.cops.length; b++) {
      const A = s.cops[a], B = s.cops[b];
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
  return null;
}

// One full game tick. Returns 'WRECKED!' | 'BUSTED!' | null.
export function stepGame(s, input, dt, world, events) {
  s.elapsed += dt;
  s.wrapped = false;
  s.trail.push({ x: s.player.x, z: s.player.z, t: s.elapsed });
  while (s.trail.length > 2 && s.trail[0].t < s.elapsed - 0.7) s.trail.shift();
  return stepPlayer(s, input, dt, world) || stepCops(s, dt, world, events);
}

import * as THREE from 'three';
import { LINES, linePos, lanesFor, headingFor, lightPhase, axisGo, roadWidth, roadType, HALF, WRAP } from './world.js';

// Traffic: ambient cars driving the lane network. They obey traffic lights,
// queue behind each other, turn at intersections, brake for a stopped player,
// and ~70% of drivers actively evade a player bearing down on them
// (the rest freeze — unpredictable, like real panic).
// Rendered as ONE InstancedMesh (single draw call); per-frame JS is kept
// cheap via lane buckets instead of O(n^2) checks.

const COUNT = 320;
const TINTS = [0x5a7fb5, 0x9aa0a6, 0xd9d9d9, 0x3a3a3a, 0xc5a13e, 0x8a4a4a, 0x4a7a5a, 0x7a5a9a];
const rand = (a, b) => a + Math.random() * (b - a);

function turnToward(cur, target, maxDelta) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-maxDelta, Math.min(maxDelta, d));
}

function moveToward(cur, target, maxDelta) {
  const d = target - cur;
  return cur + Math.max(-maxDelta, Math.min(maxDelta, d));
}

export class Traffic {
  constructor(scene, carGeo) {
    this.mesh = new THREE.InstancedMesh(carGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.dummy = new THREE.Object3D();
    this.cars = [];
    const c = new THREE.Color();
    for (let k = 0; k < COUNT; k++) {
      this.mesh.setColorAt(k, c.setHex(TINTS[k % TINTS.length]).multiplyScalar(rand(0.85, 1.1)));
      this.cars.push(this.makeCar(0, 0, 50));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  makeCar(px, pz, clearDist) {
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const line = (Math.random() * LINES) | 0;
    const lanes = lanesFor(axis, line);
    const laneIdx = (Math.random() * lanes.length) | 0;
    const lane = lanes[laneIdx];
    let t = rand(-HALF, HALF), tries = 0;
    while (tries++ < 12) {
      const p = this.rawPos(axis, line, lane, 0, t);
      if (Math.hypot(p.x - px, p.z - pz) >= clearDist) break;
      t = rand(-HALF, HALF);
    }
    const h = headingFor(axis, lane.dir);
    return {
      axis, line, lanes, laneIdx, t,
      dir: lane.dir, speed: rand(6, 9), cruise: rand(10, 14),
      hCur: h, hTarget: h, node: -1,
      lat: 0, latVel: 0, evadeTarget: 0, evadeHold: 0,  // lateral offset for evasion/shove
      nerve: Math.random(),             // <0.3 freezes, mid brakes, high swerves
      shoveT: 0, shoveLat: 0,           // set when a cop slams into it
      _x: 0, _z: 0,
    };
  }

  rawPos(axis, line, lane, lat, t) {
    if (axis === 'x') return { x: linePos(line) + lane.offset + lat, z: t };
    return { x: t, z: linePos(line) + lane.offset + lat };
  }

  // push every car within `clearDist` of (px,pz) somewhere else (post-reset)
  scatter(px, pz, clearDist = 60) {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const p = this.rawPos(car.axis, car.line, car.lanes[car.laneIdx], car.lat, car.t);
      if (Math.hypot(p.x - px, p.z - pz) < clearDist) this.cars[i] = this.makeCar(px, pz, clearDist);
    }
  }

  respawn(i, px, pz) { this.cars[i] = this.makeCar(px, pz, 120); }

  nextNode(car) {
    let best = -1, bestD = Infinity;
    for (let j = 0; j < LINES; j++) {
      const d = (linePos(j) - car.t) * car.dir;
      if (d > 1 && d < bestD) { bestD = d; best = j; }
    }
    return { j: best, d: bestD };
  }

  // a cop slammed into this car: shove it sideways with a spin, then recover
  shove(car) {
    car.shoveT = 0.9;
    car.shoveLat = (Math.random() < 0.5 ? -1 : 1) * rand(4, 7);
    car.speed = Math.min(car.speed + 5, 16);
  }

  update(dt, time, px, pz, pHeading, pSpeed) {
    const phase = lightPhase(time);
    const cars = this.cars, n = cars.length;

    // lane buckets: cheap "car ahead" checks without O(n^2)
    const buckets = new Map();
    for (let i = 0; i < n; i++) {
      const car = cars[i];
      const key = car.axis + car.line + ':' + car.laneIdx;
      let b = buckets.get(key);
      if (!b) { b = []; buckets.set(key, b); }
      b.push(car);
    }

    const pfx = Math.sin(pHeading), pfz = Math.cos(pHeading);

    for (let i = 0; i < n; i++) {
      const car = cars[i];
      const lane = car.lanes[car.laneIdx];
      const fx = Math.sin(car.hCur), fz = Math.cos(car.hCur);
      const rx = fz, rz = -fx;   // right vector
      const pp = this.rawPos(car.axis, car.line, lane, car.lat, car.t);
      const x = pp.x, z = pp.z;

      const { j, d } = this.nextNode(car);
      let want = car.cruise;

      // queue behind cars ahead in the same lane (needed for the box check below)
      const bucket = buckets.get(car.axis + car.line + ':' + car.laneIdx);
      for (let k = 0; k < bucket.length; k++) {
        const o = bucket[k];
        if (o === car) continue;
        const gap = (o.t - car.t) * car.dir;
        if (gap > 0 && gap < 14) want = Math.min(want, o.speed * Math.max(0, Math.min(1, (gap - 4.5) / 9)));
      }

      // intersection discipline: stop BEFORE the box, never inside it.
      // stopD is measured from the intersection edge (wide avenues need more room).
      // Once committed past the line, clear the box instead of stopping in it.
      if (j >= 0 && d < 34) {
        const stopD = Math.max(roadWidth(car.line), roadWidth(j)) / 2 + 3.5;
        if (d > stopD - 1) {
          let hold = !axisGo(phase, car.axis);   // red / yellow: wait
          if (!hold) {
            // green, but a stopped queue is backed up across the box: don't enter
            for (let k = 0; k < bucket.length; k++) {
              const o = bucket[k];
              if (o === car) continue;
              const gap = (o.t - car.t) * car.dir;
              if (gap > d - 4 && gap < d + 16 && o.speed < 2) { hold = true; break; }
            }
          }
          if (hold) want = Math.min(want, Math.max(0, (d - stopD) * 0.9));
        }
      }

      // --- the player as a threat ---
      const relX = px - x, relZ = pz - z;
      const ahead = relX * fx + relZ * fz;      // + = in front of the car
      const latP = relX * rx + relZ * rz;       // + = player's on car's right
      const headOn = (pfx * fx + pfz * fz) < -0.4;   // player driving at the car
      const sameWay = (pfx * fx + pfz * fz) > 0.5;

      // player stopped/blocking the lane ahead: brake
      if (ahead > 0 && ahead < 15 && Math.abs(latP) < 2.8 && pSpeed < 4) {
        want = Math.min(want, Math.max(0, (ahead - 6) * 0.8));
      }
      // evasion: player bearing down head-on, or closing fast from behind
      const threat = (headOn && ahead > 0 && ahead < 34 && Math.abs(latP) < 4.6 && pSpeed > 6) ||
                     (sameWay && ahead < 0 && ahead > -20 && Math.abs(latP) < 3.2 && pSpeed > car.speed + 6);
      if (threat && car.shoveT <= 0) {
        if (car.nerve > 0.62) {
          car.evadeTarget = (latP >= 0 ? -3.6 : 3.6);   // swerve away, hard
          want = Math.min(want, car.cruise * 0.85);
        } else if (car.nerve > 0.3) {
          car.evadeTarget = (latP >= 0 ? -1.6 : 1.6);   // panic-brake + slight swerve
          want = 0;
        }
        // nerve <= 0.3: freeze — does nothing, stays unpredictable
        car.evadeHold = 0.9;  // hold the dodge briefly so it never flickers in and out
      } else if (car.shoveT <= 0) {
        car.evadeHold -= dt;
        if (car.evadeHold <= 0) { car.evadeHold = 0; car.evadeTarget = 0; }
      }

      // integrate lateral offset (evasion + cop shove).
      // Evasion is rate-limited to a lane-change-like 2.4 m/s: a deliberate
      // swerve with the nose leading, never a sideways snap.
      const prevLat = car.lat;
      if (car.shoveT > 0) {
        car.shoveT -= dt;
        car.lat += car.shoveLat * dt;
        car.shoveLat *= Math.max(0, 1 - 3 * dt);
      } else {
        car.lat = moveToward(car.lat, car.evadeTarget, 2.4 * dt);
        car.lat = Math.max(-5.5, Math.min(5.5, car.lat));
      }
      car.latVel = dt > 0 ? (car.lat - prevLat) / dt : 0;

      car.speed += Math.max(-24 * dt, Math.min(9 * dt, want - car.speed));
      if (car.speed < 0) car.speed = 0;
      car.t += car.dir * car.speed * dt;

      // intersection: maybe turn
      if (j >= 0 && Math.abs(car.t - linePos(j)) < 2.5 && car.node !== j) {
        const oldLine = car.line;
        car.node = j;
        if (Math.random() > 0.55) {
          const left = Math.random() > 0.5;
          let hNew = car.hTarget + (left ? -Math.PI / 2 : Math.PI / 2);
          while (hNew > Math.PI) hNew -= Math.PI * 2;
          while (hNew < -Math.PI) hNew += Math.PI * 2;
          const newAxis = car.axis === 'x' ? 'z' : 'x';
          const reqDir = newAxis === 'x' ? (Math.abs(hNew) < Math.PI / 2 ? 1 : -1) : (hNew > 0 ? 1 : -1);
          // one-way target street: never turn into the oncoming direction — a
          // wrong-way car meets traffic head-on and the pair deadlocks in the box.
          // (Keep straight instead.)
          const oneWayS = roadType(j) === 'oneway' ? (j % 2 === 0 ? 1 : -1) : 0;
          if (oneWayS === 0 || reqDir === oneWayS) {
          const newLanes = lanesFor(newAxis, j);
          let bestL = 0, bestO = Infinity;
          newLanes.forEach((L, idx) => {
            if (L.dir === reqDir && Math.abs(L.offset) < bestO) { bestO = Math.abs(L.offset); bestL = idx; }
          });
          // carry the world position (including any swerve offset) through the
          // turn: project it into the new lane frame so the car never pops sideways
          const p = this.rawPos(car.axis, car.line, lane, car.lat, car.t);
          const nl = newLanes[bestL];
          car.axis = newAxis; car.line = j; car.lanes = newLanes; car.laneIdx = bestL;
          car.dir = reqDir;
          if (newAxis === 'x') { car.t = p.z; car.lat = p.x - (linePos(j) + nl.offset); }
          else { car.t = p.x; car.lat = p.z - (linePos(j) + nl.offset); }
          car.lat = Math.max(-5.5, Math.min(5.5, car.lat));
          car.hTarget = hNew;
          car.evadeTarget = 0; car.evadeHold = 0;
          // the intersection just turned at, expressed as a node on the NEW
          // axis, is always the old road (oldLine) — guard it so the car
          // can't re-trigger and whip around twice in the same box
          car.node = oldLine;
          } // end one-way guard
        }
      }
      car.hCur = turnToward(car.hCur, car.hTarget, 4.5 * dt);

      const pos = this.rawPos(car.axis, car.line, car.lanes[car.laneIdx], car.lat, car.t);
      car._x = pos.x; car._z = pos.z;

      // toroidal city: cars loop around the edge instead of vanishing.
      // WRAP is a multiple of the road pitch, so lanes stay aligned.
      if (Math.abs(car.t) > HALF + 8) {
        car.t += car.t > 0 ? -WRAP : WRAP;
        car.node = -1;  // re-arm intersection logic at the new location
        const pw = this.rawPos(car.axis, car.line, car.lanes[car.laneIdx], car.lat, car.t);
        car._x = pw.x; car._z = pw.z;
      } else if (Math.hypot(pos.x - px, pos.z - pz) > 400) {
        // recycle cars that wandered far from the player (density management)
        this.respawn(i, px, pz);
        const c2 = this.cars[i];
        const p2 = this.rawPos(c2.axis, c2.line, c2.lanes[c2.laneIdx], 0, c2.t);
        c2._x = p2.x; c2._z = p2.z;
      }

      const c3 = this.cars[i];
      this.dummy.position.set(c3._x, 0, c3._z);
      // yaw into the swerve: the nose leads the lateral motion like a real
      // lane change, instead of the body drafting sideways while pointing straight
      const wobble = c3.shoveT > 0 ? Math.sin(c3.shoveT * 20) * 0.35
        : Math.max(-0.35, Math.min(0.35, (c3.latVel || 0) * 0.12));
      this.dummy.rotation.set(0, c3.hCur + wobble, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  playerHit(x, z) {
    for (const car of this.cars) {
      const dx = car._x - x, dz = car._z - z;
      if (dx * dx + dz * dz < 3.1 * 3.1) return true;
    }
    return false;
  }

  near(x, z, r) {
    for (const car of this.cars) {
      const dx = car._x - x, dz = car._z - z;
      if (dx * dx + dz * dz < r * r) return car;
    }
    return null;
  }
}

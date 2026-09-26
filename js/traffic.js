import * as THREE from 'three';
import { LINES, linePos, lanesFor, headingFor, lanePos, lightPhase, axisGo, HALF } from './world.js';

// Traffic: ambient cars driving the lane network. They obey traffic lights,
// queue behind each other, and pick random turns at intersections.
// Rendered as ONE InstancedMesh (single draw call).

const COUNT = 34;
const TINTS = [0x5a7fb5, 0x9aa0a6, 0xd9d9d9, 0x3a3a3a, 0xc5a13e, 0x8a4a4a, 0x4a7a5a, 0x7a5a9a];
const rand = (a, b) => a + Math.random() * (b - a);

function turnToward(cur, target, maxDelta) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
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
      this.cars.push(this.makeCar(0, 0, true));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  makeCar(px, pz, anywhere) {
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const line = (Math.random() * LINES) | 0;
    const lanes = lanesFor(axis, line);
    const laneIdx = (Math.random() * lanes.length) | 0;
    const lane = lanes[laneIdx];
    let t = rand(-HALF, HALF);
    // keep clear of the player spawn area on first fill
    if (anywhere) {
      const p = lanePos(axis, line, lane, t);
      let tries = 0;
      while (Math.hypot(p.x - px, p.z - pz) < 60 && tries++ < 12) {
        t = rand(-HALF, HALF);
        Object.assign(p, lanePos(axis, line, lane, t));
      }
    }
    return {
      axis, line, lanes, laneIdx, t,
      dir: lane.dir,
      speed: rand(6, 9),
      cruise: rand(10, 14),
      hCur: headingFor(axis, lane.dir),
      hTarget: headingFor(axis, lane.dir),
      node: -1,
    };
  }

  respawn(i, px, pz) {
    // recycle a far-away car somewhere distant from the player
    let tries = 0, car;
    do {
      car = this.makeCar(px, pz, false);
      const p = lanePos(car.axis, car.line, car.lanes[car.laneIdx], car.t);
      car._px = p.x; car._pz = p.z;
      tries++;
    } while (Math.hypot(car._px - px, car._pz - pz) < 120 && tries < 10);
    this.cars[i] = car;
  }

  // nearest intersection index ahead along the car's travel
  nextNode(car) {
    let best = -1, bestD = Infinity;
    for (let j = 0; j < LINES; j++) {
      const d = (linePos(j) - car.t) * car.dir;
      if (d > 1 && d < bestD) { bestD = d; best = j; }
    }
    return { j: best, d: bestD };
  }

  update(dt, time, px, pz) {
    const phase = lightPhase(time);
    const n = this.cars.length;

    for (let i = 0; i < n; i++) {
      const car = this.cars[i];
      const lane = car.lanes[car.laneIdx];
      const { j, d } = this.nextNode(car);

      // desired speed: cruise, slowed by red lights and cars ahead
      let want = car.cruise;
      if (j >= 0 && d < 32 && !axisGo(phase, car.axis)) {
        want = Math.min(want, Math.max(0, (d - 7) * 0.9));   // stop at the line
      }
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const o = this.cars[k];
        if (o.axis !== car.axis || o.line !== car.line || o.laneIdx !== car.laneIdx) continue;
        const gap = (o.t - car.t) * car.dir;
        if (gap > 0 && gap < 14) want = Math.min(want, o.speed * Math.max(0, Math.min(1, (gap - 4.5) / 9)));
      }
      car.speed += Math.max(-22 * dt, Math.min(9 * dt, want - car.speed));
      if (car.speed < 0) car.speed = 0;
      car.t += car.dir * car.speed * dt;

      // intersection: maybe turn
      if (j >= 0 && Math.abs(car.t - linePos(j)) < 2.5 && car.node !== j) {
        const oldLine = car.line;
        car.node = j;
        const r = Math.random();
        if (r > 0.55) {  // turn left or right onto the crossing road
          const left = r > 0.775;
          let hNew = car.hTarget + (left ? -Math.PI / 2 : Math.PI / 2);
          while (hNew > Math.PI) hNew -= Math.PI * 2;
          while (hNew < -Math.PI) hNew += Math.PI * 2;
          const newAxis = car.axis === 'x' ? 'z' : 'x';
          const reqDir = newAxis === 'x' ? (Math.abs(hNew) < Math.PI / 2 ? 1 : -1) : (hNew > 0 ? 1 : -1);
          const newLanes = lanesFor(newAxis, j);
          let bestL = 0, bestO = Infinity;
          newLanes.forEach((L, idx) => {
            if (L.dir === reqDir && Math.abs(L.offset) < bestO) { bestO = Math.abs(L.offset); bestL = idx; }
          });
          const p = lanePos(car.axis, car.line, lane, car.t);
          car.axis = newAxis; car.line = j; car.lanes = newLanes; car.laneIdx = bestL;
          car.dir = reqDir;
          car.t = newAxis === 'x' ? p.z : p.x;
          car.hTarget = hNew;
          // crossings on the new axis are indexed by the line we came from
          car.node = newAxis === 'z' ? oldLine : j;
        }
      }
      car.hCur = turnToward(car.hCur, car.hTarget, 4.5 * dt);

      // recycle far-away cars (or ones that reached the map edge)
      const p = lanePos(car.axis, car.line, car.lanes[car.laneIdx], car.t);
      if (Math.abs(car.t) > HALF + 8 || Math.hypot(p.x - px, p.z - pz) > 400) this.respawn(i, px, pz);

      const c2 = this.cars[i];
      const p2 = lanePos(c2.axis, c2.line, c2.lanes[c2.laneIdx], c2.t);
      this.dummy.position.set(p2.x, 0, p2.z);
      this.dummy.rotation.set(0, c2.hCur, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  playerHit(x, z) {
    for (const car of this.cars) {
      const p = lanePos(car.axis, car.line, car.lanes[car.laneIdx], car.t);
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < 3.1 * 3.1) return true;
    }
    return false;
  }

  // for cop avoidance: is there a traffic car near (x,z)?
  near(x, z, r) {
    for (const car of this.cars) {
      const p = lanePos(car.axis, car.line, car.lanes[car.laneIdx], car.t);
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < r * r) return car;
    }
    return null;
  }

  // knock a car away (cop plowed through it) — respawn it far from player
  knock(car, px, pz) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.respawn(i, px, pz);
  }
}

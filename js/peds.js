import * as THREE from 'three';
import { LINES, linePos, roadWidth, HALF, WRAP, wrapCoord } from './world.js';

// Pedestrians with simple but lively behavior:
//  - stroll the sidewalks
//  - cross streets at intersections (and HURRY while in the roadway)
//  - dive out of the way of vehicles bearing down on them
// One InstancedMesh, per-instance color. Touch one and the run is over.

const COUNT = 750;
const SHIRTS = [0xd25a5a, 0x5a7fd2, 0x5ad27a, 0xd2c55a, 0x9a5ad2, 0x5ad2c5, 0xe8e8e8, 0x333333];
const rand = (a, b) => a + Math.random() * (b - a);

const WALK = 0, CROSS = 1, FLEE = 2;

export class Peds {
  constructor(scene, pedGeo) {
    this.mesh = new THREE.InstancedMesh(pedGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.dummy = new THREE.Object3D();
    this.peds = [];
    const c = new THREE.Color();
    for (let k = 0; k < COUNT; k++) {
      this.mesh.setColorAt(k, c.setHex(SHIRTS[k % SHIRTS.length]));
      this.peds.push(this.make());
    }
    this.mesh.instanceColor.needsUpdate = true;
    this._frame = 0;
  }

  make() {
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const line = (Math.random() * LINES) | 0;
    const side = Math.random() < 0.5 ? -1 : 1;
    const p = {
      state: WALK, axis, line,
      off: side * (roadWidth(line) / 2 + 2.1),
      t: rand(-HALF, HALF), dir: Math.random() < 0.5 ? -1 : 1,
      speed: rand(1.1, 2.2), ph: rand(0, 6.28),
      x: 0, z: 0, h: 0, fx: 0, fz: 0, tx: 0, tz: 0, fleeT: 0,
    };
    this.place(p);
    return p;
  }

  // derive x/z/h from sidewalk params
  place(p) {
    if (p.axis === 'x') { p.x = linePos(p.line) + p.off; p.z = p.t; p.h = p.dir > 0 ? 0 : Math.PI; }
    else { p.x = p.t; p.z = linePos(p.line) + p.off; p.h = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
  }

  pos(p) { return p; }  // peds carry their own x/z now

  // start crossing the road at the nearest intersection node (the crosswalk)
  tryCross(p) {
    let best = -1, bd = 3.5;  // only when already at the crosswalk — no teleporting
    for (let j = 0; j < LINES; j++) {
      const d = Math.abs(linePos(j) - p.t);
      if (d < bd) { bd = d; best = j; }
    }
    if (best < 0) return;
    const nz = linePos(best);
    const cx = p.axis === 'x' ? linePos(p.line) : nz;
    const cz = p.axis === 'x' ? nz : linePos(p.line);
    const half = roadWidth(p.line) / 2 + 2.1;
    const s = Math.sign(p.off) || 1;
    p.fx = p.axis === 'x' ? cx + s * half : cx;  // from: near sidewalk
    p.fz = p.axis === 'x' ? cz : cz + s * half;
    p.tx = p.axis === 'x' ? cx - s * half : cx;  // to: far sidewalk
    p.tz = p.axis === 'x' ? cz : cz - s * half;
    p.x = p.fx; p.z = p.fz;
    p.state = CROSS;
    p.speed = rand(2.8, 3.4);  // hurry — nobody dawdles in the road
  }

  // vehicle at (vx,vz) with velocity (vvx,vvz) is a threat: run from where
  // it's about to be, biased sideways to clear its path
  flee(p, vx, vz, vvx, vvz) {
    const px = vx + vvx * 0.55, pz = vz + vvz * 0.55;  // where it's headed
    let dx = p.x - px, dz = p.z - pz;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    const sp = Math.hypot(vvx, vvz) || 1;
    const nx = -vvz / sp, nz = vvx / sp;  // perpendicular to its motion
    const s = (dx * nx + dz * nz) >= 0 ? 1 : -1;
    dx = dx * 0.6 + nx * s * 0.8; dz = dz * 0.6 + nz * s * 0.8;
    const dd = Math.hypot(dx, dz) || 1;
    p.fx = dx / dd; p.fz = dz / dd;
    p.fleeT = rand(0.9, 1.4);
    p.state = FLEE;
    p.speed = rand(4.6, 5.6);
    p.h = Math.atan2(p.fx, p.fz);
  }

  // is the vehicle at (x,z) with velocity (vx,vz) going to be uncomfortably
  // close to the ped soon?
  threat(p, x, z, vx, vz, radius) {
    const dx = p.x - x, dz = p.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > radius * radius) return false;
    const v2 = vx * vx + vz * vz;
    if (v2 < 9) return d2 < 9;  // slow/parked: threat only if basically touching
    const tca = -(dx * vx + dz * vz) / v2;  // time of closest approach
    if (tca < -0.2 || tca > 1.4) return false;
    const cx = x + vx * Math.max(0, tca) - p.x, cz = z + vz * Math.max(0, tca) - p.z;
    return cx * cx + cz * cz < 30;
  }

  // world: {player, cops, traffic}. Threat scans are staggered across frames.
  update(dt, time, world) {
    const { player, cops, traffic } = world;
    const pvx = Math.sin(player.heading) * player.speed;
    const pvz = Math.cos(player.heading) * player.speed;
    this._frame++;

    for (let k = 0; k < this.peds.length; k++) {
      const p = this.peds[k];

      if (p.state === WALK) {
        p.t += p.dir * p.speed * dt;
        if (p.t > HALF) p.t -= WRAP; else if (p.t < -HALF) p.t += WRAP;
        this.place(p);
        // maybe cross at an intersection
        if ((k + this._frame) % 3 === 0 && Math.random() < 0.004) this.tryCross(p);
        // threat scan (staggered): player + cops
        if (p.state === WALK && (k + this._frame) % 2 === 0) {
          if (this.threat(p, player.x, player.z, pvx, pvz, 11)) {
            this.flee(p, player.x, player.z, pvx, pvz);
          } else {
            for (const c of cops) {
              if (c.stun > 0) continue;
              const cvx = Math.sin(c.heading) * c.speed, cvz = Math.cos(c.heading) * c.speed;
              if (this.threat(p, c.x, c.z, cvx, cvz, 10)) { this.flee(p, c.x, c.z, cvx, cvz); break; }
            }
          }
        }
      } else if (p.state === CROSS) {
        // hurry across; panic-sprint if traffic is coming
        let sp = p.speed;
        const car = traffic.near(p.x, p.z, 16);
        if (car && Math.abs(car.speed) > 4) sp = 4.9;
        else if (this.threat(p, player.x, player.z, pvx, pvz, 10)) { this.flee(p, player.x, player.z, pvx, pvz); continue; }
        const dx = p.tx - p.x, dz = p.tz - p.z;
        const d = Math.hypot(dx, dz);
        const step = sp * dt;
        if (d <= step + 0.15) {
          // arrived: resume strolling on the far sidewalk
          p.state = WALK;
          p.off = -(Math.sign(p.off) || 1) * (roadWidth(p.line) / 2 + 2.1);
          p.t = p.axis === 'x' ? p.z : p.x;
          if (p.t > HALF) p.t -= WRAP; else if (p.t < -HALF) p.t += WRAP;
          p.dir = Math.random() < 0.5 ? -1 : 1;
          p.speed = rand(1.1, 2.2);
          this.place(p);
        } else {
          p.x += dx / d * step; p.z += dz / d * step;
          p.h = Math.atan2(dx, dz);
        }
      } else {  // FLEE
        p.x += p.fx * p.speed * dt;
        p.z += p.fz * p.speed * dt;
        p.x = wrapCoord(p.x); p.z = wrapCoord(p.z);
        p.fleeT -= dt;
        if (p.fleeT <= 0) {
          // catch breath on the nearest sidewalk of the same road
          p.state = WALK;
          const c = p.axis === 'x' ? p.x : p.z;
          p.off = (c >= linePos(p.line) ? 1 : -1) * (roadWidth(p.line) / 2 + 2.1);
          p.t = p.axis === 'x' ? p.z : p.x;
          p.speed = rand(1.1, 2.2);
          this.place(p);
        }
      }

      const bob = Math.abs(Math.sin(time * (p.state === WALK ? 7 : 11) + p.ph)) * 0.07;
      this.dummy.position.set(p.x, bob, p.z);
      this.dummy.rotation.set(0, p.h, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(k, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  playerHit(x, z) {
    for (const p of this.peds) {
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < 1.7 * 1.7) return true;
    }
    return false;
  }
}

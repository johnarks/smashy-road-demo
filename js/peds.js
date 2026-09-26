import * as THREE from 'three';
import { LINES, linePos, roadWidth, HALF } from './world.js';

// Pedestrians strolling the sidewalks. One InstancedMesh, per-instance color.
// Touch one and the run is over.

const COUNT = 750;
const SHIRTS = [0xd25a5a, 0x5a7fd2, 0x5ad27a, 0xd2c55a, 0x9a5ad2, 0x5ad2c5, 0xe8e8e8, 0x333333];
const rand = (a, b) => a + Math.random() * (b - a);

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
  }

  make() {
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const line = (Math.random() * LINES) | 0;
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = side * (roadWidth(line) / 2 + 2.1);
    return { axis, line, off, t: rand(-HALF, HALF), dir: Math.random() < 0.5 ? -1 : 1, speed: rand(1.1, 2.2), ph: rand(0, 6.28) };
  }

  pos(p) {
    if (p.axis === 'x') return { x: linePos(p.line) + p.off, z: p.t };
    return { x: p.t, z: linePos(p.line) + p.off };
  }

  update(dt, time) {
    for (let k = 0; k < this.peds.length; k++) {
      const p = this.peds[k];
      p.t += p.dir * p.speed * dt;
      if (p.t > HALF + 20) p.t = -HALF - 20;
      if (p.t < -HALF - 20) p.t = HALF + 20;
      const { x, z } = this.pos(p);
      const bob = Math.abs(Math.sin(time * 7 + p.ph)) * 0.07;
      this.dummy.position.set(x, bob, z);
      // face walking direction
      const h = p.axis === 'x' ? (p.dir > 0 ? 0 : Math.PI) : (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.dummy.rotation.set(0, h, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(k, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  playerHit(x, z) {
    for (const p of this.peds) {
      const q = this.pos(p);
      const dx = q.x - x, dz = q.z - z;
      if (dx * dx + dz * dz < 1.7 * 1.7) return true;
    }
    return false;
  }
}

import * as THREE from 'three';
import { fbm, smoothstep, lerp, clamp, mulberry32 } from './noise.js';

export const WORLD_SIZE = 1800;          // full width of the playable square
export const WATER_LEVEL = 2.0;
export const PLATEAU_HEIGHT = 26;        // castle sits on this shelf

const LAKE = { x: 260, z: 330, r: 230 };

// Single source of truth for ground height — used by the mesh, the trees,
// the player collision and the flight controller.
export function groundHeight(x, z) {
  const n = fbm(x * 0.0022, z * 0.0022, 5);
  let h = 8 + n * 26;

  // rolling foothills get steeper away from the centre, rising into a
  // mountain ring near the world edge
  const d = Math.hypot(x, z);
  const mountain = smoothstep(560, 880, d);
  h += mountain * (40 + fbm(x * 0.004 + 9.2, z * 0.004 - 3.1, 4) * 90);

  // lake basin
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  const lake = smoothstep(LAKE.r, LAKE.r * 0.35, ld);
  h = lerp(h, WATER_LEVEL - 9, lake);

  // castle plateau: flatten a shelf and let it fall away as a cliff
  const shelf = smoothstep(230, 120, d);
  h = lerp(h, PLATEAU_HEIGHT + fbm(x * 0.01, z * 0.01, 2) * 0.8, shelf);

  return h;
}

export function buildTerrain(scene) {
  const segs = 220;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const grass = new THREE.Color(0x3d6b34);
  const grassDry = new THREE.Color(0x5a7a3a);
  const rock = new THREE.Color(0x6b6560);
  const rockDark = new THREE.Color(0x4a4540);
  const snow = new THREE.Color(0xe8ecf2);
  const sand = new THREE.Color(0x8a815c);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundHeight(x, z);
    pos.setY(i, h);

    // colour by altitude + noise breakup
    const jitter = fbm(x * 0.02 + 4.4, z * 0.02 - 7.7, 3) * 0.5 + 0.5;
    if (h < WATER_LEVEL + 1.5) {
      c.copy(sand);
    } else if (h > 95) {
      c.copy(rock).lerp(snow, smoothstep(95, 130, h));
    } else if (h > 55) {
      c.copy(rockDark).lerp(rock, jitter);
    } else {
      c.copy(grass).lerp(grassDry, jitter);
      // rockier near cliffs (steep slopes)
      const s = slope(x, z);
      c.lerp(rock, smoothstep(0.55, 1.1, s));
      // worn flagstone plaza on the castle plateau
      const dc = Math.hypot(x, z);
      c.lerp(rock, smoothstep(130, 60, dc) * (0.55 + jitter * 0.3));
    }
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);

  // water: one big plane; the basin dips below it, everything else sits above
  const waterGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 48, 48);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x14344e, roughness: 0.15, metalness: 0.55,
    transparent: true, opacity: 0.86,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = WATER_LEVEL;
  scene.add(water);

  return { mesh, water };
}

function slope(x, z) {
  const e = 2.5;
  const dx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const dz = groundHeight(x, z + e) - groundHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e) * 2.5;
}

export function buildForest(scene) {
  const rand = mulberry32(20260702);
  const MAX = 900;
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 4, 5);
  trunkGeo.translate(0, 2, 0);
  const foliageGeo = new THREE.ConeGeometry(3.2, 11, 7);
  foliageGeo.translate(0, 9, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 1 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x1d4022, roughness: 1 });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX);
  const tops = new THREE.InstancedMesh(foliageGeo, foliageMat, MAX);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scl = new THREE.Vector3();
  const colr = new THREE.Color();

  let count = 0;
  let guard = 0;
  while (count < MAX && guard++ < MAX * 30) {
    const x = (rand() * 2 - 1) * WORLD_SIZE * 0.46;
    const z = (rand() * 2 - 1) * WORLD_SIZE * 0.46;
    const h = groundHeight(x, z);
    const dCastle = Math.hypot(x, z);
    if (h < WATER_LEVEL + 2.5 || h > 78) continue;    // no trees in water / high rock
    if (dCastle < 210) continue;                       // keep the castle grounds clear
    if (slope(x, z) > 0.9) continue;                   // not on cliffs
    // denser in mid-distance woods
    const density = 0.35 + 0.65 * smoothstep(240, 420, dCastle);
    if (rand() > density) continue;

    const s = 0.7 + rand() * 1.3;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    scl.set(s, s * (0.85 + rand() * 0.5), s);
    m.compose(new THREE.Vector3(x, h - 0.3, z), q, scl);
    trunks.setMatrixAt(count, m);
    tops.setMatrixAt(count, m);
    colr.setHSL(0.32 + rand() * 0.06, 0.45, 0.16 + rand() * 0.1);
    tops.setColorAt(count, colr);
    count++;
  }
  trunks.count = count;
  tops.count = count;
  trunks.castShadow = tops.castShadow = true;
  scene.add(trunks, tops);
}

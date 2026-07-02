import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLATEAU_HEIGHT, groundHeight } from './terrain.js';
import { mulberry32 } from './noise.js';

// Procedural castle generator. Produces merged meshes (one draw call per
// material) plus a list of simple colliders for the walking controller.

const Y = PLATEAU_HEIGHT;

export function buildCastle(scene) {
  const stone = [];      // main masonry
  const darkStone = [];  // trim, battlements, arches
  const roof = [];       // slate roofs and spires
  const glassGeos = [];  // emissive windows
  const colliders = { cylinders: [], boxes: [] };
  const rand = mulberry32(9042);

  // ---- geometry helpers ------------------------------------------------
  function box(list, w, h, d, x, y, z, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    list.push(g);
  }
  function cyl(list, rTop, rBot, h, x, y, z, seg = 12) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    g.translate(x, y, z);
    list.push(g);
  }
  function cone(list, r, h, x, y, z, seg = 12) {
    const g = new THREE.ConeGeometry(r, h, seg);
    g.translate(x, y, z);
    list.push(g);
  }

  function battlements(cx, cz, radiusOrW, topY, opts = {}) {
    // ring of merlons around a tower top, or along a wall (opts.wall)
    if (opts.wall) {
      const { dx, dz, len } = opts.wall;
      const n = Math.floor(len / 3);
      for (let i = 0; i <= n; i += 2) {
        const t = i / n - 0.5;
        box(darkStone, 1.4, 1.6, 1.4, cx + dx * t * len, topY + 0.8, cz + dz * t * len, opts.ry || 0);
      }
    } else {
      const n = Math.max(8, Math.floor(radiusOrW * 2.2));
      for (let i = 0; i < n; i += 2) {
        const a = (i / n) * Math.PI * 2;
        box(darkStone, 1.2, 1.5, 1.2, cx + Math.cos(a) * radiusOrW, topY + 0.75, cz + Math.sin(a) * radiusOrW, -a);
      }
    }
  }

  function windowsOnTower(x, z, r, baseY, height) {
    const rows = Math.floor(height / 9);
    for (let row = 1; row <= rows; row++) {
      const y = baseY + row * (height / (rows + 1));
      const n = 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + row * 0.4;
        const wx = x + Math.cos(a) * (r + 0.15);
        const wz = z + Math.sin(a) * (r + 0.15);
        const g = new THREE.BoxGeometry(0.25, 2.4, 1.1);
        g.rotateY(-a);
        g.translate(wx, y, wz);
        glassGeos.push(g);
      }
    }
  }

  function windowsOnWall(cx, cz, len, y, ry, rows = 1) {
    const n = Math.max(2, Math.floor(len / 7));
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        const g = new THREE.BoxGeometry(1.3, 3.0, 0.3);
        g.translate(t * len, y + row * 6, 0);
        g.rotateY(ry);
        g.translate(cx, 0, cz);
        glassGeos.push(g);
      }
    }
  }

  function tower(x, z, r, h, { spire = true, base = Y } = {}) {
    cyl(stone, r, r * 1.12, h, x, base + h / 2, z, 14);
    // corbelled crown
    cyl(darkStone, r * 1.25, r * 1.05, 2.2, x, base + h + 1.1, z, 14);
    if (spire) {
      cone(roof, r * 1.3, r * 3.6, x, base + h + 2.2 + r * 1.8, z, 14);
      // little golden finial
      cyl(darkStone, 0.12, 0.12, 2.2, x, base + h + 2.2 + r * 3.6, z, 6);
    } else {
      battlements(x, z, r * 1.15, base + h + 2.2);
    }
    windowsOnTower(x, z, r, base + 4, h - 6);
    colliders.cylinders.push({ x, z, r: r * 1.15, top: base + h + (spire ? r * 3.6 : 3) });
    return { x, z, r, h };
  }

  function wall(x1, z1, x2, z2, h, thick = 3) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const ry = -Math.atan2(dz, dx);
    box(stone, len, h, thick, 0, 0, 0);
    const g = stone.pop();
    g.rotateY(ry);
    g.translate(cx, Y + h / 2, cz);
    stone.push(g);
    // walkway parapet
    battlements(cx, cz, 0, Y + h, { wall: { dx: dx / len, dz: dz / len, len }, ry });
    windowsOnWall(cx, cz, len, Y + h * 0.55, ry);
    // axis-aligned-ish collider (expand to cover rotation)
    const pad = thick / 2 + Math.min(Math.abs(dx), Math.abs(dz)) / 2 + 0.5;
    colliders.boxes.push({
      minX: Math.min(x1, x2) - pad, maxX: Math.max(x1, x2) + pad,
      minZ: Math.min(z1, z2) - pad, maxZ: Math.max(z1, z2) + pad,
      top: Y + h + 2,
    });
  }

  function hall(cx, cz, w, d, h, ry = 0) {
    box(stone, w, h, d, cx, Y + h / 2, cz, ry);
    // pitched roof (triangular prism)
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 - 0.8, 0); shape.lineTo(w / 2 + 0.8, 0); shape.lineTo(0, w * 0.42);
    shape.closePath();
    const prism = new THREE.ExtrudeGeometry(shape, { depth: d + 1.6, bevelEnabled: false });
    prism.translate(0, 0, -(d + 1.6) / 2);
    prism.rotateY(ry);
    prism.translate(cx, Y + h, cz);
    roof.push(prism);
    // tall arched windows along both long sides
    windowsOnWall(cx + Math.sin(ry) * 0, cz, d, Y + h * 0.6, ry + Math.PI / 2, 1);
    const off = (w / 2 + 0.2);
    for (const s of [-1, 1]) {
      const wx = cx + s * off * Math.cos(ry);
      const wz = cz - s * off * Math.sin(ry);
      windowsOnWall(wx, wz, d - 4, Y + h * 0.55, ry + Math.PI / 2, 2);
    }
    colliders.boxes.push({
      minX: cx - w / 2 - 1, maxX: cx + w / 2 + 1,
      minZ: cz - d / 2 - 1, maxZ: cz + d / 2 + 1,
      top: Y + h + w * 0.42,
    });
    // buttresses so the long walls aren't blank slabs
    for (const s of [-1, 1]) {
      const n = Math.floor(d / 9);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        const bx = cx + Math.cos(ry) * s * (w / 2 + 0.6) - Math.sin(ry) * t * d;
        const bz = cz - Math.sin(ry) * s * (w / 2 + 0.6) - Math.cos(ry) * t * d;
        box(darkStone, 1.6, h * 0.8, 1.6, bx, Y + h * 0.4, bz, ry);
      }
    }
  }

  // ---- layout ------------------------------------------------------------
  // Great hall — the heart of the academy
  hall(0, -10, 26, 64, 22);
  // transept hall crossing it
  hall(-28, -34, 22, 46, 18, Math.PI / 2);
  // keep behind
  hall(34, -34, 30, 30, 28);

  // grand astronomy tower — the tallest point
  tower(36, -36, 8, 74);
  // supporting cluster around the keep
  tower(20, -52, 5, 46);
  tower(52, -20, 5.5, 52);
  tower(-52, -34, 6.5, 58);
  tower(-14, -44, 4.5, 40);

  // curtain wall square with corner towers
  const c1 = tower(-78, -78, 7, 34, { spire: false });
  const c2 = tower(78, -78, 7, 36);
  const c3 = tower(78, 66, 7, 34, { spire: false });
  const c4 = tower(-78, 66, 7, 38);
  wall(c1.x, c1.z, c2.x, c2.z, 15);
  wall(c2.x, c2.z, c3.x, c3.z, 15);
  wall(c4.x, c4.z, c1.x, c1.z, 15);
  // south wall split by the gatehouse
  wall(c3.x, c3.z, 14, 66, 15);
  wall(-14, 66, c4.x, c4.z, 15);

  // gatehouse: twin towers flanking an open arch
  tower(11, 66, 4.5, 26);
  tower(-11, 66, 4.5, 26);
  {
    // arch over the gate
    const shape = new THREE.Shape();
    shape.moveTo(-11, 0); shape.lineTo(11, 0); shape.lineTo(11, 14); shape.lineTo(-11, 14);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 6.5, 5.2, Math.PI, 0, true);
    hole.lineTo(5.2, 0); hole.lineTo(-5.2, 0);
    shape.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 5, bevelEnabled: false });
    g.translate(0, Y, 63.5);
    darkStone.push(g);
  }

  // cloister around an inner courtyard (small columns + lintel)
  {
    const cx = -34, cz = 22, half = 22;
    for (let i = -half; i <= half; i += 5.5) {
      cyl(darkStone, 0.6, 0.7, 6, cx + i, Y + 3, cz - half, 8);
      cyl(darkStone, 0.6, 0.7, 6, cx + i, Y + 3, cz + half, 8);
      cyl(darkStone, 0.6, 0.7, 6, cx - half, Y + 3, cz + i, 8);
      cyl(darkStone, 0.6, 0.7, 6, cx + half, Y + 3, cz + i, 8);
    }
    box(darkStone, half * 2 + 2, 1, 2.4, cx, Y + 6.5, cz - half);
    box(darkStone, half * 2 + 2, 1, 2.4, cx, Y + 6.5, cz + half);
    box(darkStone, 2.4, 1, half * 2 + 2, cx - half, Y + 6.5, cz);
    box(darkStone, 2.4, 1, half * 2 + 2, cx + half, Y + 6.5, cz);
  }

  // long viaduct marching south off the plateau, arches stepping downhill
  {
    const z0 = 70, z1 = 250;
    const spanW = 9;
    const shape = new THREE.Shape();
    const totalLen = z1 - z0;
    shape.moveTo(0, 0); shape.lineTo(totalLen, 0); shape.lineTo(totalLen, 16); shape.lineTo(0, 16);
    shape.closePath();
    const nArch = Math.floor(totalLen / 18);
    for (let i = 0; i < nArch; i++) {
      const ax = 9 + i * 18;
      const hole = new THREE.Path();
      hole.absarc(ax, 8, 6, Math.PI, 0, true);
      hole.lineTo(ax + 6, 0); hole.lineTo(ax - 6, 0);
      hole.closePath();
      shape.holes.push(hole);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: spanW, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    // deck at plateau height; piers reach down toward the falling ground
    g.translate(-spanW / 2 + 0, Y - 16, z0);
    stone.push(g);
    // parapets along the deck
    box(darkStone, 1, 1.6, totalLen, -spanW / 2 + 0.5, Y + 0.8, (z0 + z1) / 2);
    box(darkStone, 1, 1.6, totalLen, spanW / 2 - 0.5, Y + 0.8, (z0 + z1) / 2);
    // deck surface
    box(darkStone, spanW, 0.6, totalLen, 0, Y - 0.3, (z0 + z1) / 2);
    // lonely gate tower beside the far end of the deck
    tower(14, z1 + 4, 5, 24, { base: groundHeight(14, z1 + 4) - 2 });
  }

  // boathouse by the lake with a long stair (suggested by slabs)
  {
    const bx = 180, bz = 258;
    const by = groundHeight(bx, bz);
    box(stone, 12, 6, 9, bx, by + 3, bz);
    const shape = new THREE.Shape();
    shape.moveTo(-7, 0); shape.lineTo(7, 0); shape.lineTo(0, 5);
    shape.closePath();
    const prism = new THREE.ExtrudeGeometry(shape, { depth: 10, bevelEnabled: false });
    prism.translate(0, 0, -5);
    prism.translate(bx, by + 6, bz);
    roof.push(prism);
    windowsOnWall(bx, bz + 4.6, 10, by + 3, 0);
  }

  // a few outlying turrets on the cliff edge for silhouette drama
  tower(-120, 10, 5, 30, { base: groundHeight(-120, 10) - 3 });
  tower(96, -110, 5.5, 34, { base: groundHeight(96, -110) - 3 });

  // scattered rocky rubble around the base of the plateau
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const d = 150 + rand() * 90;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const s = 1 + rand() * 3;
    box(darkStone, s, s * 0.8, s, x, groundHeight(x, z) + s * 0.2, z, rand() * Math.PI);
  }

  // ---- merge + materials ---------------------------------------------------
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.95 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x5d5852, roughness: 0.95 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2e3b4e, roughness: 0.6, metalness: 0.15 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x2a2417, emissive: 0xffb14e, emissiveIntensity: 0.0, roughness: 0.4,
  });

  for (const [geos, mat, shadow] of [
    [stone, stoneMat, true],
    [darkStone, darkMat, true],
    [roof, roofMat, true],
    [glassGeos, glassMat, false],
  ]) {
    if (!geos.length) continue;
    const merged = BufferGeometryUtils.mergeGeometries(geos.map(g => g.toNonIndexed()));
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    group.add(mesh);
  }
  scene.add(group);

  return { group, colliders, glassMat };
}

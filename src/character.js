import * as THREE from 'three';

// Procedural low-poly wizard rider + broomstick, visible in flight mode.

export function buildRider() {
  const g = new THREE.Group();

  // --- broom ---
  const broom = new THREE.Group();
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x6e4a22, roughness: 0.7 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 3.4, 8), handleMat);
  handle.rotation.x = Math.PI / 2;
  broom.add(handle);

  const bristleMat = new THREE.MeshStandardMaterial({ color: 0xa8823c, roughness: 1 });
  const bristles = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.3, 9), bristleMat);
  bristles.rotation.x = Math.PI / 2;
  bristles.position.z = 2.2;
  broom.add(bristles);
  // binding ring
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.13, 0.045, 6, 10),
    new THREE.MeshStandardMaterial({ color: 0xc9a94e, metalness: 0.6, roughness: 0.4 })
  );
  ring.position.z = 1.55;
  broom.add(ring);
  // little foot pegs
  const pegMat = new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.8 });
  for (const s of [-1, 1]) {
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), pegMat);
    peg.rotation.z = Math.PI / 2;
    peg.position.set(s * 0.22, -0.12, 0.9);
    broom.add(peg);
  }
  g.add(broom);

  // --- rider ---
  const rider = new THREE.Group();
  const robeMat = new THREE.MeshStandardMaterial({ color: 0x27204a, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a97e, roughness: 0.8 });
  const hatMat = new THREE.MeshStandardMaterial({ color: 0x1c1636, roughness: 0.9 });

  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.15, 9), robeMat);
  robe.position.y = 0.55;
  rider.add(robe);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), robeMat);
  chest.position.y = 1.05;
  chest.scale.set(1, 1.15, 0.85);
  rider.add(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), skinMat);
  head.position.y = 1.5;
  rider.add(head);

  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.05, 12), hatMat);
  brim.position.y = 1.64;
  rider.add(brim);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 10), hatMat);
  hat.position.set(0.02, 1.9, 0.03);
  hat.rotation.z = -0.15;
  rider.add(hat);

  // arms reaching forward to the handle
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.85, 6), robeMat);
    arm.position.set(s * 0.2, 1.05, -0.42);
    arm.rotation.x = 1.25;
    arm.rotation.z = s * -0.25;
    rider.add(arm);
  }
  // legs tucked back
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.8, 6), robeMat);
    leg.position.set(s * 0.2, 0.25, 0.5);
    leg.rotation.x = -1.9;
    rider.add(leg);
  }

  rider.position.set(0, 0.08, 0.45); // seated slightly back on the handle
  rider.rotation.x = 0.12;           // lean forward
  g.add(rider);

  // scarf tail that flutters (animated in main loop)
  const scarfMat = new THREE.MeshStandardMaterial({ color: 0x8e2b2b, roughness: 1, side: THREE.DoubleSide });
  const scarf = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 1.0, 1, 6), scarfMat);
  scarf.position.set(0.1, 1.35, 0.75);
  scarf.rotation.x = Math.PI / 2.4;
  g.add(scarf);

  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group: g, scarf, rider };
}

// Sparkle trail behind the broom while flying.
export function buildTrail(scene, max = 260) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(max * 3);
  const life = new Float32Array(max).fill(0);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // soft round sprite drawn on a tiny canvas — no texture files
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const cx = cv.getContext('2d');
  const grad = cx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,220,150,0.6)');
  grad.addColorStop(1, 'rgba(255,200,100,0)');
  cx.fillStyle = grad;
  cx.fillRect(0, 0, 32, 32);
  const sprite = new THREE.CanvasTexture(cv);

  const mat = new THREE.PointsMaterial({
    color: 0xffd98a, size: 0.6, sizeAttenuation: true, map: sprite,
    transparent: true, opacity: 0.8, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  let head = 0;
  function emit(p, rand) {
    positions[head * 3] = p.x + (rand() - 0.5) * 0.6;
    positions[head * 3 + 1] = p.y + (rand() - 0.5) * 0.6;
    positions[head * 3 + 2] = p.z + (rand() - 0.5) * 0.6;
    life[head] = 1;
    head = (head + 1) % max;
  }
  function update(dt) {
    for (let i = 0; i < max; i++) {
      if (life[i] > 0) {
        life[i] -= dt * 0.8;
        positions[i * 3 + 1] -= dt * 0.6; // gentle fall
        if (life[i] <= 0) positions[i * 3 + 1] = -9999;
      }
    }
    geo.attributes.position.needsUpdate = true;
  }
  return { emit, update };
}

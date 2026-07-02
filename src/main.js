import * as THREE from 'three';
import { buildTerrain, buildForest, groundHeight, WATER_LEVEL, PLATEAU_HEIGHT } from './terrain.js';
import { buildCastle } from './castle.js';
import { buildSky } from './sky.js';
import { buildRider, buildTrail } from './character.js';
import { createAudio } from './audio.js';
import { mulberry32, clamp, lerp } from './noise.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 6000);

buildTerrain(scene);
buildForest(scene);
const castle = buildCastle(scene);
const sky = buildSky(scene);
const rider = buildRider();
rider.group.visible = false;
scene.add(rider.group);
const trail = buildTrail(scene);
const audio = createAudio();
const rand = mulberry32(4242);

// warm lanterns in the courtyard (a few real lights, cheap)
const lanterns = [];
for (const [lx, lz] of [[-34, 22], [0, 40], [24, 10], [-10, -60]]) {
  const y = PLATEAU_HEIGHT + 4;
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffc36b })
  );
  glow.position.set(lx, y, lz);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.12, 4, 6),
    new THREE.MeshStandardMaterial({ color: 0x2b2b2e })
  );
  post.position.set(lx, y - 2, lz);
  const light = new THREE.PointLight(0xffb45e, 0, 34, 2);
  light.position.copy(glow.position);
  scene.add(glow, post, light);
  lanterns.push({ light, glow });
}

// ---------------------------------------------------------------------------
// Golden rings — a flying course around the castle
// ---------------------------------------------------------------------------
const rings = [];
{
  const ringGeo = new THREE.TorusGeometry(4.2, 0.5, 10, 28);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xd7a63c, emissive: 0xa87614, emissiveIntensity: 0.6,
    metalness: 0.8, roughness: 0.3,
  });
  const spots = [
    [0, 60, 160], [90, 75, 90], [150, 55, -40], [90, 95, -150],
    [-40, 120, -190], [-150, 85, -110], [-190, 60, 30], [-120, 45, 150],
    [0, 40, 260], [180, 35, 300], [260, 30, 200], [40, 140, 0],
    [-60, 170, -40], [220, 90, -220], [-260, 110, -240], [320, 60, 60],
    [-320, 70, 180], [0, 210, -320],
  ];
  for (const [x, y, z] of spots) {
    const m = new THREE.Mesh(ringGeo, ringMat.clone());
    m.position.set(x, Math.max(y, groundHeight(x, z) + 12), z);
    m.lookAt(0, m.position.y, 0); // face the castle so the course flows around it
    scene.add(m);
    rings.push({ mesh: m, taken: false, spin: rand() * Math.PI * 2 });
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = new Set();
let pointerLocked = false;
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyF' && pointerLocked) toggleFly();
});
addEventListener('keyup', e => keys.delete(e.code));

let yaw = 0;            // facing the castle from the south at spawn
let pitch = -0.05;
addEventListener('mousemove', e => {
  if (!pointerLocked) return;
  yaw -= e.movementX * 0.0023;
  pitch -= e.movementY * 0.0023;
  pitch = clamp(pitch, -1.45, 1.45);
});

const overlay = document.getElementById('overlay');
const hudMsg = document.getElementById('msg');
const hudRings = document.getElementById('rings');
const hudSpeed = document.getElementById('speed');
const hudMode = document.getElementById('mode');

overlay.addEventListener('click', () => {
  canvas.requestPointerLock();
  audio.resume();
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  overlay.style.display = pointerLocked ? 'none' : 'flex';
});

let msgTimer = 0;
function say(text, secs = 2.5) {
  hudMsg.textContent = text;
  hudMsg.style.opacity = 1;
  msgTimer = secs;
}

// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------
const player = {
  pos: new THREE.Vector3(-14, 0, 306), // start just off the far end of the viaduct
  vel: new THREE.Vector3(),
  flying: false,
  onGround: false,
  speed: 0,           // scalar cruise speed while flying
  roll: 0,
};
player.pos.y = groundHeight(player.pos.x, player.pos.z) + 1.7;

const EYE = 1.7;
const WALK = 9, RUN = 16;
const FLY_MAX = 46, FLY_BOOST = 85;

function toggleFly() {
  if (!player.flying) {
    player.flying = true;
    player.speed = Math.max(10, player.vel.length());
    rider.group.visible = true;
    audio.whoosh();
    say('Broomstick mounted — hold W to speed up, Shift to boost');
  } else {
    const g = groundHeight(player.pos.x, player.pos.z);
    if (player.pos.y - g < 6) {
      player.flying = false;
      player.vel.set(0, 0, 0);
      rider.group.visible = false;
      say('Dismounted');
    } else {
      say('Too high to dismount — descend first');
    }
  }
  hudMode.textContent = player.flying ? 'FLYING' : 'ON FOOT';
}

function resolveCollisions(p) {
  // push out of tower cylinders and hall/wall boxes (2D, capped by height)
  let hit = false;
  for (const c of castle.colliders.cylinders) {
    if (c.top !== undefined && p.y > c.top) continue;
    const dx = p.x - c.x, dz = p.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + 0.6;
    if (d < min && d > 0.0001) {
      p.x = c.x + dx / d * min;
      p.z = c.z + dz / d * min;
      hit = true;
    }
  }
  for (const b of castle.colliders.boxes) {
    if (b.top !== undefined && p.y > b.top) continue;
    if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ) {
      // push out along the smallest penetration axis
      const pens = [
        [p.x - b.minX, -1, 0], [b.maxX - p.x, 1, 0],
        [p.z - b.minZ, 0, -1], [b.maxZ - p.z, 0, 1],
      ].sort((a, u) => a[0] - u[0]);
      const [pen, nx, nz] = pens[0];
      p.x += nx * pen; p.z += nz * pen;
      hit = true;
    }
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Per-frame update
// ---------------------------------------------------------------------------
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();
const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3();
const trailTip = new THREE.Vector3();
let hasPlayed = false;
let ringsTaken = 0;
let time = 0;

function updateWalking(dt) {
  fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(-fwd.z, 0, fwd.x);
  wish.set(0, 0, 0);
  if (keys.has('KeyW')) wish.add(fwd);
  if (keys.has('KeyS')) wish.sub(fwd);
  if (keys.has('KeyD')) wish.add(right);
  if (keys.has('KeyA')) wish.sub(right);
  if (wish.lengthSq() > 0) wish.normalize();
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN : WALK;
  player.vel.x = lerp(player.vel.x, wish.x * speed, 1 - Math.pow(0.0001, dt));
  player.vel.z = lerp(player.vel.z, wish.z * speed, 1 - Math.pow(0.0001, dt));

  player.vel.y -= 28 * dt; // gravity
  const g = groundHeight(player.pos.x, player.pos.z);
  if (player.onGround && keys.has('Space')) {
    player.vel.y = 10.5;
    player.onGround = false;
  }

  player.pos.addScaledVector(player.vel, dt);
  resolveCollisions(player.pos);

  const floor = groundHeight(player.pos.x, player.pos.z);
  if (player.pos.y <= floor + EYE) {
    player.pos.y = floor + EYE;
    player.vel.y = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }
  // don't sink into the lake — wade at the surface
  if (player.pos.y < WATER_LEVEL + EYE * 0.6 && floor < WATER_LEVEL) {
    player.pos.y = WATER_LEVEL + EYE * 0.6;
    player.vel.y = Math.max(0, player.vel.y);
    player.onGround = true;
  }
  void g;

  // first-person camera with a touch of head bob
  const bob = Math.sin(time * 9) * Math.min(1, Math.hypot(player.vel.x, player.vel.z) / WALK) * 0.05;
  camera.position.set(player.pos.x, player.pos.y + bob, player.pos.z);
  camera.rotation.set(0, 0, 0);
  camera.rotateY(yaw);
  camera.rotateX(pitch);
  camera.fov = lerp(camera.fov, 72, 1 - Math.pow(0.01, dt));
  camera.updateProjectionMatrix();

  audio.setWind(0);
  hudSpeed.textContent = '';
}

function updateFlying(dt) {
  // aim from yaw/pitch
  fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();

  const boosting = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const maxSpeed = boosting ? FLY_BOOST : FLY_MAX;
  if (keys.has('KeyW')) player.speed += (boosting ? 55 : 30) * dt;
  else if (keys.has('KeyS')) player.speed -= 40 * dt;
  else player.speed -= 6 * dt; // gentle glide decay
  player.speed = clamp(player.speed, 4, maxSpeed);

  // velocity chases the aim direction — gives a swoopy, carving feel
  const desired = fwd.clone().multiplyScalar(player.speed);
  if (keys.has('Space')) desired.y += 14;
  if (keys.has('KeyA')) desired.addScaledVector(right.set(fwd.z, 0, -fwd.x).normalize(), -12);
  if (keys.has('KeyD')) desired.addScaledVector(right, 12);
  player.vel.lerp(desired, 1 - Math.pow(0.02, dt));
  player.pos.addScaledVector(player.vel, dt);

  // bounce off castle masonry instead of phasing through it
  if (resolveCollisions(player.pos)) player.speed *= 0.9;

  // terrain / water is a hard floor
  const floor = Math.max(groundHeight(player.pos.x, player.pos.z), WATER_LEVEL) + 1.2;
  if (player.pos.y < floor) {
    player.pos.y = floor;
    player.vel.y = Math.max(0, player.vel.y);
    player.speed *= 0.985; // scraping the ground bleeds speed
  }
  // soft world bounds
  const bound = 860;
  if (Math.abs(player.pos.x) > bound || Math.abs(player.pos.z) > bound) {
    say('Turning back — the mist beyond the mountains is impassable');
    player.pos.x = clamp(player.pos.x, -bound, bound);
    player.pos.z = clamp(player.pos.z, -bound, bound);
  }

  // orient the rider: face velocity, bank into turns
  const speedFrac = player.speed / FLY_BOOST;
  const targetYaw = Math.atan2(-player.vel.x, -player.vel.z);
  let dYaw = targetYaw - rider.group.rotation.y;
  while (dYaw > Math.PI) dYaw -= Math.PI * 2;
  while (dYaw < -Math.PI) dYaw += Math.PI * 2;
  player.roll = lerp(player.roll, clamp(-dYaw * 2.2, -0.9, 0.9), 1 - Math.pow(0.001, dt));

  rider.group.position.copy(player.pos);
  rider.group.rotation.set(0, 0, 0);
  rider.group.rotateY(rider.group.rotation.y + targetYaw);
  const velPitch = Math.asin(clamp(player.vel.y / Math.max(1, player.vel.length()), -1, 1));
  rider.group.rotateX(-velPitch * 0.7);
  rider.group.rotateZ(player.roll);

  // scarf flutter
  rider.scarf.rotation.x = Math.PI / 2.4 + Math.sin(time * 13) * 0.25 * (0.3 + speedFrac);

  // chase camera
  const back = fwd.clone().multiplyScalar(-9 - speedFrac * 5);
  camTarget.copy(player.pos).addScaledVector(player.vel, 0.06).add(new THREE.Vector3(0, 1.2, 0));
  camPos.copy(player.pos).add(back).add(new THREE.Vector3(0, 3.2, 0));
  const camFloor = Math.max(groundHeight(camPos.x, camPos.z), WATER_LEVEL) + 0.8;
  if (camPos.y < camFloor) camPos.y = camFloor;
  camera.position.lerp(camPos, 1 - Math.pow(0.0005, dt));
  camera.lookAt(camTarget);
  camera.rotateZ(player.roll * 0.35);

  // FOV widens with speed for a sense of rush
  camera.fov = lerp(camera.fov, 72 + speedFrac * 18, 1 - Math.pow(0.01, dt));
  camera.updateProjectionMatrix();

  // trail + wind (emit from the bristle end, behind the rider)
  if (player.speed > 8) {
    trailTip.copy(player.pos).addScaledVector(player.vel, -0.09);
    trail.emit(trailTip, rand);
  }
  audio.setWind(speedFrac);
  hudSpeed.textContent = Math.round(player.speed * 3.6) + ' km/h';

  // ring pickups
  for (const r of rings) {
    if (r.taken) continue;
    if (r.mesh.position.distanceTo(player.pos) < 5.5) {
      r.taken = true;
      r.mesh.visible = false;
      ringsTaken++;
      audio.chime();
      hudRings.textContent = `✦ ${ringsTaken} / ${rings.length}`;
      say(ringsTaken === rings.length
        ? 'All rings collected — you are a true flyer! ✨'
        : `Ring collected! ${rings.length - ringsTaken} to go`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
hudRings.textContent = `✦ 0 / ${rings.length}`;
hudMode.textContent = 'ON FOOT';

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;

  if (pointerLocked) {
    hasPlayed = true;
    if (player.flying) updateFlying(dt);
    else updateWalking(dt);
  } else if (!hasPlayed) {
    // cinematic orbit around the castle behind the title screen
    const a = time * 0.045 + 2.6;
    camera.position.set(Math.sin(a) * 340, 105, Math.cos(a) * 340);
    camera.lookAt(0, PLATEAU_HEIGHT + 32, 0);
    camera.fov = 60;
    camera.updateProjectionMatrix();
  }

  const night = sky.update(time, player.pos);
  castle.glassMat.emissiveIntensity = night * 1.6 + 0.06;
  for (const l of lanterns) {
    l.light.intensity = night * 12;
    l.glow.material.color.setHSL(0.09, 0.9, 0.35 + night * 0.35);
  }

  // spin and bob the rings
  for (const r of rings) {
    if (r.taken) continue;
    r.spin += dt;
    r.mesh.rotation.z = r.spin * 0.8;
    r.mesh.position.y += Math.sin(r.spin * 1.7) * 0.012;
  }

  trail.update(dt);

  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0) hudMsg.style.opacity = 0;
  }

  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

say('Welcome to Arcanum Keep — press F to summon your broom', 5);
frame();

// minimal hook for automated smoke tests
window.__ak = { player, view: () => ({ yaw, pitch }) };

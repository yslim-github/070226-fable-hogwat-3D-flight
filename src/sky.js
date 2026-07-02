import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// Gradient sky dome + stars + sun/moon with a slow day-night cycle.

export const DAY_LENGTH = 240; // seconds for a full cycle

export function buildSky(scene) {
  const uniforms = {
    topColor: { value: new THREE.Color(0x2b5b9e) },
    bottomColor: { value: new THREE.Color(0xc9d8e8) },
    offset: { value: 60 },
    exponent: { value: 0.7 },
  };
  const skyGeo = new THREE.SphereGeometry(2600, 24, 15);
  const skyMat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 bottomColor;
      uniform float offset; uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0., offset, 0.)).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // stars
  const rand = mulberry32(77);
  const starCount = 1200;
  const sp = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const a = rand() * Math.PI * 2;
    const y = rand() * 0.9 + 0.06;
    const r = Math.sqrt(1 - y * y);
    sp[i * 3] = Math.cos(a) * r * 2400;
    sp[i * 3 + 1] = y * 2400;
    sp[i * 3 + 2] = Math.sin(a) * r * 2400;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xdfe8ff, size: 3.2, sizeAttenuation: false, transparent: true, opacity: 0,
    depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // sun and moon discs orbiting the world
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(46, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe9b0, fog: false })
  );
  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(34, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xd9e2f2, fog: false })
  );
  scene.add(sunMesh, moonMesh);

  // lights
  const sun = new THREE.DirectionalLight(0xffeecc, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260; sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260; sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 1400;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbdd3ea, 0x3a4632, 0.7);
  scene.add(hemi);

  const fog = new THREE.Fog(0xc9d8e8, 250, 1900);
  scene.fog = fog;

  // palette keyframes: night -> dawn -> day -> dusk
  const P = {
    top: [0x070d1f, 0x33345e, 0x2b6cb8, 0x3a2f52].map(c => new THREE.Color(c)),
    bottom: [0x101726, 0xd88a5a, 0xbcd6ea, 0xd07040].map(c => new THREE.Color(c)),
    fog: [0x0c1220, 0x7a6478, 0xb9cfe2, 0x6c4d55].map(c => new THREE.Color(c)),
    sunI: [0.0, 1.0, 2.3, 0.7],
    hemiI: [0.18, 0.45, 0.8, 0.4],
  };
  const cTop = new THREE.Color(), cBot = new THREE.Color(), cFog = new THREE.Color();

  function sample(arr, t) {
    // t in [0,1) across the 4 keys, wrapping
    const f = t * 4;
    const i = Math.floor(f) % 4, j = (i + 1) % 4, k = f - Math.floor(f);
    if (typeof arr[0] === 'number') return arr[i] + (arr[j] - arr[i]) * k;
    return null; // colors handled separately
  }
  function sampleColor(out, arr, t) {
    const f = t * 4;
    const i = Math.floor(f) % 4, j = (i + 1) % 4, k = f - Math.floor(f);
    out.copy(arr[i]).lerp(arr[j], k);
  }

  function update(time, focus) {
    // time in seconds; phase 0 = midnight, 0.5 = noon
    const phase = (time / DAY_LENGTH + 0.62) % 1; // start in late afternoon
    const ang = phase * Math.PI * 2 - Math.PI / 2; // sun angle
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.sin(ang), 0.45).normalize();

    sun.position.copy(focus).addScaledVector(sunDir, 600);
    sun.target.position.copy(focus);
    sunMesh.position.copy(focus).addScaledVector(sunDir, 2300);
    moonMesh.position.copy(focus).addScaledVector(sunDir, -2300);

    const t = phase; // reuse keyframe track
    sampleColor(cTop, P.top, t); sampleColor(cBot, P.bottom, t); sampleColor(cFog, P.fog, t);
    uniforms.topColor.value.copy(cTop);
    uniforms.bottomColor.value.copy(cBot);
    fog.color.copy(cFog);
    sun.intensity = sample(P.sunI, t);
    hemi.intensity = sample(P.hemiI, t);

    const night = Math.max(0, -sunDir.y + 0.15);
    starMat.opacity = Math.min(1, night * 2.2);
    // return how "night" it is so windows can glow
    return Math.min(1, night * 2.5);
  }

  return { update };
}

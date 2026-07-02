// Seeded procedural noise utilities — everything in the world derives from these.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D value noise with smooth interpolation.
const PERM_SIZE = 256;
const perm = new Uint8Array(PERM_SIZE * 2);
const grads = new Float32Array(PERM_SIZE * 2);
{
  const rand = mulberry32(1337);
  const p = [];
  for (let i = 0; i < PERM_SIZE; i++) p[i] = i;
  for (let i = PERM_SIZE - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < PERM_SIZE * 2; i++) perm[i] = p[i & 255];
  for (let i = 0; i < PERM_SIZE; i++) {
    const a = rand() * Math.PI * 2;
    grads[i * 2] = Math.cos(a);
    grads[i * 2 + 1] = Math.sin(a);
  }
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

function gradDot(hash, x, y) {
  const h = hash & 255;
  return grads[h * 2] * x + grads[h * 2 + 1] * y;
}

// Perlin-style gradient noise, range roughly [-1, 1].
export function noise2(x, y) {
  const X = Math.floor(x), Y = Math.floor(y);
  const xf = x - X, yf = y - Y;
  const xi = X & 255, yi = Y & 255;
  const u = fade(xf), v = fade(yf);
  const aa = perm[perm[xi] + yi];
  const ab = perm[perm[xi] + yi + 1];
  const ba = perm[perm[xi + 1] + yi];
  const bb = perm[perm[xi + 1] + yi + 1];
  const x1 = gradDot(aa, xf, yf) + u * (gradDot(ba, xf - 1, yf) - gradDot(aa, xf, yf));
  const x2 = gradDot(ab, xf, yf - 1) + u * (gradDot(bb, xf - 1, yf - 1) - gradDot(ab, xf, yf - 1));
  return (x1 + v * (x2 - x1)) * 1.6;
}

export function fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

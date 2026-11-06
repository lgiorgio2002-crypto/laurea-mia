// Il viaggio: un mondo Three.js percorso da un pulmino, guidato dallo scroll.
// Tutto è funzione di una sola grandezza, "u", le unità di timeline: 1 unità è
// una foto. Lo scroll decide u, u decide tutto il resto, così tornare indietro
// riavvolge il film. Solo la vita di fondo (aria, onde, foto che respirano) va
// avanti da sola.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createBus } from "./bus.js";
import { FINALE_SKY, PALETTES, PARTICLES, THANKS } from "./chapters.js";
import { buildLandmark, facadeTexture, LANDMARKS } from "./landmarks.js";

const SCROLL_VH_PER_UNIT = 62;
const WORLD_PER_UNIT = 30;
const FINALE_UNITS = 4.5;
const INTRO_UNITS = 1.4;
/* Quanto dura una tappa: il pulmino rallenta e la camera mostra il luogo. */
const BEAT_UNITS = 1.9;
/* Il muro finale sta poco oltre il punto in cui si ferma il pulmino. */
const WALL_AHEAD = 12;
const WALL_LIFT = 5.5;

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- La strada ----------
   Una curva analitica: ogni punto si calcola al volo, senza tabelle. */
function roadX(s) {
  return 14 * Math.sin(s * 0.006) + 6 * Math.sin(s * 0.017 + 1);
}
function roadY(s) {
  return 0.5 * Math.sin(s * 0.009) + 0.2 * Math.sin(s * 0.023);
}
function roadPoint(s, out = new THREE.Vector3()) {
  return out.set(roadX(s), roadY(s), -s);
}
function roadDir(s, out = new THREE.Vector3()) {
  return out.set(roadX(s + 1) - roadX(s - 1), roadY(s + 1) - roadY(s - 1), -2).normalize();
}

/* ---------- Timeline ---------- */
function buildTimeline(chapters) {
  const prints = [];
  const beats = [];
  let u = INTRO_UNITS;

  const addBeat = (stop, chapter) => {
    const spec = LANDMARKS[stop.landmark];
    beats.push({ ...stop, spec, chapter, u0: u, u1: u + BEAT_UNITS, side: spec.side || 1, through: !!spec.through });
    u += BEAT_UNITS;
  };

  chapters.forEach((chapter, index) => {
    chapter.index = index;
    chapter.u0 = u;
    const pending = [...chapter.stops];
    chapter.photosU = null;
    chapter.photos.forEach((n, i) => {
      while (pending.length && n >= pending[0].before) addBeat(pending.shift(), index);
      chapter.photosU ??= u;
      prints.push({ n, chapter: index, a: u, side: i % 2 ? -1 : 1 });
      u += 1;
    });
    /* Le tappe dopo l'ultima foto si percorrono lo stesso. */
    while (pending.length) addBeat(pending.shift(), index);
    chapter.photosU ??= u;
    chapter.u1 = u;
  });
  const finale = u;
  const total = u + FINALE_UNITS;

  /* Il pulmino rallenta davanti a ogni foto e allunga verso la tappa dopo. */
  function pace(x) {
    if (x < 0.5) return 0;
    if (x < INTRO_UNITS) return smooth(0.5, INTRO_UNITS, x) * 1.2;
    if (x > finale) return 1 - smooth(finale, finale + 2.4, x);
    if (beats.some((b) => x >= b.u0 && x < b.u1)) return 1.25;
    const local = x - Math.floor(x);
    return 0.55 + 0.75 * Math.abs(local * 2 - 1);
  }

  const STEP = 0.02;
  const table = [0];
  for (let x = 0; x < total + STEP; x += STEP) {
    table.push(table[table.length - 1] + pace(x) * WORLD_PER_UNIT * STEP);
  }
  const distanceAt = (x) => {
    const f = clamp(x, 0, total) / STEP;
    const i = Math.floor(f);
    return lerp(table[i], table[Math.min(i + 1, table.length - 1)], f - i);
  };

  chapters.forEach((c) => {
    c.s0 = distanceAt(c.u0);
    c.s1 = distanceAt(c.u1);
  });
  prints.forEach((p) => {
    p.s = distanceAt(p.a + 0.5);
  });
  beats.forEach((b) => {
    b.s0 = distanceAt(b.u0);
    b.s1 = distanceAt(b.u1);
    b.s = distanceAt((b.u0 + b.u1) / 2 + 0.1);
  });
  /* A parte: serve la posizione della tappa dopo. */
  beats.forEach((b, i) => {
    b.zoneEnd = beats[i + 1] ? beats[i + 1].s0 : distanceAt(total);
  });
  return { prints, beats, finale, total, distanceAt, end: distanceAt(total) };
}

/* Il cielo cambia durante le tappe, mentre si guarda il luogo. */
function buildSkyStops(beats, finale, total) {
  const first = beats[0].sky;
  const stops = [{ u: 0, key: first }];
  let previous = first;
  for (const b of beats) {
    stops.push({ u: b.u0, key: previous }, { u: b.u1, key: b.sky });
    previous = b.sky;
  }
  stops.push({ u: finale, key: previous }, { u: finale + 1.6, key: FINALE_SKY }, { u: total, key: FINALE_SKY });
  return stops;
}

const SKY_COLORS = ["top", "mid", "low", "ground", "road", "sun", "hemi", "hemiLow"];
const SKY_NUMBERS = ["sunEl", "sunAz", "hemiI", "keyI", "stars", "lamps"];

function preparePalettes() {
  const out = {};
  for (const [name, p] of Object.entries(PALETTES)) {
    out[name] = { ...p };
    for (const k of SKY_COLORS) out[name][k] = new THREE.Color(p[k]);
  }
  return out;
}

/* ---------- Geometrie ---------- */
function ribbon(s0, s1, step, offsets, heightAt) {
  const rows = Math.ceil((s1 - s0) / step) + 1;
  const cols = offsets.length;
  const pos = new Float32Array(rows * cols * 3);
  const idx = [];
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    const s = s0 + r * step;
    roadPoint(s, p);
    roadDir(s, d);
    const rx = -d.z;
    const rz = d.x;
    for (let c = 0; c < cols; c++) {
      const o = offsets[c];
      const i = (r * cols + c) * 3;
      pos[i] = p.x + rx * o;
      pos[i + 1] = p.y + heightAt(o, s);
      pos[i + 2] = p.z + rz * o;
      if (r < rows - 1 && c < cols - 1) {
        const a = r * cols + c;
        const b = a + cols;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function dashes(s0, s1) {
  const list = [];
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let s = s0; s < s1; s += 7) {
    const g = new THREE.PlaneGeometry(0.22, 3);
    g.rotateX(-Math.PI / 2);
    roadPoint(s, p);
    roadDir(s, d);
    g.rotateY(Math.atan2(-d.x, -d.z));
    g.translate(p.x, p.y + 0.05, p.z);
    list.push(g);
  }
  return mergeGeometries(list);
}

/* ---------- Shader ---------- */
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uTop, uMid, uLow, uSun, uSunDir;
uniform float uStars;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 c = mix(uLow, uMid, smoothstep(0.0, 0.2, h));
  c = mix(c, uTop, smoothstep(0.14, 0.72, h));
  float a = max(dot(d, uSunDir), 0.0);
  c += uSun * pow(a, 14.0) * 0.28;
  c = mix(c, uSun, smoothstep(0.9975, 0.9985, a));
  if (uStars > 0.01) {
    vec3 cell = floor(d * 170.0);
    float s = step(0.9965, hash(cell));
    c += vec3(s * uStars * smoothstep(0.02, 0.3, h) * (0.5 + 0.5 * hash(cell + 3.0)));
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const SEA_VERT = /* glsl */ `
varying vec3 vWorld;
uniform float uTime;
void main() {
  vec3 p = position;
  vec4 w = modelMatrix * vec4(p, 1.0);
  w.y += sin(w.x * 0.09 + uTime * 0.9) * 0.22 + sin(w.z * 0.13 - uTime * 0.7) * 0.16;
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SEA_FRAG = /* glsl */ `
varying vec3 vWorld;
uniform vec3 uDeep, uShallow, uSun, uFog, uCamera;
uniform float uTime, uFogNear, uFogFar;
float n(vec2 p) { return sin(p.x) * sin(p.y); }
void main() {
  vec2 p = vWorld.xz;
  float w = n(p * 0.21 + uTime * 0.5) + 0.6 * n(p * 0.47 - uTime * 0.7) + 0.35 * n(p * 1.1 + uTime);
  vec3 c = mix(uDeep, uShallow, 0.5 + 0.28 * w);
  float glint = smoothstep(1.15, 1.5, w);
  c += uSun * glint * 0.55;
  float dist = distance(vWorld, uCamera);
  c = mix(c, uFog, smoothstep(uFogNear, uFogFar, dist));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const AIR_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCamera;
uniform float uTime, uSize, uFall, uDrift, uAmount, uPixels, uBox;
varying vec3 vColor;
varying float vAlpha, vSpin;
uniform vec3 uColorA, uColorB;
uniform float uConfetti;
const vec3 C0 = vec3(0.776, 0.095, 0.027);
const vec3 C1 = vec3(0.930, 0.558, 0.012);
const vec3 C2 = vec3(0.991, 0.939, 0.750);
const vec3 C3 = vec3(0.521, 0.768, 0.888);
const vec3 C4 = vec3(0.262, 0.611, 0.289);
void main() {
  vec3 p = position;
  p.y -= uTime * uFall * (0.6 + aSeed.x);
  p.x += sin(uTime * 0.4 * (0.5 + aSeed.y) + aSeed.z * 6.28) * uDrift * 3.0;
  p.z += cos(uTime * 0.3 * (0.5 + aSeed.w) + aSeed.x * 6.28) * uDrift * 3.0;
  p = mod(p - uCamera + uBox * 0.5, vec3(uBox)) - uBox * 0.5 + uCamera;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float visible = step(aSeed.w, uAmount);
  gl_PointSize = visible * uSize * (0.6 + aSeed.y) * uPixels / max(-mv.z, 0.5);
  vColor = mix(uColorA, uColorB, aSeed.z);
  float pick = aSeed.x * 5.0;
  vec3 conf = pick < 1.0 ? C0 : pick < 2.0 ? C1 : pick < 3.0 ? C2 : pick < 4.0 ? C3 : C4;
  vColor = mix(vColor, conf, uConfetti);
  vSpin = uTime * (0.8 + aSeed.y * 2.0) + aSeed.z * 6.28;
  vAlpha = smoothstep(uBox * 0.5, uBox * 0.28, length(p - uCamera)) * smoothstep(0.6, 2.2, -mv.z);
}`;

const AIR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha, vSpin;
uniform float uShape;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vSpin), s = sin(vSpin);
  vec2 q = mat2(c, -s, s, c) * p;
  float dot_ = smoothstep(0.5, 0.18, length(p));
  float leaf = smoothstep(0.03, 0.0, abs(q.x) - 0.17 * (1.0 - pow(abs(q.y) * 2.1, 2.0))) * step(abs(q.y), 0.47);
  float flip = 0.25 + 0.75 * abs(sin(vSpin * 1.3));
  float rect = step(abs(q.x), 0.3 * flip) * step(abs(q.y), 0.18);
  float a = uShape < 0.5 ? dot_ : uShape < 1.5 ? leaf : rect;
  a *= vAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}`;

const PRINT_VERT = /* glsl */ `
varying vec2 vUv;
varying float vShade;
uniform float uTime, uBend, uWave, uSeed;
void main() {
  vUv = uv;
  vec3 p = position;
  float e = uv.x - 0.5;
  float f = uv.y - 0.5;
  float bend = uBend * (1.0 - 4.0 * e * e);
  float flutter = sin(uv.x * 5.0 + uTime * 1.5 + uSeed) * 0.5 + sin(uv.y * 4.0 + uTime * 1.1 + uSeed * 2.0) * 0.35;
  p.z += bend + flutter * uWave;
  /* I lati si inclinano appena: la luce scorre sulla carta. */
  vShade = (bend * 0.5 + flutter * uWave * 3.0) * (e + f * 0.5);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const PRINT_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vShade;
uniform sampler2D uMap, uDepth;
uniform vec2 uInset, uPointer, uAspect;
uniform float uTime, uSeed, uDevelop, uGrade, uNeon, uFocus, uSplit, uFade, uRadius, uParallax;
uniform vec3 uFog, uTint;
uniform float uFogAmount;
float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  /* Angoli arrotondati della stampa. */
  vec2 size = uAspect;
  vec2 q = abs(vUv - 0.5) * size - (size * 0.5 - vec2(uRadius));
  if (length(max(q, 0.0)) > uRadius) discard;

  vec3 paper = vec3(0.985, 0.94, 0.80);
  vec3 col = paper;

  if (!gl_FrontFacing) {
    col = paper * 0.86;
  } else {
    vec2 uv = (vUv - vec2(uInset.x, uInset.y * 2.6)) / (vec2(1.0) - vec2(uInset.x * 2.0, uInset.y * 3.6));
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
      /* Foto viva: la mappa di profondità sposta il soggetto rispetto ai
         bordi, e l'ingrandimento nasconde i margini dello spostamento. */
      vec2 drift = vec2(sin(uTime * 0.31 + uSeed), cos(uTime * 0.23 + uSeed * 1.7)) * 0.7 + uPointer;
      float depth = texture2D(uDepth, uv).r;
      vec2 p = (uv - 0.5) / (1.024 + uFocus * 0.012) + 0.5;
      p += drift * (depth - 0.45) * uParallax;
      float split = uSplit * 0.0028;
      vec3 c = vec3(
        texture2D(uMap, p + vec2(split, 0.0)).r,
        texture2D(uMap, p).g,
        texture2D(uMap, p - vec2(split, 0.0)).b
      );

      /* Pellicola: seppia, neri sollevati, luce che filtra da un lato. */
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 sepia = vec3(l * 1.12, l * 0.98, l * 0.74) + vec3(0.05, 0.035, 0.0);
      c = mix(c, sepia, uGrade * 0.72);
      float leakA = smoothstep(0.55, -0.1, distance(uv, vec2(-0.05 + 0.12 * sin(uTime * 0.2 + uSeed), 0.75)));
      c += vec3(1.0, 0.5, 0.2) * leakA * (0.12 + uGrade * 0.2);

      /* Neon: le luci della notte sfiorano ombre e bordi. */
      float edge = smoothstep(0.25, 0.75, distance(uv, vec2(0.5)));
      vec3 neon = mix(vec3(1.0, 0.16, 0.55), vec3(0.15, 0.55, 1.0), 0.5 + 0.5 * sin(uTime * 0.8 + uv.y * 3.0 + uSeed));
      c += neon * edge * (1.0 - l) * uNeon * (0.26 + 0.06 * sin(uTime * 3.0 + uSeed));

      /* Sviluppo: la stampa nasce pallida e prende colore. */
      vec3 undeveloped = mix(paper, vec3(l), 0.12);
      c = mix(undeveloped, c, smoothstep(0.0, 1.0, uDevelop));

      float g = rand(uv * 900.0 + fract(uTime) * 61.0) - 0.5;
      c += g * (0.025 + uGrade * 0.06);
      float vig = smoothstep(0.82, 0.32, distance(uv, vec2(0.5)));
      c *= 0.86 + 0.14 * vig;
      col = c;
    }
    col += vShade * 0.5;
  }

  col *= 0.97 + 0.03 * sin(vUv.y * 2.0 + uSeed);
  col = mix(col, uFog, uFogAmount);
  gl_FragColor = vec4(col, uFade);
  #include <colorspace_fragment>
}`;

const TILE_VERT = /* glsl */ `
attribute vec2 aCell;
varying vec2 vUv;
varying vec2 vCell;
void main() {
  vUv = uv;
  vCell = aCell;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const TILE_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uCells;
varying vec2 vUv;
varying vec2 vCell;
void main() {
  /* Cornice sottile: a questa misura è lei a farle leggere come stampe. */
  vec2 p = (vUv - 0.5) / 0.86 + 0.5;
  vec3 c = vec3(1.0, 0.973, 0.882);
  if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0) {
    vec2 uv = (vCell + p) / uCells;
    c = texture2D(uAtlas, vec2(uv.x, 1.0 - uv.y + 0.0)).rgb;
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/* ---------- Il mondo ---------- */
export function createJourney({ canvas, chapters, onProgress, onFocusPrint, onReady }) {
  const timeline = buildTimeline(chapters);
  const { prints, beats, finale, total, distanceAt, end } = timeline;
  const palettes = preparePalettes();
  const skyStops = buildSkyStops(beats, finale, total);
  const isPhone = Math.min(window.innerWidth, window.innerHeight) < 700;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isPhone, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isPhone ? 1.6 : 1.75));

  const world = new THREE.Scene();
  world.fog = new THREE.Fog(0xffffff, 70, 330);
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 1200);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 2);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  world.add(hemi, key, key.target);

  /* Toon a tre toni: il mondo resta un'illustrazione. */
  const ramp = new THREE.DataTexture(new Uint8Array([185, 225, 255]), 3, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  const toon = (hex, extra = {}) => new THREE.MeshToonMaterial({ color: hex, gradientMap: ramp, ...extra });
  const flat = (hex, extra = {}) => new THREE.MeshBasicMaterial({ color: hex, ...extra });

  /* Cielo */
  const skyUniforms = {
    uTop: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uLow: { value: new THREE.Color() },
    uSun: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 0.3, -1) },
    uStars: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, depthTest: false })
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  world.add(sky);

  /* Terra e strada */
  /* Acqua a destra della strada: il fiume, l'estuario, l'oceano. */
  const waterZones = beats.filter((b) => b.water).map((b) => ({ s0: b.s0 - 24, s1: b.landmark === "tiber" || b.landmark === "belem" ? b.s1 + 34 : b.zoneEnd + 60, beach: !!b.beach }));
  const seaAmount = (s) => Math.max(0, ...waterZones.map((z) => smooth(z.s0 - 30, z.s0 + 10, s) * (1 - smooth(z.s1 - 10, z.s1 + 30, s))));
  const beachAmount = (s) => Math.max(0, ...waterZones.filter((z) => z.beach).map((z) => smooth(z.s0 - 30, z.s0 + 10, s) * (1 - smooth(z.s1 - 10, z.s1 + 30, s))));
  const shoreDrop = (o, s) => {
    const steep = o > 12 ? -11 * smooth(12, 20, o) : 0;
    const gentle = o > 8 ? -11 * smooth(8, 42, o) : 0;
    return lerp(steep, gentle, beachAmount(s)) * seaAmount(s);
  };
  const lastS = end + 520;
  const firstS = -160;

  const groundMat = flat(0xffffff);
  const ground = new THREE.Mesh(
    ribbon(firstS, lastS, 5, [-520, -130, -34, -6.5, 6.5, 8, 12, 16, 20, 26, 34, 42, 130, 520], (o, s) => {
      return -0.07 + shoreDrop(o, s);
    }),
    groundMat
  );
  ground.frustumCulled = false;
  world.add(ground);

  const roadMat = flat(0xffffff);
  const road = new THREE.Mesh(ribbon(firstS, lastS, 2.5, [-4.3, 4.3], () => 0), roadMat);
  road.frustumCulled = false;
  const paintMat = flat("#fff8e1");
  const lineL = new THREE.Mesh(ribbon(firstS, lastS, 2.5, [-4.05, -3.9], () => 0.03), paintMat);
  const lineR = new THREE.Mesh(ribbon(firstS, lastS, 2.5, [3.9, 4.05], () => 0.03), paintMat);
  const centre = new THREE.Mesh(dashes(firstS, lastS), paintMat);
  [lineL, lineR, centre].forEach((m) => (m.frustumCulled = false));
  world.add(road, lineL, lineR, centre);

  /* Sabbia */
  const sandMat = flat("#ecd6a4");
  for (const z of waterZones.filter((w) => w.beach)) {
    const sand = new THREE.Mesh(ribbon(z.s0, z.s1, 5, [6.4, 8, 12, 16, 20, 26, 34, 42], (o, s) => -0.03 + shoreDrop(o, s)), sandMat);
    sand.frustumCulled = false;
    world.add(sand);
  }

  /* Acqua */
  const seaMat = new THREE.ShaderMaterial({
    vertexShader: SEA_VERT,
    fragmentShader: SEA_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color("#1a6fb0") },
      uShallow: { value: new THREE.Color("#58c4d8") },
      uSun: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() },
      uCamera: { value: new THREE.Vector3() },
      uFogNear: { value: 70 },
      uFogFar: { value: 330 },
    },
  });
  const sea = waterZones.length ? { material: seaMat } : null;
  for (const z of waterZones) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1200, z.s1 - z.s0 + 40, 60, Math.ceil((z.s1 - z.s0) / 10)), seaMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(540, -4.2, -(z.s0 + z.s1) / 2);
    plane.frustumCulled = false;
    world.add(plane);
  }

  /* Paesaggio: istanze ripartite per tratto di strada. */
  const instances = { hill: [], tree: [], trunk: [], pine: [], pineTrunk: [], hedge: [], post: [], car: [], salmon: [], coral: [], ochre: [], rust: [], lisbon: [] };
  const lampPoints = [];
  const dummy = new THREE.Object3D();
  const rng = mulberry(2026);

  function put(kind, s, offset, y, sx, sy, sz, color, rotY = 0) {
    const p = roadPoint(s, new THREE.Vector3());
    const d = roadDir(s, new THREE.Vector3());
    dummy.position.set(p.x - d.z * offset, p.y + y, p.z + d.x * offset);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(0, rotY, 0);
    dummy.updateMatrix();
    instances[kind].push({ matrix: dummy.matrix.clone(), color: new THREE.Color(color) });
  }

  const pick = (list) => list[Math.floor(rng() * list.length)];
  const heading = (s) => {
    const d = roadDir(s, new THREE.Vector3());
    return Math.atan2(-d.x, -d.z);
  };
  /* I luoghi si tengono attorno un po' di vuoto, altrimenti non si vedono. */
  const blocked = (s, side) => beats.some((b) => Math.abs(s - b.s) < (b.through ? 44 : 62) && (b.through || !b.spec.side || b.side === side));
  const nearStop = (s) => beats.some((b) => Math.abs(s - b.s) < 78);
  const wet = (s, side) => side > 0 && seaAmount(s) > 0.01;

  function hills(s0, s1, colors, every = 15) {
    for (let s = s0; s < s1; s += every) {
      const side = rng() < 0.5 ? -1 : 1;
      if (wet(s, side) || blocked(s, side)) continue;
      const w = 22 + rng() * 40;
      put("hill", s, side * (46 + w + rng() * 150), -1, w, 7 + rng() * 18, w, pick(colors), rng() * 6);
    }
  }

  function trees(s0, s1, colors, every, min = 11, max = 44) {
    for (let s = s0; s < s1; s += every) {
      const side = rng() < 0.5 ? -1 : 1;
      if (wet(s, side) || blocked(s, side) || nearStop(s)) continue;
      const o = side * (min + rng() * rng() * (max - min));
      const k = 1.1 + rng() * 1.1;
      put("trunk", s, o, 1.2 * k, 0.26 * k, 1.3 * k, 0.26 * k, "#6b4a33");
      put("tree", s, o, 3.3 * k, 1.9 * k, 1.8 * k, 1.9 * k, pick(colors), rng() * 6);
    }
  }

  function pines(s0, s1, every, sides = [1, -1], offset = 8.5) {
    for (let s = s0; s < s1; s += every) {
      const side = pick(sides);
      if (wet(s, side) || blocked(s, side) || nearStop(s)) continue;
      const h = 10 + rng() * 5;
      const o = side * (offset + rng() * 2);
      put("pineTrunk", s, o, h / 2, 0.3, h / 2, 0.3, "#6b4a33");
      put("pine", s, o, h, 1, 1, 1, pick(["#2f5d3a", "#35673f", "#2a5232"]), rng() * 6);
    }
  }

  function buildings(s0, s1, styles, sides = [1, -1], min = 19, every = 19, floors = [16, 24]) {
    for (const side of sides) {
      for (let s = s0; s < s1; s += every) {
        if (wet(s, side) || blocked(s, side) || beats.some((b) => Math.abs(s - b.s) < 50)) continue;
        const w = every - 1;
        const h = floors[0] + rng() * (floors[1] - floors[0]);
        put(pick(styles), s, side * (min + 8), h / 2, w, h, 14, "#ffffff", heading(s));
      }
    }
  }

  function cars(s0, s1, every, sides = [1]) {
    for (let s = s0; s < s1; s += every) {
      const side = pick(sides);
      if (rng() < 0.3 || blocked(s, side) || wet(s, side) || nearStop(s)) continue;
      put("car", s, side * 5.6, 0.62, 1, 1, 1, pick(["#8b8f94", "#4c5660", "#e9e9ea", "#a33434", "#23272d", "#23305f"]), heading(s));
    }
  }

  function streetLamps(s0, s1, every, sides = [1, -1], offset = 5.2) {
    for (let s = s0; s < s1; s += every) {
      for (const side of sides) {
        if (blocked(s, side) || wet(s, side) || nearStop(s)) continue;
        put("post", s, side * offset, 3.3, 0.07, 3.3, 0.07, "#3a3d44");
        const p = roadPoint(s, new THREE.Vector3());
        const d = roadDir(s, new THREE.Vector3());
        const o = side * (offset - 0.8);
        lampPoints.push(p.x - d.z * o, p.y + 6.7, p.z + d.x * o);
      }
    }
  }

  for (const c of chapters) {
    const a = c.s0 - 20;
    const b = c.s1 + 20;
    if (c.scenery === "romeStreet") {
      buildings(a, b, ["salmon", "salmon", "ochre"]);
      pines(a, b, 17);
      cars(a, b, 6.5, [1, -1]);
      streetLamps(a, b, 30);
      hills(a, b, ["#b9a98f"], 22);
    }
    if (c.scenery === "melfi") {
      buildings(a, b, ["coral"], [1], 17, 20, [11, 15]);
      /* Dall'altro lato la ferrovia, con la siepe davanti. */
      const ballast = new THREE.Mesh(ribbon(a, b, 5, [-13.5, -9], () => 0.04), flat("#8a8378"));
      const rails = [[-12.4, -12.26], [-10.6, -10.46]].map((o) => new THREE.Mesh(ribbon(a, b, 5, o, () => 0.14), flat("#4e4a46")));
      [ballast, ...rails].forEach((m) => {
        m.frustumCulled = false;
        world.add(m);
      });
      for (let s = a; s < b; s += 2.6) if (!nearStop(s)) put("hedge", s, -7.2 - rng() * 0.6, 0.5, 1.5 + rng(), 0.9 + rng() * 0.8, 1.7, pick(["#5d8a3e", "#4f7d38", "#6c9a46"]));
      for (let s = a; s < b; s += 9) {
        const k = 2 + rng() * 1.6;
        const o = -16 - rng() * 20;
        put("trunk", s, o, 1.2 * k, 0.28 * k, 1.3 * k, 0.28 * k, "#5a4030");
        put("tree", s, o, 3.3 * k, 2 * k, 2 * k, 2 * k, pick(["#3f6e3a", "#35623a", "#4b7d40"]), rng() * 6);
      }
      streetLamps(a, b, 26, [-1], 5.6);
      cars(a, b, 12, [1]);
      hills(a, b, ["#7f9652", "#8ca35a", "#6e8a4e"], 12);
    }
    if (c.scenery === "romeCity") {
      buildings(a, b, ["ochre", "rust", "ochre"]);
      pines(a, b, 21);
      trees(a, b, ["#4f8a46", "#5f9c50"], 17);
      streetLamps(a, b, 30);
      cars(a, b, 11, [1, -1]);
      hills(a, b, ["#a9a07c", "#8fa066"], 18);
    }
    if (c.scenery === "lisbon") {
      buildings(a, b, ["lisbon"], [1, -1], 15, 19, [13, 19]);
      trees(a, b, ["#6f9c50", "#82a852"], 22);
      streetLamps(a, b, 24);
      hills(a, b, ["#d9c28a", "#cfae7a", "#b8a070"], 12);
    }
  }

  const facadeMaterial = (style) => {
    const side = new THREE.MeshLambertMaterial({ map: facadeTexture(style) });
    const top = new THREE.MeshLambertMaterial({ color: "#cfc3ae" });
    return [side, side, top, top, side, side];
  };
  const pineShape = mergeGeometries(
    [[0, 0, 0, 4.2], [2.8, -0.5, 1, 3], [-2.6, -0.3, -1, 3.2], [0.6, -0.6, 2.8, 2.8], [-0.8, -0.2, -2.7, 2.9]].map(([x, y, z, r]) => {
      const g = new THREE.IcosahedronGeometry(r, 1);
      g.scale(1, 0.48, 1);
      g.translate(x, y, z);
      return g;
    })
  );
  const carShape = mergeGeometries(
    [new THREE.BoxGeometry(3.9, 0.7, 1.7), new THREE.BoxGeometry(2, 0.55, 1.5).translate(-0.2, 0.6, 0)].map((g) => g.toNonIndexed())
  );
  const lit = () => new THREE.MeshLambertMaterial({ color: "#ffffff" });
  const shapes = {
    hill: [new THREE.IcosahedronGeometry(1, 2), toon("#ffffff")],
    tree: [new THREE.IcosahedronGeometry(1, 1), toon("#ffffff")],
    trunk: [new THREE.CylinderGeometry(1, 1.2, 2, 6), toon("#ffffff")],
    pine: [pineShape, lit()],
    pineTrunk: [new THREE.CylinderGeometry(0.75, 1, 2, 6), lit()],
    hedge: [new THREE.IcosahedronGeometry(1, 1), lit()],
    post: [new THREE.CylinderGeometry(1, 1, 2, 5), flat("#ffffff")],
    car: [carShape, lit()],
  };
  for (const style of ["salmon", "coral", "ochre", "rust", "lisbon"]) shapes[style] = [new THREE.BoxGeometry(1, 1, 1), facadeMaterial(style)];

  for (const [kind, list] of Object.entries(instances)) {
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(shapes[kind][0], shapes[kind][1], list.length);
    list.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      mesh.setColorAt(i, item.color);
    });
    mesh.frustumCulled = false;
    world.add(mesh);
  }

  /* I luoghi. */
  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  for (const b of beats) {
    b.entry = buildLandmark(b.landmark, solidMat, glowMat);
    const g = b.entry.group;
    const p = roadPoint(b.s);
    const d = roadDir(b.s);
    const rightX = -d.z;
    const rightZ = d.x;
    g.position.set(p.x + rightX * b.side * b.spec.offset, p.y, p.z + rightZ * b.side * b.spec.offset);
    /* Il +z del luogo guarda la strada; chi si attraversa sta in asse. */
    g.rotation.y = b.through ? Math.atan2(-d.x, -d.z) + Math.PI / 2 : Math.atan2(-rightX * b.side, -rightZ * b.side);
    b.centre = g.position.clone().setY(g.position.y + b.spec.look);
    world.add(g);
  }

  /* Lampioni: dischi morbidi additivi. */
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute("position", new THREE.Float32BufferAttribute(lampPoints, 3));
  const lampMat = new THREE.PointsMaterial({
    color: "#ffd98a",
    size: 3.2,
    map: (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d");
      const r = g.createRadialGradient(32, 32, 1, 32, 32, 32);
      r.addColorStop(0, "rgba(255,255,255,1)");
      r.addColorStop(0.25, "rgba(255,255,255,.55)");
      r.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lamps = new THREE.Points(lampGeo, lampMat);
  lamps.frustumCulled = false;
  world.add(lamps);

  /* Traguardo */
  const arch = new THREE.Group();
  {
    const p = roadPoint(end - 22);
    const d = roadDir(end - 22);
    arch.position.copy(p);
    arch.rotation.y = Math.atan2(-d.x, -d.z);
    const postMat = toon("#fff8e1");
    for (const x of [-5.4, 5.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 8, 10), postMat);
      post.position.set(x, 4, 0);
      arch.add(post);
    }
    const c = document.createElement("canvas");
    c.width = 480;
    c.height = 72;
    const g = c.getContext("2d");
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 13; x++) {
        g.fillStyle = (x + y) % 2 ? "#fff8e1" : "#2b2622";
        g.fillRect(x * 37, y * 36, 37, 36);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const banner = new THREE.Mesh(new THREE.BoxGeometry(11, 1.5, 0.15), new THREE.MeshBasicMaterial({ map: tex }));
    banner.position.y = 7.6;
    arch.add(banner);
    world.add(arch);
  }

  /* Aria: un'unica nuvola di punti che avvolge la camera e cambia natura a
     ogni capitolo. */
  const AIR_COUNT = isPhone ? 260 : 460;
  const AIR_BOX = 46;
  const airPos = new Float32Array(AIR_COUNT * 3);
  const airSeed = new Float32Array(AIR_COUNT * 4);
  const airRng = mulberry(7);
  for (let i = 0; i < AIR_COUNT; i++) {
    for (let k = 0; k < 3; k++) airPos[i * 3 + k] = airRng() * AIR_BOX;
    for (let k = 0; k < 4; k++) airSeed[i * 4 + k] = airRng();
  }
  const airGeo = new THREE.BufferGeometry();
  airGeo.setAttribute("position", new THREE.BufferAttribute(airPos, 3));
  airGeo.setAttribute("aSeed", new THREE.BufferAttribute(airSeed, 4));
  const airUniforms = {
    uCamera: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uSize: { value: 0.1 },
    uFall: { value: 0 },
    uDrift: { value: 0 },
    uAmount: { value: 0 },
    uPixels: { value: 500 },
    uBox: { value: AIR_BOX },
    uColorA: { value: new THREE.Color() },
    uColorB: { value: new THREE.Color() },
    uShape: { value: 0 },
    uConfetti: { value: 0 },
  };
  const air = new THREE.Points(airGeo, new THREE.ShaderMaterial({ vertexShader: AIR_VERT, fragmentShader: AIR_FRAG, uniforms: airUniforms, transparent: true, depthWrite: false }));
  air.frustumCulled = false;
  air.renderOrder = 5;
  world.add(air);

  const particleSets = {};
  for (const [k, p] of Object.entries(PARTICLES)) {
    particleSets[k] = { ...p, a: new THREE.Color(p.a), b: new THREE.Color(p.b) };
  }

  /* ---------- Il pulmino ---------- */
  /* Uno studio fotografico invisibile: dà alla vernice le sue riflessioni. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  pmrem.dispose();
  const bus = createBus(renderer, studio);
  world.add(bus.root);

  /* ---------- Le stampe ---------- */
  const printGeo = new THREE.PlaneGeometry(1, 1, 22, 16);
  const liveDepth = new THREE.DataTexture(new Uint8Array([115]), 1, 1, THREE.RedFormat);
  liveDepth.needsUpdate = true;
  const maxAniso = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);

  function makePrintMaterial(p, seed) {
    return new THREE.ShaderMaterial({
      vertexShader: PRINT_VERT,
      fragmentShader: PRINT_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uMap: { value: null },
        uDepth: { value: liveDepth },
        uInset: { value: new THREE.Vector2(0.04, 0.03) },
        uAspect: { value: new THREE.Vector2(1, 1) },
        uPointer: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uSeed: { value: seed },
        uBend: { value: 0 },
        uWave: { value: 0.02 },
        uDevelop: { value: 0 },
        uGrade: { value: chapters[p.chapter].grade },
        uNeon: { value: chapters[p.chapter].neon },
        uFocus: { value: 0 },
        uSplit: { value: 0 },
        uFade: { value: 0 },
        uRadius: { value: 0.012 },
        uParallax: { value: 0.016 },
        uFog: { value: new THREE.Color() },
        uTint: { value: new THREE.Color() },
        uFogAmount: { value: 0 },
      },
    });
  }

  /* Alone dietro la foto a fuoco: prende il colore dominante della foto. */
  const haloTexture = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const r = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,.9)");
    r.addColorStop(0.55, "rgba(255,255,255,.35)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: haloTexture, transparent: true, depthWrite: false, depthTest: false, opacity: 0, fog: false }));
  halo.renderOrder = 8;
  world.add(halo);

  function dress(p, i) {
    p.index = i;
    p.seed = (i * 1.618) % 6.28;
    p.tilt = [-1.6, 1.1, -0.7, 1.5, -1.2, 0.8, -1.4, 1.3, -0.9][i % 9] * (Math.PI / 180) * 1.6;
    p.aspect = 1;
    p.ready = false;
    p.mesh = new THREE.Mesh(printGeo, makePrintMaterial(p, p.seed));
    p.mesh.visible = false;
    p.mesh.frustumCulled = false;
    p.mesh.renderOrder = 10 + i;
    world.add(p.mesh);
  }
  prints.forEach(dress);

  /* La mappa di profondità è una stima, non una misura: il soggetto sta quasi
     sempre al centro e in basso, e le zone luminose e sature tendono a stare
     davanti. Sfumata molto, così piega la foto senza deformare i volti. */
  function analyse(canvasSource) {
    const SIZE = 48;
    const c = document.createElement("canvas");
    c.width = c.height = SIZE;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(canvasSource, 0, 0, SIZE, SIZE);
    const data = g.getImageData(0, 0, SIZE, SIZE).data;
    const raw = new Float32Array(SIZE * SIZE);
    let R = 0;
    let G = 0;
    let B = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = (y * SIZE + x) * 4;
        const r = data[i] / 255;
        const gr = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        R += r;
        G += gr;
        B += b;
        const lum = 0.3 * r + 0.59 * gr + 0.11 * b;
        const nx = x / (SIZE - 1) - 0.5;
        const ny = y / (SIZE - 1) - 0.55;
        const centre_ = Math.exp(-(nx * nx * 7 + ny * ny * 5));
        raw[y * SIZE + x] = centre_ * 0.8 + lum * 0.2;
      }
    }
    /* Sfocatura a box, due passate. */
    const blur = (src) => {
      const dst = new Float32Array(src.length);
      const R_ = 3;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          let sum = 0;
          let n = 0;
          for (let dy = -R_; dy <= R_; dy++) {
            for (let dx = -R_; dx <= R_; dx++) {
              const yy = y + dy;
              const xx = x + dx;
              if (yy < 0 || xx < 0 || yy >= SIZE || xx >= SIZE) continue;
              sum += src[yy * SIZE + xx];
              n += 1;
            }
          }
          dst[y * SIZE + x] = sum / n;
        }
      }
      return dst;
    };
    const soft = blur(blur(raw));
    const bytes = new Uint8Array(SIZE * SIZE);
    /* Il canvas ha l'origine in alto, la texture in basso. */
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) bytes[(SIZE - 1 - y) * SIZE + x] = clamp(soft[y * SIZE + x], 0, 1) * 255;
    }
    const depth = new THREE.DataTexture(bytes, SIZE, SIZE, THREE.RedFormat);
    depth.magFilter = depth.minFilter = THREE.LinearFilter;
    depth.wrapS = depth.wrapT = THREE.ClampToEdgeWrapping;
    depth.needsUpdate = true;
    const count = SIZE * SIZE;
    return { depth, tint: new THREE.Color().setRGB(R / count, G / count, B / count, THREE.SRGBColorSpace) };
  }

  function addPhoto(n, image) {
    const p = prints.find((x) => x.n === n);
    if (p) fillPrint(p, image);
  }

  /* Atlante: tutte le foto, quadrate e piccole, in una texture sola. La scritta
     finale ne usa centinaia di copie con una sola chiamata di disegno. */
  const ATLAS_CELLS = 10;
  const ATLAS_SIZE = isPhone ? 1024 : 1536;
  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = atlasCanvas.height = ATLAS_SIZE;
  const atlasContext = atlasCanvas.getContext("2d");
  atlasContext.fillStyle = "#fff8e1";
  atlasContext.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const atlas = new THREE.CanvasTexture(atlasCanvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.minFilter = THREE.LinearFilter;
  atlas.generateMipmaps = false;
  /* La cella 0 è della foto del traguardo, che può cambiare. */
  const atlasUsed = [];
  let atlasNext = 1;
  let atlasChanged = 0;
  let flightPool = null;

  function atlasPut(source, isSelfie) {
    const cell = isSelfie ? 0 : atlasNext;
    if (cell >= ATLAS_CELLS * ATLAS_CELLS) return;
    if (!isSelfie) atlasNext += 1;
    const size = ATLAS_SIZE / ATLAS_CELLS;
    const side = Math.min(source.width, source.height);
    /* Ritaglio un po' più in alto del centro: è lì che stanno i volti. */
    const sx = (source.width - side) / 2;
    const sy = (source.height - side) * 0.35;
    atlasContext.drawImage(source, sx, sy, side, side, (cell % ATLAS_CELLS) * size, Math.floor(cell / ATLAS_CELLS) * size, size, size);
    atlasChanged = performance.now();
    if (!atlasUsed.includes(cell)) atlasUsed.push(cell);
    tilesDirty = true;
    flightPool = null;
    return cell;
  }

  /* Le foto degli ospiti esistono solo nel finale, e piccole: un telefono ne
     deve reggere decine insieme alle 29 del viaggio. */
  const MAX_GUESTS = 60;
  let guests = 0;

  function addGuest(image) {
    if (guests >= MAX_GUESTS) return;
    guests += 1;
    const p = { n: null, guest: true, chapter: chapters.length - 1, a: -100, s: end, side: 1 };
    dress(p, prints.length);
    p.mesh.material.uniforms.uGrade.value = 0;
    p.mesh.material.uniforms.uNeon.value = 0;
    prints.push(p);
    layoutWall();
    fillPrint(p, image, 640);
  }

  function fillPrint(p, image, limit = isPhone ? 1024 : 1400) {
    const LIMIT = limit;
    const scale = Math.min(1, LIMIT / Math.max(image.naturalWidth, image.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(image.naturalWidth * scale);
    c.height = Math.round(image.naturalHeight * scale);
    c.getContext("2d").drawImage(image, 0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    const { depth, tint } = analyse(c);
    const u = p.mesh.material.uniforms;
    u.uMap.value?.dispose();
    u.uMap.value = tex;
    if (u.uDepth.value !== liveDepth) u.uDepth.value.dispose();
    u.uDepth.value = depth;

    /* Cornice in proporzione: margine uguale in lati, più alto in basso. */
    p.aspect = c.width / c.height;
    const photoW = p.aspect >= 1 ? 1 : p.aspect;
    const photoH = p.aspect >= 1 ? 1 / p.aspect : 1;
    const margin = 0.035;
    const fullW = photoW + margin * 2;
    const fullH = photoH + margin * 3.6;
    p.w = fullW;
    p.h = fullH;
    u.uInset.value.set(margin / fullW, margin / fullH);
    u.uAspect.value.set(fullW, fullH);
    p.cell = atlasPut(c, p === selfie);
    p.tint = tint;
    p.src = image.src;
    p.alt = image.alt;
    p.ready = true;
  }

  /* La foto del traguardo: una stampa in più, al centro della festa. */
  const selfie = { aspect: 1, ready: false, chapter: chapters.length - 1, seed: 1.7, w: 1, h: 1 };
  selfie.mesh = new THREE.Mesh(printGeo, makePrintMaterial(selfie, selfie.seed));
  selfie.mesh.material.uniforms.uGrade.value = 0;
  selfie.mesh.visible = false;
  selfie.mesh.frustumCulled = false;
  selfie.mesh.renderOrder = 200;
  world.add(selfie.mesh);
  /* 0 muro, 1 festa. shot misura il volo dalla camera al centro, hold la pausa
     prima della scritta, thanks la scritta che si compone. */
  const party = { value: 0, target: 0, shot: 1, hold: 0, thanks: 0 };

  /* ---------- Il volo di foto tra un luogo e l'altro ----------
     Stampe che arrivano dal fondo e superano la camera. Vivono nello spazio
     della camera e dipendono solo da u: tornando indietro si riavvolgono. Tra
     due luoghi vicini lasciano libero il centro; quando si cambia città si
     chiudono sullo schermo e il paesaggio cambia dietro di loro. */
  const CARDS = isPhone ? 64 : 110;
  const flightGeo = new THREE.PlaneGeometry(1, 1);
  const flightCells = new THREE.InstancedBufferAttribute(new Float32Array(CARDS * 2), 2);
  flightCells.setUsage(THREE.DynamicDrawUsage);
  flightGeo.setAttribute("aCell", flightCells);
  const flight = new THREE.InstancedMesh(
    flightGeo,
    new THREE.ShaderMaterial({
      vertexShader: TILE_VERT,
      fragmentShader: TILE_FRAG,
      uniforms: { uAtlas: { value: atlas }, uCells: { value: ATLAS_CELLS } },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    CARDS
  );
  flight.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flight.frustumCulled = false;
  flight.visible = false;
  flight.renderOrder = 120;
  world.add(flight);
  const cardRandom = mulberry(11);
  const cards = Array.from({ length: CARDS }, () => ({
    angle: cardRandom() * Math.PI * 2,
    radius: cardRandom(),
    delay: cardRandom(),
    size: 0.75 + cardRandom() * 0.6,
    spin: (cardRandom() - 0.5) * 2.4,
    flip: cardRandom() * Math.PI * 2,
    pick: cardRandom(),
  }));
  let flightStop = null;

  /* Le carte mostrano le foto che stanno per arrivare e quelle appena viste. */
  function dealCards(stop) {
    flightStop = stop;
    flightPool = stop;
    const near = prints.filter((p) => p.cell != null && Math.abs(p.a - stop.u1 - 1.5) < 4.5).map((p) => p.cell);
    const pool = near.length ? near : atlasUsed.filter((c) => c !== 0);
    if (!pool.length) return;
    cards.forEach((c, i) => {
      const cell = pool[Math.floor(c.pick * pool.length)];
      flightCells.setXY(i, cell % ATLAS_CELLS, Math.floor(cell / ATLAS_CELLS));
    });
    flightCells.needsUpdate = true;
  }

  function updateFlight(position, time) {
    const FLIGHT_IN = 0.95;
    const FLIGHT_OUT = 0.85;
    const stop = beats.find((b, i) => i > 0 && position > b.u0 - FLIGHT_IN && position < b.u0 + FLIGHT_OUT);
    if (!stop || !atlasUsed.length) {
      flight.visible = false;
      return;
    }
    if (flightStop !== stop || flightPool !== stop) dealCards(stop);
    flight.visible = true;
    const w = (position - (stop.u0 - FLIGHT_IN)) / (FLIGHT_IN + FLIGHT_OUT);
    const newPlace = beats[beats.indexOf(stop) - 1].chapter !== stop.chapter;
    flight.position.copy(camera.position);
    flight.quaternion.copy(camera.quaternion);
    const reach = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    cards.forEach((c, i) => {
      const local = clamp(w * 1.75 - c.delay * 0.75, 0, 1);
      if (local <= 0 || local >= 1) {
        dummy.scale.setScalar(0.0001);
        dummy.position.set(0, 0, 0);
        dummy.quaternion.identity();
      } else {
        /* Accelera arrivando: lontane sembrano ferme, vicine sfrecciano. */
        const z = lerp(-44, -0.9, local * local);
        const depth = -z * reach;
        /* Il centro resta libero se si resta in zona, si chiude se si cambia città. */
        const inner = newPlace ? 0.04 : 0.62;
        const r = (inner + c.radius * (1.25 - inner)) * depth;
        const a = c.angle + local * 2.2 * (i % 2 ? 1 : -1) + time * 0.08;
        dummy.position.set(Math.cos(a) * r * Math.max(camera.aspect, 0.8), Math.sin(a) * r, z);
        dummy.rotation.set(Math.sin(c.flip + local * 4) * 0.5, Math.cos(c.flip + local * 3) * 0.5, c.flip + local * c.spin);
        const size = c.size * (newPlace ? 3.1 : 2.1) * Math.min(1, local * 6);
        dummy.scale.set(size, size, 1);
      }
      dummy.updateMatrix();
      flight.setMatrixAt(i, dummy.matrix);
    });
    flight.instanceMatrix.needsUpdate = true;
  }

  /* ---------- La scritta di foto ---------- */
  const MAX_TILES = isPhone ? 240 : 380;
  const tileGeo = new THREE.PlaneGeometry(1, 1);
  const tileCells = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TILES * 2), 2);
  tileCells.setUsage(THREE.DynamicDrawUsage);
  tileGeo.setAttribute("aCell", tileCells);
  const tiles = new THREE.InstancedMesh(
    tileGeo,
    new THREE.ShaderMaterial({
      vertexShader: TILE_VERT,
      fragmentShader: TILE_FRAG,
      uniforms: { uAtlas: { value: atlas }, uCells: { value: ATLAS_CELLS } },
    }),
    MAX_TILES
  );
  tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tiles.frustumCulled = false;
  tiles.visible = false;
  tiles.renderOrder = 150;
  world.add(tiles);
  /* Il profilo delle lettere, scuro, dietro le foto: sul cielo giallo sono lui
     e gli spazi tra le caselle a rendere leggibili le parole. */
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: "#2b2622", transparent: true, opacity: 0, depthWrite: false, fog: false })
  );
  plate.visible = false;
  plate.frustumCulled = false;
  plate.renderOrder = 149;
  world.add(plate);
  let tilesDirty = true;
  const tileSpots = [];
  let tileSize = 1;

  /* Si disegnano le parole su un canvas e si tiene una casella dove c'è
     inchiostro: così la scritta si adatta a schermo e lingua senza coordinate
     fatte a mano. La griglia si allarga finché le caselle stanno nel limite. */
  function layoutTiles() {
    const narrow = camera.aspect < 1;
    const lines = narrow ? THANKS.narrow : THANKS.wide;
    const W = 1200;
    const H = Math.round(W * (wall.h / wall.w));
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });
    const family = '"Arial Black", "Helvetica Neue", Roboto, system-ui, sans-serif';
    let size = H;
    g.font = `900 ${size}px ${family}`;
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    size = Math.min((size * W * 0.96) / widest, (H * 0.96) / (lines.length * 1.08));
    g.font = `900 ${size}px ${family}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = g.strokeStyle = "#000";
    g.lineJoin = "round";
    /* Il contorno ingrossa le lettere: i font sottili non reggerebbero la griglia. */
    g.lineWidth = size * 0.07;
    const lead = size * 1.08;
    lines.forEach((l, i) => {
      const y = H / 2 + (i - (lines.length - 1) / 2) * lead;
      g.fillText(l, W / 2, y);
      g.strokeText(l, W / 2, y);
    });
    plate.material.map?.dispose();
    plate.material.map = new THREE.CanvasTexture(c);
    plate.material.needsUpdate = true;
    const data = g.getImageData(0, 0, W, H).data;
    let cell = Math.max(10, Math.round(W / 76));
    let spots;
    for (;;) {
      spots = [];
      for (let y = cell / 2; y < H; y += cell) {
        for (let x = cell / 2; x < W; x += cell) {
          /* Una casella resta solo se sta quasi tutta dentro la lettera: così
             gli occhielli di A, R ed E restano aperti. */
          let inside = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const px = Math.floor(x + dx * cell * 0.36);
              const py = Math.floor(y + dy * cell * 0.36);
              if (px >= 0 && py >= 0 && px < W && py < H && data[(py * W + px) * 4 + 3] > 128) inside += 1;
            }
          }
          if (inside >= 7) spots.push([x, y]);
        }
      }
      if (spots.length <= MAX_TILES) break;
      cell += 1;
    }
    const unit = wall.w / W;
    tileSize = cell * unit;
    tileSpots.length = 0;
    const r = mulberry(31);
    for (const [x, y] of spots) {
      tileSpots.push({
        x: (x - W / 2) * unit,
        y: (H / 2 - y) * unit,
        /* Le lettere si riempiono da sinistra a destra, con un po' di disordine. */
        delay: (x / W) * 0.72 + r() * 0.28,
        angle: r() * Math.PI * 2,
        band: 0.8 + r() * 0.2,
        tilt: (r() - 0.5) * 0.9,
        seed: r() * 6.28,
      });
    }
    tiles.count = tileSpots.length;
    tilesDirty = true;
  }

  /* Una casella su cinque è la foto appena scattata, il resto gira su tutte. */
  function assignTiles() {
    tilesDirty = false;
    const others = atlasUsed.filter((c) => c !== 0);
    if (!others.length) return;
    const r = mulberry(5);
    tileSpots.forEach((spot, i) => {
      const cell = i % 5 === 0 && atlasUsed.includes(0) ? 0 : others[Math.floor(r() * others.length)];
      tileCells.setXY(i, cell % ATLAS_CELLS, Math.floor(cell / ATLAS_CELLS));
    });
    tileCells.needsUpdate = true;
  }

  /* ---------- Stato ---------- */
  let vw = 1;
  let vh = 1;
  let fit = 1;
  let u = 0;
  let target = 0;
  let velocity = 0;
  let last = performance.now();
  let focused = null;
  let jolt = 0;
  let unlocked = false;
  const pointer = new THREE.Vector2();
  const pointerSmooth = new THREE.Vector2();

  const pBus = new THREE.Vector3();
  const pDir = new THREE.Vector3();
  const pRight = new THREE.Vector3();
  const pLook = new THREE.Vector3();
  const camForward = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const axisZ = new THREE.Vector3(0, 0, 1);
  const axisY = new THREE.Vector3(0, 1, 0);
  const tmpQ = new THREE.Quaternion();
  const mix = {};
  for (const k of SKY_COLORS) mix[k] = new THREE.Color();
  const skyLook = new THREE.Vector3();

  function currentSky(x) {
    let i = 0;
    while (i < skyStops.length - 2 && x >= skyStops[i + 1].u) i += 1;
    const a = skyStops[i];
    const b = skyStops[i + 1];
    const t = b.u > a.u ? smooth(a.u, b.u, x) : 1;
    const A = palettes[a.key];
    const B = palettes[b.key];
    for (const k of SKY_COLORS) mix[k].copy(A[k]).lerp(B[k], t);
    for (const k of SKY_NUMBERS) mix[k] = lerp(A[k], B[k], t);
  }

  function applySky() {
    skyUniforms.uTop.value.copy(mix.top);
    skyUniforms.uMid.value.copy(mix.mid);
    skyUniforms.uLow.value.copy(mix.low);
    skyUniforms.uSun.value.copy(mix.sun);
    skyUniforms.uStars.value = mix.stars;
    skyLook.set(Math.sin(mix.sunAz) * Math.cos(mix.sunEl), Math.sin(mix.sunEl), -Math.cos(mix.sunAz) * Math.cos(mix.sunEl));
    skyUniforms.uSunDir.value.copy(skyLook);
    world.fog.color.copy(mix.low);
    groundMat.color.copy(mix.ground);
    roadMat.color.copy(mix.road);
    hemi.color.copy(mix.hemi);
    hemi.groundColor.copy(mix.hemiLow);
    hemi.intensity = mix.hemiI;
    key.color.copy(mix.sun);
    key.intensity = mix.keyI;
    lampMat.opacity = mix.lamps;
    lamps.visible = mix.lamps > 0.02;
    glowMat.color.setScalar(0.28 + mix.lamps * 0.85);
    sandMat.color.set("#ecd6a4").lerp(mix.low, 0.25).multiplyScalar(clamp(mix.hemiI / 2, 0.45, 1));
    paintMat.color.set("#fff8e1").lerp(mix.road, 0.25);
    if (sea) {
      const su = sea.material.uniforms;
      su.uSun.value.copy(mix.sun);
      su.uFog.value.copy(mix.low);
      su.uDeep.value.set("#17609e").lerp(mix.top, 0.45);
      su.uShallow.value.set("#4cc0d0").lerp(mix.mid, 0.45);
    }
  }

  function currentAir(x) {
    if (x > finale) {
      const a = airUniforms;
      const set = particleSets.confetti;
      a.uAmount.value = smooth(finale, finale + 0.8, x) * 0.7 + 0.1;
      a.uSize.value = set.size;
      a.uFall.value = set.fall;
      a.uDrift.value = set.drift;
      a.uShape.value = set.shape;
      a.uColorA.value.copy(set.a);
      a.uColorB.value.copy(set.b);
      a.uConfetti.value = 1;
      return;
    }
    const c = chapters.find((ch) => x < ch.u1) ?? chapters[chapters.length - 1];
    const prev = chapters[c.index - 1];
    const set = particleSets[c.particles];
    const t = prev ? smooth(c.u0, c.photosU, x) : 1;
    const from = prev ? particleSets[prev.particles] : set;
    const a = airUniforms;
    /* Prima di cambiare natura le particelle spariscono: tra due forme diverse
       una via di mezzo sarebbe solo un errore visivo. */
    a.uAmount.value = (t < 0.5 ? from.amount * (1 - t * 2) : set.amount * (t * 2 - 1));
    const cur = t < 0.5 ? from : set;
    a.uSize.value = cur.size;
    a.uFall.value = cur.fall;
    a.uDrift.value = cur.drift;
    a.uShape.value = cur.shape;
    a.uColorA.value.copy(cur.a);
    a.uColorB.value.copy(cur.b);
    a.uConfetti.value = 0;
  }

  /* Dove sta la stampa a fuoco, davanti alla camera. */
  function heroPose(p, dist, out, outQ) {
    const hv = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const usableH = hv * (vw / vh < 1 ? 0.62 : 0.74);
    const usableW = hv * (vw / vh) * 0.88;
    const s = Math.min(usableW / p.w, usableH / p.h);
    out.copy(camera.position).addScaledVector(camForward, dist).addScaledVector(camUp, hv * 0.05);
    outQ.copy(camera.quaternion);
    return s;
  }

  /* Il muro finale: tutte le foto, in griglia, oltre il traguardo. */
  const wall = { cols: 7, gap: 0.26, cell: 2.5 };
  function layoutWall() {
    const portrait = vw / vh < 1;
    wall.cols = portrait ? 5 : 8;
    wall.cell = portrait ? 2.2 : 2.7;
    const rows = Math.ceil(prints.length / wall.cols);
    prints.forEach((p, i) => {
      const r = Math.floor(i / wall.cols);
      const inRow = r === rows - 1 ? prints.length - r * wall.cols : wall.cols;
      const c = i - r * wall.cols;
      p.wallX = (c - (inRow - 1) / 2) * (wall.cell + wall.gap);
      p.wallY = ((rows - 1) / 2 - r) * (wall.cell + wall.gap);
      p.wallZ = Math.sin(i * 12.9898) * 0.5;
    });
    wall.h = rows * (wall.cell + wall.gap);
    wall.w = wall.cols * (wall.cell + wall.gap);
    layoutTiles();
  }

  function resize() {
    vw = document.documentElement.clientWidth;
    vh = window.innerHeight;
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    fit = Math.max(1, 1.25 / camera.aspect);
    camera.updateProjectionMatrix();
    airUniforms.uPixels.value = vh * renderer.getPixelRatio() * 0.9;
    layoutWall();
    syncHeight();
  }

  function syncHeight() {
    if (!unlocked) return;
    document.getElementById("runway").style.height = `${(total * SCROLL_VH_PER_UNIT + 100) * (vh / 100)}px`;
  }

  function readScroll() {
    const room = document.documentElement.scrollHeight - vh;
    target = unlocked && room > 0 ? (window.scrollY / room) * total : 0;
  }

  /* ---------- Il fotogramma ---------- */
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = clamp((now - last) / 1000, 0.001, 0.25);
    last = now;
    const t = now / 1000;

    /* Lo scroll arriva a scatti, il pulmino no. */
    const before = u;
    u += (target - u) * (1 - Math.exp(-dt * 5.5));
    if (Math.abs(target - u) < 0.0004) u = target;
    velocity += ((u - before) / dt - velocity) * (1 - Math.exp(-dt * 8));
    const speed = clamp(Math.abs(velocity) / 2.2, 0, 1);

    party.value += (party.target - party.value) * (1 - Math.exp(-dt * 2.2));
    party.shot = Math.min(1, party.shot + dt / 1.9);
    if (selfie.ready && party.shot >= 1) party.hold += dt;
    if (party.hold > 2.4) party.thanks = Math.min(1, party.thanks + dt / 4.4);

    pointerSmooth.lerp(pointer, 0.07);
    currentSky(u);
    applySky();
    currentAir(u);

    const s = distanceAt(u);
    roadPoint(s, pBus);
    roadDir(s, pDir);
    pRight.set(-pDir.z, 0, pDir.x).normalize();

    /* Pulmino */
    jolt *= Math.exp(-dt * 5);
    const engine = u < INTRO_UNITS ? 0.012 : 0.02 * (0.4 + speed);
    bus.root.position.copy(pBus);
    bus.root.rotation.y = Math.atan2(-pDir.x, -pDir.z) + Math.PI / 2;
    bus.pose.rotation.z = clamp(velocity * 0.006, -0.02, 0.02) + jolt * 0.035;
    bus.body.position.y = Math.sin(t * 16) * engine * 0.3 + Math.sin(t * 2.3) * 0.01;
    bus.body.rotation.x = Math.sin(t * 1.7) * 0.004 + clamp(pDir.x * 0.05, -0.02, 0.02);
    bus.setRoll(s);
    bus.setLight(clamp(mix.hemiI / 2, 0.3, 1));
    const beat = Math.pow(Math.max(0, Math.sin(t * 2.5)), 12);
    bus.badge.visible = u < INTRO_UNITS * 0.7;
    bus.badge.scale.setScalar(1 + beat * 0.14);

    /* Camera: di fianco al pulmino parcheggiato, poi dietro; tra un capitolo e
       l'altro gli gira intorno. */
    const stop = beats.find((b) => u >= b.u0 && u < b.u1);
    const gap = stop ? (u - stop.u0) / (stop.u1 - stop.u0) : 0;
    const gapShape = stop ? Math.pow(Math.sin(gap * Math.PI), 0.7) : 0;
    /* In tappa la camera sta dalla parte opposta al luogo, con il pulmino
       davanti e il luogo dietro. Dentro l'aula resta in scia, bassa. */
    const orbitSide = stop && !stop.through ? -stop.side : 1;
    const orbit = stop?.through ? 0 : 1.15;
    const intro = 1 - smooth(0.2, INTRO_UNITS, u);
    let theta = lerp(0.2, 1.38, intro) + orbitSide * gapShape * orbit;
    theta += pointerSmooth.x * 0.05;
    const R = Math.min((lerp(10.5, 9.6, intro) + gapShape * (stop?.through ? -1 : 4.5)) * fit, lerp(40, stop?.through ? 9 : 17, gapShape));
    const height = Math.max(1.5, lerp(3.3, 2.1, intro) - gapShape * 1.4) + pointerSmooth.y * -0.2;
    camera.position
      .copy(pBus)
      .addScaledVector(pDir, -Math.cos(theta) * R)
      .addScaledVector(pRight, Math.sin(theta) * R);
    camera.position.y = pBus.y + height;
    pLook.copy(pBus).addScaledVector(pDir, lerp(4.5, 0, intro));
    pLook.y = pBus.y + lerp(1.8, 1.4, intro);
    if (stop && !stop.through) pLook.lerp(stop.centre, gapShape * (camera.aspect < 1 ? 0.22 : 0.6));

    for (const b of beats) {
      b.entry.group.visible = Math.abs(s - b.s) < 330;
      if (b.entry.mover) b.entry.mover.position.x = lerp(-20, 20, clamp((u - b.u0) / (b.u1 - b.u0), 0, 1));
    }

    /* Finale: la camera arretra e guarda il muro di foto. */
    const finaleT = smooth(finale + 0.2, finale + 2.6, u);
    if (finaleT > 0) {
      const closeUp = easeInOut(smooth(0.08, 0.7, party.thanks));
      const wallDist = Math.max(wall.h / (2 * Math.tan(THREE.MathUtils.degToRad(23))), wall.w / (2 * Math.tan(THREE.MathUtils.degToRad(23)) * camera.aspect)) * lerp(1.5, 1.08, closeUp);
      vA.copy(pBus).addScaledVector(pDir, WALL_AHEAD);
      vA.y += wall.h / 2 + WALL_LIFT;
      vB.copy(vA).addScaledVector(pDir, -wallDist);
      vB.y -= wall.h * 0.34 * (1 - closeUp);
      camera.position.lerp(vB, finaleT);
      pLook.lerp(vA, finaleT);
    }

    /* Tagliato il traguardo, lo striscione si alza e libera la vista. */
    arch.position.y = roadY(end - 22) + finaleT * finaleT * 34;

    camera.fov = 46 + speed * 9 + gapShape * (stop?.through ? 8 : 12);
    camera.updateProjectionMatrix();
    camera.lookAt(pLook);
    camera.rotateZ(Math.sin(t * 0.4) * 0.006 - clamp(velocity * 0.01, -0.03, 0.03));
    camera.getWorldDirection(camForward);
    camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);

    key.position.copy(pBus).addScaledVector(skyLook, 100);
    key.target.position.copy(pBus);
    airUniforms.uCamera.value.copy(camera.position);
    airUniforms.uTime.value = t;
    if (sea) {
      sea.material.uniforms.uTime.value = t;
      sea.material.uniforms.uCamera.value.copy(camera.position);
    }

    /* Foto */
    let best = null;
    let bestFocus = 0;
    /* In tappa la foto appena vista e quella che arriva restano in alto ai
       lati: si guarda il luogo senza perdere il filo delle foto. */
    const peekIn = stop ? smooth(0, 0.15, gap) * (1 - smooth(0.84, 0.97, gap)) : 0;
    const nextPrint = stop ? prints.findIndex((p) => !p.guest && p.a >= stop.u1) : -1;
    for (const p of prints) {
      const tl = (u - p.a) / 1;
      const m = p.mesh.material.uniforms;
      const showFinale = finaleT > 0.001;
      const live = tl > -1.1 && tl < 1.25;
      const peekSide = nextPrint < 0 ? 0 : p.index === nextPrint ? 1 : p.index === nextPrint - 1 ? -1 : 0;
      const peek = peekSide ? peekIn : 0;
      p.mesh.visible = p.ready && (live || showFinale || peek > 0);
      if (!p.mesh.visible) continue;

      m.uTime.value = t;
      m.uPointer.value.copy(pointerSmooth);
      m.uFog.value.copy(world.fog.color);
      m.uSplit.value = speed * speed;
      m.uBend.value = clamp(velocity * 0.035, -0.16, 0.16) * p.h * p.mesh.scale.y;

      /* Tre pose: al bordo strada, davanti alla camera, oltre la camera. */
      const standS = p.s + 8;
      roadPoint(standS, vA);
      const dirS = roadDir(standS, new THREE.Vector3());
      const rightS = new THREE.Vector3(-dirS.z, 0, dirS.x).normalize();
      vA.addScaledVector(rightS, p.side * (camera.aspect < 1 ? 5.4 : 7.4));
      vA.y += 2.9 + Math.sin(t * 0.8 + p.seed) * 0.12;
      qA.setFromAxisAngle(axisY, Math.atan2(-dirS.x, -dirS.z) + Math.PI - p.side * 0.5);
      tmpQ.setFromAxisAngle(axisZ, p.tilt * 2);
      qA.multiply(tmpQ);

      const dist = 5.6;
      const heroScale = heroPose(p, dist, vB, qB);
      const breathe = 1 + Math.max(0, Math.min(tl, 1)) * 0.05;
      const held = smooth(-0.32, 0.12, tl);
      const gone = smooth(0.8, 1.14, tl);
      const eased = easeInOut(held);

      p.mesh.position.copy(vA).lerp(vB, eased);
      /* Arco: la stampa si solleva mentre vola verso di noi. */
      p.mesh.position.y += Math.sin(eased * Math.PI) * 0.9;
      p.mesh.quaternion.copy(qA).slerp(qB, eased);
      /* Un giro completo in arrivo: la stampa si volta e si mostra. */
      tmpQ.setFromAxisAngle(axisY, (1 - eased) * p.side * 1.2);
      p.mesh.quaternion.multiply(tmpQ);
      tmpQ.setFromAxisAngle(axisZ, p.tilt * eased + Math.sin(t * 0.6 + p.seed) * 0.012);
      p.mesh.quaternion.multiply(tmpQ);

      let sc = lerp(1.9, heroScale * breathe, eased);

      if (gone > 0) {
        vA.copy(p.mesh.position).addScaledVector(camRight, p.side * 7).addScaledVector(camForward, -2).addScaledVector(camUp, 0.8);
        p.mesh.position.lerp(vA, gone * gone);
        tmpQ.setFromAxisAngle(axisY, p.side * gone * 1.1);
        p.mesh.quaternion.multiply(tmpQ);
      }

      let fade = smooth(-1.1, -0.85, tl) * (1 - smooth(1.02, 1.2, tl));
      m.uFogAmount.value = (1 - eased) * clamp((camera.position.distanceTo(p.mesh.position) - 30) / 70, 0, 0.9);

      if (peek > 0) {
        const narrow = camera.aspect < 1;
        const span = 2 * 5.6 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const across = span * camera.aspect;
        const target = Math.min(((narrow ? 0.24 : 0.4) * span) / p.h, ((narrow ? 0.44 : 0.3) * across) / p.w);
        const lift = (narrow ? 0.31 : 0.2) * span + Math.sin(t * 0.7 + p.seed) * 0.04;
        vC.copy(camera.position)
          .addScaledVector(camForward, 5.6)
          .addScaledVector(camRight, peekSide * (narrow ? 0.25 : 0.34) * across)
          .addScaledVector(camUp, lift);
        const ease = easeInOut(peek);
        p.mesh.position.lerp(vC, ease);
        qA.copy(camera.quaternion);
        tmpQ.setFromAxisAngle(axisZ, -peekSide * 0.05 + Math.sin(t * 0.5 + p.seed) * 0.015);
        qA.multiply(tmpQ);
        p.mesh.quaternion.slerp(qA, ease);
        sc = lerp(sc, target, ease);
        fade = Math.max(fade, smooth(0, 0.3, peek));
        m.uFogAmount.value *= 1 - ease;
      }

      /* Nel finale ogni foto vola al suo posto nel muro, una dopo l'altra. */
      if (showFinale) {
        const delay = (p.index / prints.length) * 0.5;
        const w = easeInOut(clamp((finaleT - delay) / 0.5, 0, 1));
        if (w > 0) {
          vA.copy(pBus).addScaledVector(pDir, WALL_AHEAD + p.wallZ);
          vA.y += wall.h / 2 + WALL_LIFT;
          vA.addScaledVector(camRight, p.wallX).addScaledVector(camUp, p.wallY);
          vA.y += Math.sin(t * 0.7 + p.seed) * 0.08;
          const wallScale = wall.cell / Math.max(p.w, p.h);
          if (!live) {
            p.mesh.position.copy(vB);
            p.mesh.quaternion.copy(qB);
            sc = heroScale;
          }
          p.mesh.position.lerp(vA, w);
          p.mesh.quaternion.slerp(qB, w);
          sc = lerp(sc, wallScale, w);
          /* Festa: le foto lasciano il muro e girano intorno alla stampa nuova. */
          const ring = party.value * finaleT;
          if (ring > 0.001) {
            const angle = (p.index / prints.length) * Math.PI * 2 + t * 0.22;
            const band = p.index % 2 ? 0.78 : 1;
            const rx = wall.w * 0.46 * band;
            const ry = wall.h * 0.47 * band;
            vC.copy(pBus).addScaledVector(pDir, WALL_AHEAD + p.wallZ);
            vC.y += wall.h / 2 + WALL_LIFT;
            vC.addScaledVector(camRight, Math.cos(angle) * rx).addScaledVector(camUp, Math.sin(angle) * ry);
            p.mesh.position.lerp(vC, easeInOut(ring));
            sc = lerp(sc, wallScale * 0.66, ring);
          }
          fade = Math.max(fade, smooth(0, 0.08, w));
          m.uFogAmount.value *= 1 - w;
        } else if (!live) {
          fade = 0;
        }
      }

      p.mesh.scale.set(p.w * sc, p.h * sc, sc);
      /* Solo nel finale: chi torna con la sua foto deve rivedere tutto il viaggio. */
      fade *= 1 - smooth(0.04, 0.34, party.thanks * finaleT);
      m.uFade.value = fade;
      p.mesh.visible = p.mesh.visible && fade > 0.004;
      /* La stampa si sviluppa mentre arriva, come una polaroid. */
      m.uDevelop.value = showFinale ? 1 : Math.max(smooth(-0.45, 0.28, tl), peek);
      m.uFocus.value = held * (1 - gone);
      m.uWave.value = lerp(0.04, 0.012, held * (1 - gone));

      const focus = held * (1 - gone);
      if (focus > bestFocus && !showFinale) {
        bestFocus = focus;
        best = p;
      }
    }

    /* La stampa del traguardo vola dalla camera al centro e si sviluppa. */
    const partyOn = selfie.ready && party.value * finaleT > 0.01;
    selfie.mesh.visible = partyOn;
    if (partyOn) {
      const m = selfie.mesh.material.uniforms;
      const fly = easeInOut(party.shot);
      const size = Math.min(wall.w, wall.h) * 0.56;
      const finalScale = size / Math.max(selfie.w, selfie.h);
      const startScale = heroPose(selfie, 5.6, vB, qB);
      vC.copy(pBus).addScaledVector(pDir, WALL_AHEAD - 0.8);
      vC.y += wall.h / 2 + WALL_LIFT + Math.sin(t * 0.9) * 0.12;
      selfie.mesh.position.copy(vB).lerp(vC, fly);
      selfie.mesh.position.addScaledVector(camUp, Math.sin(fly * Math.PI) * 1.2);
      selfie.mesh.quaternion.copy(qB);
      tmpQ.setFromAxisAngle(axisZ, (1 - fly) * 0.3 - 0.03 + Math.sin(t * 0.7) * 0.015);
      selfie.mesh.quaternion.multiply(tmpQ);
      const sc = lerp(startScale, finalScale, fly) * (1 - smooth(0.05, 0.42, party.thanks) * 0.8);
      selfie.mesh.scale.set(selfie.w * sc, selfie.h * sc, sc);
      m.uTime.value = t;
      m.uPointer.value.copy(pointerSmooth);
      m.uFog.value.copy(world.fog.color);
      m.uDevelop.value = smooth(0.1, 0.8, party.shot);
      m.uFade.value = smooth(0.01, 0.2, party.value * finaleT) * (1 - smooth(0.3, 0.46, party.thanks));
      m.uWave.value = 0.02;
    }
    /* L'atlante si carica quando le foto hanno smesso di arrivare. */
    if (atlasChanged && now - atlasChanged > 700) {
      atlas.needsUpdate = true;
      atlasChanged = 0;
    }
    updateFlight(u, t);

    /* Le foto lasciano il cerchio e compongono la scritta. */
    tiles.visible = plate.visible = party.thanks > 0.001 && finaleT > 0.3 && tileSpots.length > 0;
    if (tiles.visible) {
      if (tilesDirty) assignTiles();
      vC.copy(pBus).addScaledVector(pDir, WALL_AHEAD - 0.4);
      vC.y += wall.h / 2 + WALL_LIFT;
      plate.position.copy(vC).addScaledVector(camForward, 0.1);
      plate.quaternion.copy(camera.quaternion);
      plate.scale.set(wall.w, wall.h, 1);
      plate.material.opacity = smooth(0.25, 0.75, party.thanks);
      const reveal = party.thanks;
      tileSpots.forEach((spot, i) => {
        const local = easeInOut(clamp((reveal - spot.delay * 0.55) / 0.45, 0, 1));
        const ax = Math.cos(spot.angle + t * 0.22) * wall.w * 0.44 * spot.band;
        const ay = Math.sin(spot.angle + t * 0.22) * wall.h * 0.45 * spot.band;
        const x = lerp(ax, spot.x, local);
        const y = lerp(ay, spot.y, local) + Math.sin(t * 0.8 + spot.x * 0.5) * 0.06 * local;
        const lift = Math.sin(local * Math.PI) * 2.4;
        dummy.position.copy(vC).addScaledVector(camRight, x).addScaledVector(camUp, y).addScaledVector(camForward, -lift);
        dummy.quaternion.copy(camera.quaternion);
        tmpQ.setFromAxisAngle(axisZ, spot.tilt * (1 - local) * 3 + Math.sin(t + spot.seed) * 0.03);
        dummy.quaternion.multiply(tmpQ);
        const size = tileSize * 0.97 * Math.min(1, local * 3) * finaleT;
        dummy.scale.set(size, size, 1);
        dummy.updateMatrix();
        tiles.setMatrixAt(i, dummy.matrix);
      });
      tiles.instanceMatrix.needsUpdate = true;
    }

    if (party.value > 0.01) {
      airUniforms.uAmount.value = Math.max(airUniforms.uAmount.value, party.value * finaleT);
    }

    /* Alone e sfondo che arretra dietro la foto a fuoco. */
    if (best) {
      halo.position.copy(best.mesh.position).addScaledVector(camForward, 0.4);
      halo.quaternion.copy(camera.quaternion);
      const size = Math.max(best.w, best.h) * best.mesh.scale.z * 2.1;
      halo.scale.set(size, size, 1);
      if (best.tint) halo.material.color.copy(best.tint);
      halo.material.opacity = bestFocus * 0.72;
      halo.visible = true;
    } else {
      halo.visible = false;
    }

    document.documentElement.style.setProperty("--focus", (best ? bestFocus : 0).toFixed(3));

    const nextFocused = bestFocus > 0.8 ? best : null;
    if (nextFocused !== focused) {
      focused = nextFocused;
      onFocusPrint?.(focused);
    }

    onProgress?.(u / total, u);

    renderer.render(world, camera);
  }

  /* ---------- Avvio ---------- */
  window.addEventListener("resize", resize);
  window.addEventListener("scroll", readScroll, { passive: true });
  if (window.matchMedia("(hover: hover)").matches) {
    window.addEventListener("pointermove", (e) => {
      pointer.set((e.clientX / Math.max(vw, 1)) * 2 - 1, (e.clientY / Math.max(vh, 1)) * 2 - 1);
    }, { passive: true });
  }

  resize();
  currentSky(0);
  applySky();
  requestAnimationFrame((n) => {
    last = n;
    frame(n);
    onReady?.();
  });

  return {
    total,
    addPhoto,
    addGuest,
    unlock() {
      if (unlocked) return;
      unlocked = true;
      syncHeight();
      /* Si comincia sempre dal pulmino parcheggiato, anche ricaricando. */
      window.scrollTo(0, 0);
      readScroll();
    },
    get unlocked() {
      return unlocked;
    },
    get position() {
      return u;
    },
    kick() {
      jolt = 1;
    },
    /* La foto del traguardo: celebrate la fa arrivare in volo, altrimenti la
       si ritrova già al suo posto. */
    setSelfie(image, { celebrate }) {
      fillPrint(selfie, image);
      party.target = 1;
      party.shot = celebrate ? 0 : 1;
      party.hold = 0;
      party.thanks = celebrate ? 0 : 1;
      if (!celebrate) party.value = 1;
    },
    /* Primo tratto dopo il tocco sul pulmino. */
    departureY() {
      return (INTRO_UNITS / total) * (document.documentElement.scrollHeight - vh);
    },
  };
}

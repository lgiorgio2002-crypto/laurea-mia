// Il viaggio: un mondo Three.js percorso da un pulmino, a passi. Ogni tocco è un
// passo: una foto, un luogo, il finale. Più tocchi in fretta, più va in fretta.
// Tutto è funzione di una sola grandezza, "u", le unità di timeline: 1 unità è
// una foto. I passi decidono u, u decide tutto il resto, così tornare indietro
// riavvolge il film. Solo la vita di fondo (aria, onde, foto che respirano) va
// avanti da sola.
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createBus } from "./bus.js";
import { createNavMap } from "./navmap.js";
import { FINALE_SKY, PALETTES, PARTICLES, THANKS } from "./chapters.js";
import { buildLandmark, facadeRelief, facadeTexture, groundTexture, LANDMARKS, weatherFacade } from "./landmarks.js";
import { CITIES, onBeachFront, onLand, outlines, ROUTE } from "./map.js";

/* Un passo fermo dura così, in secondi. I tocchi in coda lo accorciano. */
const STEP_TIME = 0.95;
const SWIPE_PX = 42;
const HOLD_MS = 450;
const WORLD_PER_UNIT = 30;
const FINALE_UNITS = 4.5;
const INTRO_UNITS = 1.4;
/* Quanto dura una tappa: il pulmino rallenta e la camera mostra il luogo. */
const BEAT_UNITS = 1.9;
/* Il muro finale sta poco oltre il punto in cui si ferma il pulmino. */
const WALL_AHEAD = 12;
const WALL_LIFT = 5.5;
/* Il tratto dritto davanti a ogni luogo, da una parte e dall'altra. */
const BEAT_ROAD = 38;
/* Il salto di città cade dove le foto in volo coprono lo schermo. */
const CUT_BEFORE = 0.1;
const LEG_GAP = 800;
const ROAD_STEP = 2;
/* Metri di mondo coperti da una tessera di selciato. */
const TILE = 7;
/* La carreggiata, poi il marciapiede. */
const ROAD_HALF = 4.3;
const WALK_HALF = 7.6;
/* Una casa tipo, in metri: serve a dare lo spessore giusto al rilievo. */
const HOUSE_WIDE = 20;
const HOUSE_DEEP = 16;
/* Quanto spazio libero chiede ogni luogo attorno a sé. */
const NAV_MAP = true;
const CLEARING = { tiber: 118, colosseum: 92, comercio: 135, nova: 104, pantheon: 72, luissVilla: 80, luissGlass: 62, aula: 62, vittoriano: 74, spagna: 72, tower: 50, belem: 40, tram: 92, carcavelos: 78, sunsetBeach: 70 };
/* Guida libera. */
const DRIVE = { top: 36, reverse: 12, accel: 20, brake: 34, drag: 9, turn: 1.7 };

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
   Una curva per città, passante per i luoghi di map.js e campionata a passi
   uguali. s è la distanza lungo tutti i tratti messi in fila, con un vuoto tra
   l'uno e l'altro: si calcola su s come se la strada fosse una sola. */
let legs = [];

function buildRoad() {
  let cursor = 0;
  legs = Object.entries(ROUTE).map(([id, route]) => {
    const points = [];
    const anchors = [];
    for (const step of route.path) {
      if (step.via) {
        points.push(new THREE.Vector3(step.via[0], 0, step.via[1]));
        continue;
      }
      const spec = LANDMARKS[step.landmark];
      const h = THREE.MathUtils.degToRad(step.heading);
      const dx = Math.sin(h);
      const dz = -Math.cos(h);
      const o = step.side * spec.offset;
      /* La strada passa di fianco al luogo, a distanza giusta per inquadrarlo. */
      const x = step.place[0] + dz * o;
      const z = step.place[1] - dx * o;
      points.push(new THREE.Vector3(x - dx * BEAT_ROAD, 0, z - dz * BEAT_ROAD), new THREE.Vector3(x, 0, z), new THREE.Vector3(x + dx * BEAT_ROAD, 0, z + dz * BEAT_ROAD));
      anchors.push({ step, x, z });
    }
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
    curve.arcLengthDivisions = points.length * 80;
    const length = curve.getLength();
    const n = Math.ceil(length / ROAD_STEP);
    const samples = curve.getSpacedPoints(n);
    const leg = { id, city: route.city, start: cursor, end: cursor + length, step: length / n, xs: samples.map((p) => p.x), zs: samples.map((p) => p.z), stops: new Map() };
    let from = 0;
    for (const a of anchors) {
      let best = from;
      let bestD = Infinity;
      for (let i = from; i < samples.length; i++) {
        const d = Math.hypot(samples[i].x - a.x, samples[i].z - a.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
        /* Il primo passaggio, non un incrocio più avanti. */
        if (bestD < 3 && d > 12) break;
      }
      leg.stops.set(a.step.landmark, { s: leg.start + best * leg.step, step: a.step });
      from = best;
    }
    cursor = leg.end + LEG_GAP;
    return leg;
  });
}

function legAt(s) {
  for (let i = 0; i < legs.length - 1; i++) if (s < legs[i].end + LEG_GAP / 2) return legs[i];
  return legs[legs.length - 1];
}
function roadPoint(s, out = new THREE.Vector3()) {
  const leg = legAt(s);
  const f = (s - leg.start) / leg.step;
  const i = clamp(Math.floor(f), 0, leg.xs.length - 2);
  /* Oltre i capi la strada prosegue dritta. */
  const t = f - i;
  return out.set(lerp(leg.xs[i], leg.xs[i + 1], t), 0, lerp(leg.zs[i], leg.zs[i + 1], t));
}
const dirA = new THREE.Vector3();
const dirB = new THREE.Vector3();
function roadDir(s, out = new THREE.Vector3()) {
  roadPoint(s + 3, dirA);
  roadPoint(s - 3, dirB);
  return out.subVectors(dirA, dirB).normalize();
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

  buildRoad();
  const STEP = 0.02;
  const table = [0];
  for (let x = 0; x < total + STEP; x += STEP) {
    table.push(table[table.length - 1] + pace(x) * WORLD_PER_UNIT * STEP);
  }
  const rawAt = (x) => {
    const f = clamp(x, 0, total) / STEP;
    const i = Math.floor(f);
    return lerp(table[i], table[Math.min(i + 1, table.length - 1)], f - i);
  };

  /* Il ritmo è deciso sopra; qui lo si appoggia alla strada vera. Davanti ai
     luoghi il pulmino va alla sua velocità, tra un luogo e l'altro copre la
     distanza che c'è. Al cambio di città s salta. */
  const knots = [];
  const add = (r, at) => knots.push([r, at]);
  beats.forEach((b, i) => {
    const leg = legs.find((l) => l.id === chapters[b.chapter].id);
    const stop = leg.stops.get(b.landmark);
    b.s = stop.s;
    b.place = stop.step.place;
    b.name = stop.step.name;
    b.side = stop.step.side;
    const r0 = rawAt(b.u0);
    const r1 = rawAt(b.u1);
    const prev = beats[i - 1];
    if (!prev || prev.chapter !== b.chapter) {
      const cut = prev ? rawAt(b.u0 - CUT_BEFORE) : 0;
      if (prev) add(cut, prev.s + BEAT_ROAD + (cut - rawAt(prev.u1)));
      add(cut, b.s - BEAT_ROAD - (r0 - cut));
    }
    add(r0, b.s - BEAT_ROAD);
    add(r1, b.s + BEAT_ROAD);
    if (i === beats.length - 1) add(rawAt(total), b.s + BEAT_ROAD + rawAt(total) - r1);
  });
  const distanceAt = (x) => {
    const r = rawAt(x);
    for (let i = 0; i < knots.length - 1; i++) {
      if (r < knots[i + 1][0]) {
        const [r0, s0] = knots[i];
        const [r1, s1] = knots[i + 1];
        return lerp(s0, s1, (r - r0) / (r1 - r0));
      }
    }
    return knots[knots.length - 1][1];
  };

  chapters.forEach((c) => {
    const leg = legs.find((l) => l.id === c.id);
    c.s0 = leg.start;
    c.s1 = leg.end;
  });
  prints.forEach((p) => {
    p.s = distanceAt(p.a + 0.5);
  });
  beats.forEach((b) => {
    b.s0 = b.s - BEAT_ROAD;
    b.s1 = b.s + BEAT_ROAD;
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
  const uv = new Float32Array(rows * cols * 2);
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
      uv[((r * cols + c) * 2)] = pos[i] / TILE;
      uv[((r * cols + c) * 2) + 1] = pos[i + 2] / TILE;
      if (r < rows - 1 && c < cols - 1) {
        const a = r * cols + c;
        const b = a + cols;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  /* La strada è piana: la normale guarda in alto. */
  const up = new Float32Array(rows * cols * 3);
  for (let i = 1; i < up.length; i += 3) up[i] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(up, 3));
  g.setIndex(idx);
  return g;
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
uniform float uStars, uTime;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float cn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(vec3(i, 1.0)), b = hash(vec3(i + vec2(1, 0), 1.0)), c = hash(vec3(i + vec2(0, 1), 1.0)), e = hash(vec3(i + vec2(1, 1), 1.0));
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += cn(p) * a;
    p = p * 2.03 + 7.1;
    a *= 0.5;
  }
  return v;
}
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
  if (d.y > 0.0) {
    /* Nuvole su un soffitto piatto: si stringono verso l'orizzonte. */
    vec2 q = d.xz / (d.y + 0.14) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
    float f = fbm(q);
    float cover = smoothstep(0.5, 0.78, f) * smoothstep(0.015, 0.16, d.y) * (1.0 - uStars * 0.8);
    float lit = 0.72 + 0.5 * smoothstep(0.45, 0.8, fbm(q + uSunDir.xz * 0.12));
    vec3 cloud = mix(uLow, vec3(1.0), 0.62) * lit + uSun * pow(a, 6.0) * 0.3;
    c = mix(c, cloud, cover * 0.86);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/* Onde lunghe che arrivano a riva, si alzano e rompono in schiuma. d è la
   distanza dalla battigia. */
const SURF_VERT = /* glsl */ `
attribute float aD;
varying float vD;
varying float vCrest;
varying vec3 vWorld;
uniform float uTime;
float crest(float d, float x) {
  float p = d * 0.075 + uTime * 0.85 + sin(x * 0.013) * 1.6 + sin(x * 0.031) * 0.5;
  return pow(0.5 + 0.5 * sin(p), 11.0);
}
void main() {
  vec3 p = position;
  vD = aD;
  float c = crest(aD, p.x);
  float grow = smoothstep(8.0, 26.0, aD) * (1.0 - smoothstep(62.0, 120.0, aD));
  p.y += c * grow * 1.5;
  vCrest = c * grow;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const SURF_FRAG = /* glsl */ `
varying float vD;
varying float vCrest;
varying vec3 vWorld;
uniform vec3 uDeep, uShallow, uSun, uFog, uCamera;
uniform float uTime, uFogNear, uFogFar;
float n(vec2 p) { return sin(p.x + 0.9 * sin(p.y * 0.63)) * sin(p.y + 0.9 * sin(p.x * 0.71)); }
void main() {
  vec2 p = vWorld.xz;
  float w = n(p * vec2(0.09, 0.5) + uTime * 0.4) + 0.5 * n(p * vec2(0.23, 1.1) - uTime * 0.6);
  vec3 c = mix(uShallow, uDeep, smoothstep(6.0, 90.0, vD) + w * 0.08);
  /* La schiuma: sulla cresta che rompe, e a merletto sull'ultima lingua d'acqua. */
  float lace = smoothstep(0.1, 0.8, w) * (1.0 - smoothstep(6.0, 22.0, vD));
  float top = smoothstep(0.42, 0.86, vCrest + w * 0.05) * (1.0 - smoothstep(46.0, 74.0, vD));
  c = mix(c, vec3(1.0, 0.975, 0.93) + uSun * 0.04, clamp(top + lace, 0.0, 1.0));
  c += uSun * smoothstep(1.05, 1.4, w) * 0.4;
  c = mix(c, uFog, smoothstep(uFogNear, uFogFar, distance(vWorld, uCamera)));
  gl_FragColor = vec4(c, 1.0 - smoothstep(84.0, 118.0, vD));
  #include <colorspace_fragment>
}`;

/* L'invecchiamento dei luoghi: ogni muro prende la grana di una scansione vera
   secondo il suo materiale, con rilievo, colature e sporco che sale da terra. */
const WEAR_HEAD = /* glsl */ `
varying float vSurf;
varying vec3 vWp;
uniform sampler2D uBrick, uStone, uPlaster;
float wearH = 0.5;
bool wearGlass = false;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y);
}`;

const WEAR_BODY = /* glsl */ `
{
  vec3 fn = normalize(cross(dFdx(vWp), dFdy(vWp)));
  float up = abs(fn.y);
  float along = abs(fn.x) > abs(fn.z) ? vWp.z : vWp.x;
  vec2 q = up > 0.7 ? vWp.xz : vec2(along, vWp.y);
  const vec3 toLum = vec3(0.3, 0.59, 0.11);
  float bl = dot(texture2D(uBrick, q / 3.4).rgb, toLum) / BRICK_MEAN;
  float st = dot(texture2D(uStone, q / 13.0).rgb, toLum) / STONE_MEAN;
  float pl = dot(texture2D(uPlaster, q / 7.0).rgb, toLum) / PLASTER_MEAN;
  float grain = mix(1.0, pl, 0.75);
  if (vSurf > 1.5) grain = st;
  else if (vSurf > 0.5) grain = bl;
  wearH = grain;
  float luma = dot(diffuseColor.rgb, toLum);
  wearGlass = luma < 0.09 && up < 0.7 && vSurf < 0.5;
  float k = wearGlass ? 1.0 : grain;
  float blotch = wNoise(q * 0.2) * 0.6 + wNoise(q * 0.9) * 0.4;
  k *= 0.88 + blotch * 0.24;
  if (up < 0.7) {
    float streak = wNoise(vec2(along * 0.32, vWp.y * 0.05));
    k *= 1.0 - smoothstep(0.55, 0.9, streak) * 0.13;
    k *= 0.6 + 0.4 * smoothstep(0.0, 3.2, vWp.y);
  }
  diffuseColor.rgb *= k;
}`;

/* Il rilievo: la grana diventa una piccola deviazione della normale. */
const WEAR_RELIEF = /* glsl */ `
#ifdef WEAR_DETAIL
if (!wearGlass) {
  vec3 sx = dFdx(-vViewPosition);
  vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal);
  vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1);
  vec3 g = sign(det) * (dFdx(wearH) * r1 + dFdy(wearH) * r2) * 0.5;
  normal = normalize(abs(det) * normal - g);
}
#endif`;

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
float n(vec2 p) { return sin(p.x + 0.9 * sin(p.y * 0.63)) * sin(p.y + 0.9 * sin(p.x * 0.71)); }
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
    vec2 uv = (vCell + vec2(p.x, 1.0 - p.y)) / uCells;
    c = texture2D(uAtlas, vec2(uv.x, 1.0 - uv.y)).rgb;
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/* ---------- Il mondo ---------- */
export function createJourney({ canvas, chapters, onProgress, onFocusPrint, onReady, onThanks, onHold }) {
  const timeline = buildTimeline(chapters);
  const { prints, beats, finale, total, distanceAt, end } = timeline;
  const palettes = preparePalettes();
  const skyStops = buildSkyStops(beats, finale, total);
  const isPhone = Math.min(window.innerWidth, window.innerHeight) < 700;
  let peek = null;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isPhone, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isPhone ? 1.6 : 1.75));

  /* Pellicola: alte luci morbide sui materiali. Foto e cielo restano quelli veri. */
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const world = new THREE.Scene();
  world.fog = new THREE.Fog(0xffffff, 70, 330);
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 1200);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 2);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  world.add(hemi, key, key.target);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(isPhone ? 1024 : 3072);
  key.shadow.camera.left = key.shadow.camera.bottom = -170;
  key.shadow.camera.right = key.shadow.camera.top = 170;
  key.shadow.camera.near = 10;
  key.shadow.camera.far = 620;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.5;
  key.shadow.radius = isPhone ? 3 : 6;

  /* Toon a tre toni: il mondo resta un'illustrazione. */
  const ramp = new THREE.DataTexture(new Uint8Array([185, 225, 255]), 3, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  const toon = (hex, extra = {}) => new THREE.MeshToonMaterial({ color: hex, gradientMap: ramp, ...extra });
  const flat = (hex, extra = {}) => new THREE.MeshBasicMaterial({ color: hex, ...extra });
  /* Sul computer i materiali fisici, sul telefono Lambert: stessa resa di base. */
  const surface = ({ roughness = 0.9, ...rest }) => (isPhone ? new THREE.MeshLambertMaterial(rest) : new THREE.MeshStandardMaterial({ roughness, metalness: 0, ...rest }));
  const textures = new THREE.TextureLoader();
  const aniso = Math.min(renderer.capabilities.getMaxAnisotropy(), isPhone ? 4 : 8);
  const scan = (name, color = true) => {
    const t = textures.load(`textures/${name}.jpg`);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    return t;
  };

  /* Cielo */
  const skyUniforms = {
    uTop: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uLow: { value: new THREE.Color() },
    uSun: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 0.3, -1) },
    uStars: { value: 0 },
    uTime: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, depthTest: false })
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  world.add(sky);

  /* Terra e acqua: la terra è una lastra ritagliata sui contorni della mappa,
     l'acqua sta più in basso e si vede dove la lastra manca. */
  const shape = outlines();
  const toVec = ([x, z]) => new THREE.Vector2(x, -z);
  const landGeo = mergeGeometries(
    CITIES.map((c) => {
      const [x0, z0, x1, z1] = c.box;
      const m = 900;
      const outline = c.sea ? shape.lisbonLand.map(toVec) : [[x0 - m, z0 - m], [x1 + m, z0 - m], [x1 + m, z1 + m], [x0 - m, z1 + m]].map(toVec);
      const plate = new THREE.Shape(outline);
      if (c.river) plate.holes.push(new THREE.Path(shape.river.map(toVec)));
      const g = new THREE.ShapeGeometry(plate);
      g.rotateX(-Math.PI / 2);
      g.translate(0, -0.07, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) g.attributes.uv.setXY(i, p.getX(i) / 60, p.getZ(i) / 60);
      return g;
    })
  );
  /* Tra le tappe il mondo è una mappa da navigatore: terra chiara, niente bottoncini. */
  const BASEPLATE = new THREE.Color("#e9e7e1");
  const groundMat = surface({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.95 });
  const ground = new THREE.Mesh(landGeo, groundMat);
  ground.frustumCulled = false;
  ground.receiveShadow = true;
  world.add(ground);

  /* Una fascia tra due linee: argini e spiaggia. */
  function strip(a, b, ya, yb) {
    const pos = [];
    for (let i = 0; i < a.length - 1; i++) {
      const q = [[a[i], ya], [a[i + 1], ya], [b[i], yb], [a[i + 1], ya], [b[i + 1], yb], [b[i], yb]];
      for (const [[x, z], y] of q) pos.push(x, y, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const up = new Float32Array(pos.length);
    for (let i = 1; i < up.length; i += 3) up[i] = 1;
    g.setAttribute("normal", new THREE.BufferAttribute(up, 3));
    const uv = new Float32Array((pos.length / 3) * 2);
    for (let i = 0; i < pos.length / 3; i++) {
      uv[i * 2] = pos[i * 3] / 60;
      uv[i * 2 + 1] = pos[i * 3 + 2] / 60;
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    return g;
  }
  const shift = (line, dz) => line.map(([x, z]) => [x, z + dz]);
  const riverLoop = [...shape.river, shape.river[0]];
  const bankMat = flat("#cbbd9e", { side: THREE.DoubleSide });
  const banks = new THREE.Mesh(
    mergeGeometries([strip(riverLoop, riverLoop, -0.07, -5), ...shape.hard.map((c) => strip(c, c, -0.07, -5))]),
    bankMat
  );
  banks.frustumCulled = false;
  world.add(banks);

  /* Sabbia: un po' sulla terra, poi giù verso l'acqua. */
  const sandMat = surface({ color: "#ecd6a4", side: THREE.DoubleSide });
  const wetMat = flat("#a98a5e", { side: THREE.DoubleSide });
  const sand = new THREE.Mesh(mergeGeometries([strip(shift(shape.sand, -72), shape.sand, -0.03, -0.03), strip(shape.sand, shift(shape.sand, 30), -0.03, -1.6)]), sandMat);
  sand.frustumCulled = false;
  sand.receiveShadow = true;
  world.add(sand);

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
  const sea = { material: seaMat };
  for (const c of CITIES.filter((x) => x.sea || x.river)) {
    const [x0, z0, x1, z1] = c.box;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 1800, z1 - z0 + 1800, 90, 60), seaMat);
    plane.rotation.x = -Math.PI / 2;
    /* Il mare sta poco sotto la terra: più in basso, con la camera raso terra,
       il bordo della lastra lo nasconderebbe. */
    plane.position.set((x0 + x1) / 2, c.sea ? -0.75 : -1.8, (z0 + z1) / 2);
    plane.frustumCulled = false;
    world.add(plane);
  }

  /* La risacca lungo la sabbia. */
  {
    const pts = [];
    const line = shape.sand;
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i];
      const [bx, bz] = line[i + 1];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 7);
      for (let k = 0; k < n; k++) pts.push([lerp(ax, bx, k / n), lerp(az, bz, k / n)]);
    }
    pts.push(line[line.length - 1]);
    const rows = 26;
    const pos = [];
    const ds = [];
    const idx = [];
    pts.forEach(([x, z], i) => {
      for (let r = 0; r < rows; r++) {
        const d = 10 + r * r * 0.18;
        pos.push(x, -0.7, z + d);
        ds.push(d);
        if (i < pts.length - 1 && r < rows - 1) {
          const a = i * rows + r;
          idx.push(a, a + 1, a + rows, a + 1, a + rows + 1, a + rows);
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aD", new THREE.Float32BufferAttribute(ds, 1));
    g.setIndex(idx);
    const surf = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: SURF_VERT, fragmentShader: SURF_FRAG, uniforms: seaMat.uniforms, transparent: true, side: THREE.DoubleSide }));
    surf.frustumCulled = false;
    world.add(surf);
    /* La sabbia bagnata fa da specchio scuro prima dell'acqua. */
    const wet = new THREE.Mesh(strip(shift(shape.sand, 3), shift(shape.sand, 15), -0.17, -0.77), wetMat);
    wet.frustumCulled = false;
    world.add(wet);
  }

  /* La strada: selciato, cordolo di pietra, marciapiede. Sotto l'aula e sui
     ponti il marciapiede sparisce. */
  const along = (offsets, height) => mergeGeometries(legs.map((l) => ribbon(l.start, l.end, 2.5, offsets, height)));
  /* La strada è una piastra liscia grigio scuro, come quelle dei set. */
  const roadMat = surface({ side: THREE.DoubleSide, roughness: 0.8, color: "#bcc2ca" });
  /* Appena sopra le piazze dei luoghi, che arrivano fino a bordo strada. */
  /* Dove il pulmino attraversa un luogo (l'aula) la strada sta sotto il suo pavimento. */
  const inside = (s) => beats.some((b) => b.through && Math.abs(s - b.s) < 36);
  const road = new THREE.Mesh(along([-ROAD_HALF, ROAD_HALF], (o, s) => (inside(s) ? -0.3 : 0.09)), roadMat);
  road.frustumCulled = false;
  road.receiveShadow = true;
  const sunk = (s) => {
    const p = roadPoint(s);
    return !onLand(p.x, p.z, 8) || beats.some((b) => b.through && Math.abs(s - b.s) < 38);
  };
  /* Il marciapiede: piastre chiare coi bottoncini. */
  const walkMat = surface({ side: THREE.DoubleSide, roughness: 0.9, color: "#f6f5f1" });
  const kerbY = (s) => (sunk(s) ? -0.8 : 0.15);
  const walk = new THREE.Mesh(mergeGeometries([along([ROAD_HALF, WALK_HALF], (o, s) => kerbY(s)), along([-WALK_HALF, -ROAD_HALF], (o, s) => kerbY(s))]), walkMat);
  walk.frustumCulled = false;
  walk.receiveShadow = true;
  const paintMat = surface({ color: "#dcdad4", side: THREE.DoubleSide });
  const kerb = new THREE.Mesh(
    mergeGeometries(
      [1, -1].flatMap((e) => [
        along([e * ROAD_HALF, e * ROAD_HALF * 0.999], (o, s) => (inside(s) ? -0.8 : Math.abs(o) > ROAD_HALF * 0.9995 ? kerbY(s) : 0.09)),
        along(e > 0 ? [ROAD_HALF, ROAD_HALF + 0.4] : [-ROAD_HALF - 0.4, -ROAD_HALF], (o, s) => kerbY(s) + 0.01),
      ])
    ),
    paintMat
  );
  kerb.frustumCulled = false;
  kerb.receiveShadow = true;
  world.add(road, walk, kerb);

  /* Una griglia per sapere in fretta se un punto è vicino alla strada o a un
     muro. */
  const CELL = 24;
  const cellOf = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  function grid() {
    const cells = new Map();
    return {
      add(x, z, item) {
        const k = cellOf(x, z);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(item);
      },
      some(x, z, reach, test) {
        const n = Math.ceil(reach / CELL);
        const cx = Math.floor(x / CELL);
        const cz = Math.floor(z / CELL);
        for (let i = -n; i <= n; i++) {
          for (let j = -n; j <= n; j++) {
            const list = cells.get(`${cx + i},${cz + j}`);
            if (list && list.some(test)) return true;
          }
        }
        return false;
      },
    };
  }
  const roadGrid = grid();
  for (const l of legs) {
    for (let i = 0; i < l.xs.length; i += 3) roadGrid.add(l.xs[i], l.zs[i], [l.xs[i], l.zs[i]]);
  }
  const nearRoad = (x, z, r) => roadGrid.some(x, z, r, ([a, b]) => Math.hypot(a - x, b - z) < r);
  const wallGrid = grid();
  const addWall = (x, z, r) => wallGrid.add(x, z, { x, z, r });
  const hitsWall = (x, z, r) => wallGrid.some(x, z, 40, (w) => Math.hypot(w.x - x, w.z - z) < w.r + r);

  /* Paesaggio: istanze ripartite per tratto di strada. */
  const instances = { hill: [], tree: [], trunk: [], pine: [], pineTrunk: [], hedge: [], post: [], car: [], deck: [], vase: [], bloom: [], roof: [], salmon: [], coral: [], ochre: [], rust: [], red: [], brick: [], yellowBrick: [], lisbon: [], lisbonY: [], lisbonB: [] };
  const lampPoints = [];
  const dummy = new THREE.Object3D();
  const rng = mulberry(2026);

  const BUILDINGS = ["salmon", "coral", "ochre", "rust", "red", "brick", "yellowBrick", "lisbon", "lisbonY", "lisbonB"];
  /* Ora che la strada gira, quello che sta di fianco a un tratto può cadere
     sopra un altro tratto, in acqua o dentro un luogo. */
  const free = (x, z, r) => onLand(x, z, r) && !onBeachFront(x, z) && !hitsWall(x, z, r) && !nearRoad(x, z, r + 6) && !beats.some((b) => Math.hypot(b.place[0] - x, b.place[1] - z) < (CLEARING[b.landmark] ?? 58) + r);

  function put(kind, s, offset, y, sx, sy, sz, color, rotY = 0, always = false) {
    const p = roadPoint(s, new THREE.Vector3());
    const d = roadDir(s, new THREE.Vector3());
    const x = p.x - d.z * offset;
    const z = p.z + d.x * offset;
    const isBuilding = BUILDINGS.includes(kind);
    const reach = isBuilding ? Math.max(sx, sz) * 0.62 : kind === "hill" ? sx * 0.7 : Math.max(sx, sz);
    if (isBuilding) {
      /* Una casa sta a filo marciapiede: il controllo guarda la sua pianta. */
      const open = (a, b) => !nearRoad(x + a, z + b, WALK_HALF - 1.2);
      const fx = d.x * sx * 0.45;
      const fz = d.z * sx * 0.45;
      const ox = -d.z * sz * 0.42;
      const oz = d.x * sz * 0.42;
      if (!onLand(x, z, 9) || onBeachFront(x, z) || !open(0, 0) || !open(fx, fz) || !open(-fx, -fz) || !open(ox, oz) || !open(-ox, -oz)) return;
      if (beats.some((b) => Math.hypot(b.place[0] - x, b.place[1] - z) < (CLEARING[b.landmark] ?? 58) + reach * 0.6)) return;
    } else if (always === "street") {
      if (!onLand(x, z, 2) || beats.some((b) => Math.hypot(b.place[0] - x, b.place[1] - z) < (CLEARING[b.landmark] ?? 58) * 0.75)) return;
    } else if (!always && !free(x, z, reach)) return;
    if (isBuilding) addWall(x, z, Math.max(sx, sz) * 0.52);
    dummy.position.set(x, p.y + y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(0, rotY, 0);
    dummy.updateMatrix();
    instances[kind].push({ matrix: dummy.matrix.clone(), color: new THREE.Color(color), s });
  }

  const pick = (list) => list[Math.floor(rng() * list.length)];
  const heading = (s) => {
    const d = roadDir(s, new THREE.Vector3());
    return Math.atan2(-d.x, -d.z);
  };
  /* I luoghi si tengono attorno un po' di vuoto, altrimenti non si vedono. */
  const blocked = (s, side) => beats.some((b) => Math.abs(s - b.s) < (b.through ? 44 : 62) && (b.through || b.side === side));
  const nearStop = (s) => beats.some((b) => Math.abs(s - b.s) < 78);
  const wet = () => false;

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

  function buildings(s0, s1, styles, sides = [1, -1], min = 7.7, every = 19, floors = [18, 26]) {
    for (const side of sides) {
      for (let s = s0; s < s1; s += every) {
        if (blocked(s, side) || beats.some((b) => Math.abs(s - b.s) < 50)) continue;
        const h = floors[0] + rng() * (floors[1] - floors[0]);
        const r = heading(s);
        const before = instances.roof.length;
        const style = pick(styles);
        const total = Object.values(instances).reduce((n, l) => n + l.length, 0);
        /* La facciata guarda la strada da tutti e due i lati. */
        put(style, s, side * (min + 8), h / 2, every + 0.5, h, 16, "#ffffff", r + (side < 0 ? Math.PI : 0));
        if (Object.values(instances).reduce((n, l) => n + l.length, 0) > total && before === instances.roof.length) {
          put("roof", s, side * (min + 8), h + 1.5, every + 1.6, 3, 17.4, pick(["#b5683f", "#a85a35", "#c2734a", "#9c5232"]), r, true);
        }
      }
    }
  }

  function cars(s0, s1, every, sides = [1]) {
    for (let s = s0; s < s1; s += every) {
      const side = pick(sides);
      if (rng() < 0.3 || blocked(s, side) || nearStop(s)) continue;
      put("car", s, side * 3.25, 0.62, 1, 1, 1, pick(["#8b8f94", "#4c5660", "#e9e9ea", "#a33434", "#23272d", "#23305f"]), heading(s), "street");
    }
  }

  function streetLamps(s0, s1, every, sides = [1, -1], offset = 5.1) {
    for (let s = s0; s < s1; s += every * (isPhone ? 1.7 : 1)) {
      for (const side of sides) {
        if (blocked(s, side) || nearStop(s)) continue;
        const before = instances.post.length;
        put("post", s, side * offset, 0, 1, 1, 1, "#1d1f22", 0, "street");
        if (instances.post.length === before) continue;
        const p = roadPoint(s, new THREE.Vector3());
        const d = roadDir(s, new THREE.Vector3());
        lampPoints.push(p.x - d.z * side * offset, p.y + 5.5, p.z + d.x * side * offset);
      }
    }
  }

  /* I vasi di fiori lungo il marciapiede, davanti alle case. */
  function vases(s0, s1, every) {
    for (let s = s0; s < s1; s += every * (isPhone ? 2 : 1)) {
      const side = rng() < 0.5 ? -1 : 1;
      if (blocked(s, side) || nearStop(s)) continue;
      const before = instances.vase.length;
      const o = side * (6.9 + rng() * 0.3);
      put("vase", s, o, 0.15, 1, 1, 1, "#a79f90", 0, "street");
      if (instances.vase.length > before) put("bloom", s, o, 1.36, 0.62, 0.42, 0.62, pick(["#8a5fd0", "#c7a6e0", "#e8588f", "#f2b632"]), rng() * 6, true);
    }
  }

  /* Le case, gli alberi e le auto a mattoncini lungo la strada non ci sono più:
     tra le tappe c'è la mappa del navigatore (navmap.js). */
  for (const c of NAV_MAP ? [] : chapters) {
    const a = c.s0;
    const b = c.s1;
    if (c.scenery === "romeStreet") {
      buildings(a, b, ["salmon", "salmon", "ochre", "brick"]);
      buildings(a, b, ["salmon", "ochre"], [1, -1], 25, 21, [22, 30]);
      cars(a, b, 9, [1, -1]);
      streetLamps(a, b, 26);
      vases(a, b, 15);
      pines(a, b, 17);
    }
    if (c.scenery === "melfi") {
      buildings(a, b, ["coral", "coral", "salmon"], [1], 7.7, 20, [12, 16]);
      /* Dall'altro lato la ferrovia, con la siepe davanti. */
      const ballast = new THREE.Mesh(ribbon(a, b, 5, [-13.5, -9], () => 0.04), flat("#8a8378"));
      const rails = [[-12.4, -12.26], [-10.6, -10.46]].map((o) => new THREE.Mesh(ribbon(a, b, 5, o, () => 0.14), flat("#4e4a46")));
      [ballast, ...rails].forEach((m) => {
        m.frustumCulled = false;
        world.add(m);
      });
      for (let s = a; s < b; s += 2.6) if (!nearStop(s)) put("hedge", s, -8.2 - rng() * 0.6, 0.6, 1.5 + rng(), 0.9 + rng() * 0.8, 1.7, pick(["#5d8a3e", "#4f7d38", "#6c9a46"]));
      for (let s = a; s < b; s += 9) {
        const k = 2 + rng() * 1.6;
        const o = -16 - rng() * 20;
        put("trunk", s, o, 1.2 * k, 0.28 * k, 1.3 * k, 0.28 * k, "#5a4030");
        put("tree", s, o, 3.3 * k, 2 * k, 2 * k, 2 * k, pick(["#3f6e3a", "#35623a", "#4b7d40"]), rng() * 6);
      }
      streetLamps(a, b, 26, [-1], 5.1);
      cars(a, b, 14, [1]);
      hills(a, b, ["#7f9652", "#8ca35a", "#6e8a4e"], 12);
    }
    if (c.scenery === "romeCity") {
      buildings(a, b, ["ochre", "rust", "red", "brick", "yellowBrick", "ochre"]);
      buildings(a, b, ["ochre", "rust", "red"], [1, -1], 25, 21, [24, 34]);
      buildings(a, b, ["ochre", "rust"], [1, -1], 43, 24, [26, 38]);
      cars(a, b, 13, [1, -1]);
      streetLamps(a, b, 24);
      vases(a, b, 13);
      pines(a, b, 21);
    }
    if (c.scenery === "lisbon") {
      buildings(a, b, ["lisbon", "lisbonY", "lisbonB", "lisbon", "yellowBrick"], [1, -1], 7.7, 19, [15, 22]);
      /* Dietro, il resto della città: file di tetti di cotto che salgono. */
      buildings(a, b, ["lisbon", "lisbonY"], [1, -1], 25, 23, [20, 28]);
      buildings(a, b, ["lisbon", "lisbonB"], [1, -1], 43, 27, [24, 34]);
      streetLamps(a, b, 22);
      vases(a, b, 17);
      trees(a, b, ["#6f9c50", "#82a852"], 22);
    }
  }

  const facades = [];
  const facadeMaterial = (style) => {
    const map = facadeTexture(style, !isPhone);
    facades.push([style, map]);
    const side = surface({ map, roughness: 0.86 });
    const top = surface({ color: "#a2603e" });
    return [side, side, top, top, side, side];
  };
  /* L'utilitaria parcheggiata: sagoma estrusa, vetri scuri e ruote. Il colore
     dell'istanza tinge la carrozzeria, i vertici scuriscono il resto. */
  const carShape = (() => {
    const tint = (g, v) => {
      const n = g.toNonIndexed();
      n.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 3).fill(v), 3));
      return n;
    };
    const side = (points, width, bevel) => {
      const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 1 });
      return g.translate(0, 0, -width / 2);
    };
    const body = side([[-1.95, 0.3], [-1.95, 0.75], [-1.75, 0.86], [-1.05, 0.93], [-0.6, 1.42], [0.75, 1.42], [1.35, 0.95], [1.88, 0.86], [1.95, 0.62], [1.95, 0.3]], 1.5, 0.08);
    const glass = side([[-1.02, 0.96], [-0.64, 1.36], [0.78, 1.36], [1.3, 0.98]], 1.69, 0);
    const wheel = (x, z) => new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12).rotateX(Math.PI / 2).translate(x, 0.33, z);
    const hub = (x, z) => new THREE.CylinderGeometry(0.17, 0.17, 0.26, 10).rotateX(Math.PI / 2).translate(x, 0.33, z);
    const lamp = (x, z, w) => new THREE.BoxGeometry(0.06, 0.14, w).translate(x, 0.74, z);
    const parts = [
      tint(body, 1),
      tint(glass, 0.07),
      ...[[-1.25, 0.74], [-1.25, -0.74], [1.22, 0.74], [1.22, -0.74]].flatMap(([x, z]) => [tint(wheel(x, z), 0.05), tint(hub(x, z), 0.55)]),
      tint(lamp(-1.97, 0.55, 0.3), 1.6),
      tint(lamp(-1.97, -0.55, 0.3), 1.6),
      tint(lamp(1.97, 0.58, 0.26), 0.35),
      tint(lamp(1.97, -0.58, 0.26), 0.35),
    ];
    return mergeGeometries(parts).translate(0, -0.62, 0);
  })();
  const lit = () => surface({ color: "#ffffff" });
  /* Le chiome: ciuffi di foglie ritagliate attorno a un cuore scuro. Le
     normali guardano fuori dalla chioma, così la luce la modella come un
     volume solo, e il vento la muove appena. */
  const wind = { value: 0 };
  const leafMap = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const r = mulberry(77);
    for (let i = 0; i < 64; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 82;
      const v = 205 + Math.floor(r() * 50);
      g.save();
      g.translate(112 + Math.cos(a) * d, 112 + Math.sin(a) * d);
      g.rotate(r() * Math.PI);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath();
      g.ellipse(0, 0, 9 + r() * 9, 4 + r() * 5, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    /* Un angolo pieno, per il cuore della chioma. */
    g.fillStyle = "#fff";
    g.fillRect(224, 224, 32, 32);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    return t;
  })();

  /* blobs: [x, y, z, rx, ry, rz]. Ogni palla ha un cuore pieno e perBlob ciuffi. */
  function foliage(blobs, perBlob, size, seed) {
    const r = mulberry(seed);
    const pos = [];
    const nor = [];
    const uv = [];
    const col = [];
    const idx = [];
    let lo = Infinity;
    let hi = -Infinity;
    for (const [, y, , , ry] of blobs) {
      lo = Math.min(lo, y - ry);
      hi = Math.max(hi, y + ry);
    }
    /* Sotto è in ombra, in cima prende il sole. */
    const shade = (y, k) => {
      const v = (0.62 + 0.5 * ((y - lo) / (hi - lo))) * k;
      col.push(v, v, v);
    };
    const at = new THREE.Vector3();
    const n = new THREE.Vector3();
    const t = new THREE.Vector3();
    const b = new THREE.Vector3();
    const out = new THREE.Vector3();
    const ball = new THREE.IcosahedronGeometry(1, 1).attributes.position;
    for (const [x, y, z, rx, ry, rz] of blobs) {
      const first = pos.length / 3;
      for (let i = 0; i < ball.count; i++) {
        n.fromBufferAttribute(ball, i);
        pos.push(x + n.x * rx * 0.66, y + n.y * ry * 0.66, z + n.z * rz * 0.66);
        nor.push(n.x, n.y, n.z);
        uv.push(0.94, 0.06);
        shade(y + n.y * ry * 0.66, 0.62);
        idx.push(first + i);
      }
      for (let i = 0; i < perBlob; i++) {
        const a = r() * Math.PI * 2;
        const h = clamp(r() * 1.75 - 0.75, -1, 1);
        const w = Math.sqrt(1 - h * h);
        n.set(Math.cos(a) * w, h, Math.sin(a) * w);
        at.set(x + n.x * rx * 0.86, y + n.y * ry * 0.86, z + n.z * rz * 0.86);
        t.set(r() - 0.5, r() - 0.5, r() - 0.5).cross(n).normalize();
        b.crossVectors(n, t).addScaledVector(n, (r() - 0.5) * 1.2).normalize();
        out.copy(n).setY(n.y + 0.35).normalize();
        const k = size * (0.75 + r() * 0.5);
        const tone = 0.85 + r() * 0.3;
        const base = pos.length / 3;
        for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const py = at.y + (t.y * u + b.y * v) * k;
          pos.push(at.x + (t.x * u + b.x * v) * k, py, at.z + (t.z * u + b.z * v) * k);
          nor.push(out.x, out.y, out.z);
          uv.push(u > 0 ? 0.86 : 0.02, v > 0 ? 0.98 : 0.15);
          shade(py, tone);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }

  const leafy = () => {
    const m = surface({ map: leafMap, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.95 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = wind;
      shader.vertexShader = "uniform float uWind;\n" + shader.vertexShader.replace("#include <begin_vertex>", /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
        float leafPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.29;
        #else
        float leafPhase = 0.0;
        #endif
        float sway = sin(uWind * 1.3 + leafPhase + position.y * 2.0) * 0.035 + sin(uWind * 2.9 + leafPhase * 1.7 + position.x * 5.0) * 0.012;
        transformed.x += sway;
        transformed.z += sway * 0.6;`);
      /* Il retro di un ciuffo non deve girare la normale: resta quella della chioma. */
      shader.fragmentShader = "#undef DOUBLE_SIDED\n" + shader.fragmentShader;
    };
    return m;
  };
  const leafShadow = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafMap, alphaTest: 0.45, side: THREE.DoubleSide });
  const LEAFY = ["tree", "pine", "hedge"];

  /* Un ramo: un tronchetto da un punto all'altro. */
  const limb = (from, to, r0, r1) => {
    const a = new THREE.Vector3(...from);
    const d = new THREE.Vector3(...to).sub(a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, 5).translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    return g.translate(a.x, a.y, a.z);
  };
  const trunkShape = mergeGeometries([
    new THREE.CylinderGeometry(0.8, 1.25, 2, 7),
    limb([0, 0.45, 0], [2.7, 1.5, 0.9], 0.45, 0.2),
    limb([0, 0.25, 0], [-2.5, 1.45, 1.1], 0.45, 0.2),
    limb([0, 0.6, 0], [0.4, 1.55, -2.7], 0.42, 0.2),
  ]);
  const pineTrunkShape = mergeGeometries([
    new THREE.CylinderGeometry(0.7, 1.05, 2, 7),
    limb([0, 0.5, 0], [7.5, 0.95, 2], 0.5, 0.25),
    limb([0, 0.42, 0], [-7, 0.94, -3], 0.5, 0.25),
    limb([0, 0.6, 0], [1.5, 0.96, 7], 0.45, 0.25),
    limb([0, 0.55, 0], [-2, 0.95, -7], 0.45, 0.25),
  ]);
  const leaves = isPhone ? 0.5 : 1;
  const crown = foliage(
    [[0, 0.1, 0, 0.82], [0.56, -0.12, 0.2, 0.62], [-0.5, -0.05, 0.3, 0.6], [0.12, -0.16, -0.58, 0.62], [-0.2, 0.42, -0.1, 0.56], [0.3, 0.36, 0.28, 0.5]].map(([x, y, z, r]) => [x, y, z, r, r, r]),
    Math.round(30 * leaves), 0.4, 11
  );
  const pineShape = foliage(
    [[0, 0, 0, 4.2], [2.8, -0.5, 1, 3], [-2.6, -0.3, -1, 3.2], [0.6, -0.6, 2.8, 2.8], [-0.8, -0.2, -2.7, 2.9]].map(([x, y, z, r]) => [x, y, z, r, r * 0.42, r]),
    Math.round(44 * leaves), 1.25, 12
  );
  const hedgeShape = foliage([[0, 0, 0, 1, 1, 1]], Math.round(70 * leaves), 0.42, 13);
  /* Il lampione di ghisa a tre lanterne, e il vaso di pietra. */
  const turned = (points, seg = 10) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const lampShape = mergeGeometries(
    [
      turned([[0.3, 0], [0.26, 0.5], [0.13, 0.9], [0.09, 1.4], [0.07, 5.2], [0, 5.2]], 6),
      new THREE.BoxGeometry(1.5, 0.05, 0.05).translate(0, 5.05, 0),
      new THREE.BoxGeometry(0.05, 0.05, 1.5).translate(0, 5.05, 0),
      ...[[0.72, 0], [-0.72, 0], [0, 0.72], [0, -0.72]].map(([x, z]) => turned([[0.09, 0], [0.2, 0.5], [0, 0.72]], 4).translate(x, 5.1, z)),
    ].map((g) => g.toNonIndexed())
  );
  lampShape.deleteAttribute("uv");
  const vaseShape = turned([[0.3, 0], [0.34, 0.08], [0.12, 0.2], [0.12, 0.42], [0.42, 0.7], [0.58, 1.1], [0.62, 1.2], [0.5, 1.2]], 8);
  const shapes = {
    hill: [new THREE.IcosahedronGeometry(1, 2), toon("#ffffff")],
    tree: [crown, leafy()],
    trunk: [trunkShape, lit()],
    pine: [pineShape, leafy()],
    pineTrunk: [pineTrunkShape, lit()],
    hedge: [hedgeShape, leafy()],
    post: [lampShape, lit()],
    vase: [vaseShape, lit()],
    bloom: [new THREE.IcosahedronGeometry(1, 1), toon("#ffffff")],
    roof: [(() => {
      const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
      g.rotateY(Math.PI / 4);
      return g.toNonIndexed();
    })(), lit()],
    car: [carShape, surface({ color: "#ffffff", vertexColors: true, roughness: 0.45 })],
    deck: [new THREE.BoxGeometry(1, 1, 1), lit()],
  };
  for (const style of BUILDINGS) shapes[style] = [new THREE.BoxGeometry(1, 1, 1), facadeMaterial(style)];

  for (const [kind, list] of Object.entries(instances)) if (list.length) legacy(kind, list);

  function legacy(kind, list) {
    const mesh = new THREE.InstancedMesh(shapes[kind][0], shapes[kind][1], list.length);
    list.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      mesh.setColorAt(i, item.color);
    });
    mesh.frustumCulled = false;
    if (!isPhone && (BUILDINGS.includes(kind) || kind === "tree" || kind === "pine" || kind === "trunk" || kind === "pineTrunk" || kind === "post" || kind === "car")) mesh.castShadow = true;
    if (LEAFY.includes(kind)) mesh.customDepthMaterial = leafShadow;
    /* Le case hanno il rilievo vero sopra la facciata dipinta. */
    if (!isPhone && BUILDINGS.includes(kind)) {
      const relief = new THREE.InstancedMesh(facadeRelief(kind, HOUSE_WIDE, HOUSE_DEEP), shapes[kind][1][0], list.length);
      list.forEach((item, i) => relief.setMatrixAt(i, item.matrix));
      relief.frustumCulled = false;
      relief.receiveShadow = true;
      world.add(relief);
    }
    if (!isPhone && (BUILDINGS.includes(kind) || kind === "roof")) mesh.receiveShadow = true;
    world.add(mesh);
  }

  /* Sulle facciate dipinte passa la grana delle scansioni, appena arrivano. */
  const grainOf = (src, styles) => {
    const img = new Image();
    img.onload = () => {
      for (const [style, map] of facades) if (styles(style)) weatherFacade(map, img, style.toLowerCase().includes("brick") ? 0.55 : 0.8);
    };
    img.src = src;
  };
  grainOf("textures/plaster.jpg", (s) => !s.toLowerCase().includes("brick"));
  grainOf("textures/brick.jpg", (s) => s.toLowerCase().includes("brick"));

  /* I luoghi. */
  const vLocal = new THREE.Vector3();
  /* Sopra 1 di proposito: le tinte dei palazzi sono quelle vere, e la luce
     dell'illustrazione da sola le spegnerebbe. */
  const solidMat = surface({ vertexColors: true, side: THREE.DoubleSide, color: new THREE.Color(1.12, 1.12, 1.12) });
  const wearMaps = { uBrick: { value: scan("brick", false) }, uStone: { value: scan("stone", false) }, uPlaster: { value: scan("plaster", false) } };
  if (!isPhone) solidMat.defines = { ...solidMat.defines, WEAR_DETAIL: 1 };
  solidMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wearMaps);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float aSurf;\nvarying float vSurf;\nvarying vec3 vWp;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvSurf = aSurf;\nvWp = (modelMatrix * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n#define BRICK_MEAN 0.439\n#define STONE_MEAN 0.651\n#define PLASTER_MEAN 0.646\n${WEAR_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${WEAR_BODY}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${WEAR_RELIEF}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\nif (wearGlass) roughnessFactor = 0.08;`);
  };
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  for (const b of beats) {
    b.entry = buildLandmark(b.landmark, solidMat, glowMat);
    const g = b.entry.group;
    g.traverse((o) => {
      if (o.isMesh && o.material === solidMat) o.castShadow = o.receiveShadow = true;
    });
    const p = roadPoint(b.s);
    const d = roadDir(b.s);
    const rightX = -d.z;
    const rightZ = d.x;
    g.position.set(p.x + rightX * b.side * b.spec.offset, p.y, p.z + rightZ * b.side * b.spec.offset);
    /* Il +z del luogo guarda la strada; chi si attraversa sta in asse. */
    g.rotation.y = b.through ? Math.atan2(-d.x, -d.z) + Math.PI / 2 : Math.atan2(-rightX * b.side, -rightZ * b.side);
    b.centre = g.position.clone().setY(g.position.y + b.spec.look);
    world.add(g);
    /* Certi luoghi si guardano verso qualcos'altro: la spiaggia verso il forte. */
    if (b.spec.aim) {
      g.updateMatrixWorld(true);
      b.centre.copy(g.localToWorld(new THREE.Vector3(...b.spec.aim)));
    }
    /* I muri del luogo, come una fila di cerchi lungo ogni massa. */
    g.updateMatrixWorld(true);
    for (const m of b.entry.masses) {
      const r = Math.min(m.w, m.d) / 2;
      const n = Math.ceil(Math.max(m.w, m.d) / Math.min(m.w, m.d));
      for (let i = 0; i < n; i++) {
        const k = n > 1 ? i / (n - 1) - 0.5 : 0;
        vLocal.set(m.x + (m.w > m.d ? k * (m.w - m.d) : 0), 0, m.z + (m.d > m.w ? k * (m.d - m.w) : 0));
        g.localToWorld(vLocal);
        addWall(vLocal.x, vLocal.z, r);
      }
    }
  }

  /* La mappa del navigatore: isolati, linea blu, pallino, cartello. */
  const nav = createNavMap({ world, legs, beats, roadPoint, roadDir, onLand, onBeachFront, nearRoad, clearing: CLEARING, isPhone, walkHalf: WALK_HALF });
  const vNav = new THREE.Vector3();

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
  const archLifted = { y: 0 };
  {
    const p = roadPoint(end - 22);
    const d = roadDir(end - 22);
    arch.position.copy(p);
    archLifted.y = p.y;
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
  bus.root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

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
  const MAX_GUESTS = isPhone ? 30 : 60;
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

  /* Sul telefono una foto a fuoco non supera i 600 pixel veri: 800 bastano, e
     con oltre 60 foto la memoria della scheda grafica è il primo limite. */
  function fillPrint(p, image, limit = isPhone ? 800 : 1400) {
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
  /* patience: quanto aspetta la scritta senza foto. Infinity finché al
     traguardo si deve ancora scegliere tra foto e Salta. */
  const party = { value: 0, target: 0, shot: 1, hold: 0, wait: 0, thanks: 0, patience: 7 };

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
    /* Davanti ad Aula Chiesa niente foto in volo: la si vede arrivare. */
    const stop = beats.find((b, i) => i > 0 && !b.through && position > b.u0 - FLIGHT_IN && position < b.u0 + FLIGHT_OUT);
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
    new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false })
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
    /* Sotto la scritta di foto, la dedica in chiaro: le due insieme stanno al
       centro del muro. */
    const note = THANKS.sign ? [...((narrow ? THANKS.noteNarrow : THANKS.note) ?? []), THANKS.sign] : [];
    let size = H;
    g.font = `900 ${size}px ${family}`;
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    size = Math.min((size * W * 0.96) / widest, (H * 0.96 * (note.length ? 0.55 : 1)) / (lines.length * 1.08));
    const noteFont = (s) => `italic 700 ${s}px Georgia, "Times New Roman", serif`;
    let noteSize = 100;
    if (note.length) {
      g.font = noteFont(noteSize);
      const noteWidest = Math.max(...note.map((l) => g.measureText(l).width));
      noteSize = Math.min((noteSize * W * 0.9) / noteWidest, size * 0.34);
    }
    const lead = size * 1.08;
    const noteLead = noteSize * 1.3;
    const gap = note.length ? size * 0.3 : 0;
    const top = (H - (lines.length * lead + gap + note.length * noteLead)) / 2;
    g.font = `900 ${size}px ${family}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = g.strokeStyle = "#2b2622";
    g.lineJoin = "round";
    /* Il contorno ingrossa le lettere: i font sottili non reggerebbero la griglia. */
    g.lineWidth = size * 0.07;
    lines.forEach((l, i) => {
      const y = top + (i + 0.5) * lead;
      g.fillText(l, W / 2, y);
      g.strokeText(l, W / 2, y);
    });
    /* Le caselle si cercano solo nella scritta di foto, prima della dedica. */
    const data = g.getImageData(0, 0, W, H).data;
    if (note.length) {
      g.font = noteFont(noteSize);
      const noteTop = top + lines.length * lead + gap;
      const body = note.slice(0, -1);
      const bodyWidest = Math.max(0, ...body.map((l) => g.measureText(l).width));
      const write = (l, x, y) => g.fillText(l, x, y);
      body.forEach((l, i) => write(l, W / 2, noteTop + (i + 0.5) * noteLead));
      /* La firma va a destra, sotto la fine delle righe. */
      g.textAlign = "right";
      write(note[note.length - 1], W / 2 + bodyWidest / 2, noteTop + (note.length - 0.5) * noteLead);
    }
    plate.material.map?.dispose();
    plate.material.map = new THREE.CanvasTexture(c);
    /* Il canvas è in sRGB: senza dirlo il marrone scuro diventerebbe grigio. */
    plate.material.map.colorSpace = THREE.SRGBColorSpace;
    plate.material.needsUpdate = true;
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
  let shadowTick = 0;
  let shadowExt = 170;
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

  /* Una luce d'ambiente per ogni cielo: i materiali fisici la riflettono. */
  const paved = new THREE.Color("#b5ac98");
  const skyLights = {};
  let skyKey = null;
  function bakeSkyLights() {
    if (isPhone) return;
    const pm = new THREE.PMREMGenerator(renderer);
    const room = new THREE.Scene();
    const dome = new THREE.Mesh(sky.geometry, sky.material);
    dome.frustumCulled = false;
    room.add(dome);
    for (const [name, p] of Object.entries(palettes)) {
      for (const k of SKY_COLORS) mix[k].copy(p[k]);
      for (const k of SKY_NUMBERS) mix[k] = p[k];
      applySky();
      skyLights[name] = pm.fromScene(room, 0.03, 0.1, 100).texture;
    }
    pm.dispose();
  }

  function currentSky(x) {
    let i = 0;
    while (i < skyStops.length - 2 && x >= skyStops[i + 1].u) i += 1;
    const a = skyStops[i];
    const b = skyStops[i + 1];
    const t = b.u > a.u ? smooth(a.u, b.u, x) : 1;
    const A = palettes[a.key];
    const B = palettes[b.key];
    skyKey = t < 0.5 ? a.key : b.key;
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
    groundMat.color.copy(BASEPLATE).lerp(mix.ground, 0.06);
    
    hemi.color.copy(mix.hemi);
    hemi.groundColor.copy(mix.hemiLow);
    hemi.intensity = mix.hemiI * (isPhone ? 0.9 : 0.5);
    if (skyLights[skyKey]) world.environment = skyLights[skyKey];
    key.color.copy(mix.sun);
    key.intensity = mix.keyI;
    lampMat.opacity = mix.lamps;
    lamps.visible = mix.lamps > 0.02;
    glowMat.color.setScalar(0.28 + mix.lamps * 0.85);
    sandMat.color.set("#f0dcae").lerp(mix.low, 0.12);
    wetMat.color.copy(sandMat.color).lerp(mix.mid, 0.45).multiplyScalar(0.72);
        if (sea) {
      const su = sea.material.uniforms;
      su.uSun.value.copy(mix.sun);
      su.uFog.value.copy(mix.low);
      /* Col sole basso il mare smette di essere azzurro e prende il cielo. */
      const low = 1 - smooth(0.03, 0.3, mix.sunEl);
      su.uDeep.value.set("#17609e").lerp(mix.top, 0.45 + low * 0.4);
      su.uShallow.value.set("#4cc0d0").lerp(mix.mid, 0.45 + low * 0.2).lerp(mix.low, low * 0.5);
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
    let s = Math.min(usableW / p.w, usableH / p.h);
    out.copy(camera.position).addScaledVector(camForward, dist).addScaledVector(camUp, hv * 0.05);
    /* Col navigatore la foto si fa più piccola e si sposta: il pallino blu e
       la linea del percorso, in basso al centro, restano scoperti. */
    const k = nav.amount;
    if (k > 0) {
      const narrow = vw / vh < 1;
      const e = k * k * (3 - 2 * k);
      s *= 1 - e * (narrow ? 0.42 : 0.36);
      if (narrow) out.addScaledVector(camUp, hv * 0.17 * e);
      else out.addScaledVector(camRight, hv * (vw / vh) * 0.25 * e).addScaledVector(camUp, hv * 0.06 * e);
    }
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
  }

  /* ---------- I passi ----------
     Le soste del viaggio: la foto a fuoco, il luogo inquadrato, il muro finale.
     place è la posizione tra una sosta e l'altra, want quella chiesta dai tocchi:
     con un tocco alla volta il ritmo è costante, e ogni tocco in più in coda
     accorcia il tratto. */
  const stops = [
    0,
    ...prints.map((p) => p.a + 0.45),
    ...beats.map((b) => (b.u0 + b.u1) / 2),
    total,
  ].sort((a, b) => a - b);
  let place = 0;
  let want = 0;

  const stepAt = (x) => {
    const i = clamp(Math.floor(x), 0, stops.length - 2);
    return lerp(stops[i], stops[i + 1], x - i);
  };

  /* Il pulmino non parte prima della musica: vedi hold() in main.js. */
  let waitingMusic = true;

  function moveSteps(dt) {
    if (waitingMusic) return;
    const left = want - place;
    if (!left) return;
    /* Il tratto verso il finale è il più lungo: gli serve un po' più di tempo. */
    const span = stops[clamp(Math.floor(place), 0, stops.length - 2) + 1] - stops[clamp(Math.floor(place), 0, stops.length - 2)];
    const stretch = span > 3 ? 2.2 : 1;
    const speed = (Math.max(1, Math.abs(left) * 1.6) / (STEP_TIME * stretch)) * dt;
    place += Math.sign(left) * Math.min(Math.abs(left), speed);
    target = stepAt(place);
  }

  function step(by) {
    if (!unlocked || roam.on) return;
    want = clamp(Math.round(want) + by, 0, waitingMusic ? 1 : stops.length - 1);
  }

  /* Ciò che ha un suo comando tiene il suo tocco. */
  const own = (e) => !!e.target.closest?.("button, a, input, iframe, .booth, .lightbox, .roam-map, .roam-pad");
  const press = { id: null, y: 0, moved: false, timer: 0 };
  window.addEventListener("pointerdown", (e) => {
    if (own(e) || roam.on) return;
    press.id = e.pointerId;
    press.y = e.clientY;
    press.moved = false;
    /* Tenuto premuto: la foto a fuoco, ingrandita. */
    press.timer = setTimeout(() => {
      press.moved = true;
      onHold?.();
    }, HOLD_MS);
  });
  window.addEventListener("pointermove", (e) => {
    if (e.pointerId !== press.id) return;
    const dy = press.y - e.clientY;
    if (Math.abs(dy) < SWIPE_PX) return;
    clearTimeout(press.timer);
    press.moved = true;
    press.y = e.clientY;
    step(Math.sign(dy));
  });
  const lift = (e) => {
    if (e.pointerId !== press.id) return;
    clearTimeout(press.timer);
    press.id = null;
    if (!press.moved && e.type === "pointerup") step(1);
  };
  window.addEventListener("pointerup", lift);
  window.addEventListener("pointercancel", lift);

  /* La rotella: uno scatto, un passo, anche se il trackpad manda molti eventi. */
  let wheelSum = 0;
  let wheelAt = 0;
  window.addEventListener("wheel", (e) => {
    const now = performance.now();
    if (now - wheelAt > 180) wheelSum = 0;
    wheelSum += e.deltaY;
    if (Math.abs(wheelSum) >= 40 && now - wheelAt > 70) {
      wheelAt = now;
      step(Math.sign(wheelSum));
      wheelSum = 0;
    }
  }, { passive: true });

  window.addEventListener("keydown", (e) => {
    if (e.target.closest?.("button, input")) return;
    if (["ArrowDown", "ArrowRight", "PageDown", " "].includes(e.key)) {
      e.preventDefault();
      step(1);
    }
    if (["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key)) {
      e.preventDefault();
      step(-1);
    }
  });

  /* ---------- La guida libera ----------
     Si apre solo dopo la scritta: prima il viaggio, in ordine. */
  const roam = { on: false, blend: 0, x: 0, z: 0, h: 0, camH: 0, v: 0, gas: 0, steer: 0, odo: 0, sky: 0, snap: true, turnDone: false };

  function updateRoam(dt) {
    const want = roam.gas > 0 ? roam.gas * DRIVE.top : roam.gas * DRIVE.reverse;
    const rate = roam.gas === 0 ? DRIVE.drag : Math.sign(want) === Math.sign(roam.v) || roam.v === 0 ? DRIVE.accel : DRIVE.brake;
    roam.v += clamp(want - roam.v, -rate * dt, rate * dt);
    /* Si sterza in proporzione alla velocità, e al contrario in retromarcia. */
    roam.h += roam.steer * DRIVE.turn * dt * clamp(roam.v / 12, -1, 1);
    const nx = roam.x + Math.sin(roam.h) * roam.v * dt;
    const nz = roam.z - Math.cos(roam.h) * roam.v * dt;
    /* Sull'acqua si passa solo dai ponti. */
    const ok = (onLand(nx, nz, 3) || nearRoad(nx, nz, 7)) && !hitsWall(nx, nz, 2.4);
    if (ok) {
      roam.x = nx;
      roam.z = nz;
      roam.odo += roam.v * dt;
    } else {
      roam.v *= -0.25;
      jolt = 0.7;
    }
    let diff = roam.h - roam.camH;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    roam.camH += diff * (1 - Math.exp(-dt * 3.4));

    /* Il cielo è quello del luogo più vicino. */
    let near = null;
    let nearD = 340;
    for (const b of beats) {
      const d = Math.hypot(b.place[0] - roam.x, b.place[1] - roam.z);
      if (d < nearD) {
        nearD = d;
        near = b;
      }
    }
    if (near) {
      if (roam.snap) roam.sky = near.u1;
      roam.sky += (near.u1 - roam.sky) * (1 - Math.exp(-dt * 0.9));
      roam.snap = false;
    }
  }

  function placeBus(s) {
    roadPoint(s, vA);
    roadDir(s, vB);
    roam.x = vA.x;
    roam.z = vA.z;
    roam.h = roam.camH = Math.atan2(vB.x, -vB.z);
    roam.v = 0;
  }

  /* ---------- Il fotogramma ---------- */
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = clamp((now - last) / 1000, 0.001, 0.25);
    last = now;
    const t = now / 1000;

    moveSteps(dt);
    /* I passi arrivano a scatti, il pulmino no. */
    const before = u;
    u += (target - u) * (1 - Math.exp(-dt * 5.5));
    if (Math.abs(target - u) < 0.0004) u = target;
    velocity += ((u - before) / dt - velocity) * (1 - Math.exp(-dt * 8));
    const speed = clamp(Math.abs(velocity) / 2.2, 0, 1);

    party.value += (party.target - party.value) * (1 - Math.exp(-dt * 2.2));
    party.shot = Math.min(1, party.shot + dt / 1.9);
    if (selfie.ready && party.shot >= 1) party.hold += dt;
    /* Senza foto la scritta arriva lo stesso: subito dopo Salta, o dopo un
       momento davanti al muro se non c'è niente da scegliere. */
    party.wait = u > total - 0.4 ? party.wait + dt : 0;
    if (party.hold > 2.4 || (!selfie.ready && party.wait > party.patience)) party.thanks = Math.min(1, party.thanks + dt / 4.4);
    roam.blend = clamp(roam.blend + (roam.on ? dt : -dt) / 1.6, 0, 1);
    if (roam.on) updateRoam(dt);

    pointerSmooth.lerp(pointer, 0.07);
    const skyAt = roam.on ? roam.sky : u;
    currentSky(skyAt);
    applySky();
    currentAir(skyAt);

    const s = roam.on ? roam.odo : distanceAt(u);
    if (roam.on) {
      pBus.set(roam.x, 0, roam.z);
      pDir.set(Math.sin(roam.camH), 0, -Math.cos(roam.camH));
    } else {
      roadPoint(s, pBus);
      roadDir(s, pDir);
    }
    pRight.set(-pDir.z, 0, pDir.x).normalize();

    /* Pulmino */
    jolt *= Math.exp(-dt * 5);
    const engine = u < INTRO_UNITS ? 0.012 : 0.02 * (0.4 + speed);
    bus.root.position.copy(pBus);
    bus.root.rotation.y = (roam.on ? Math.atan2(-Math.sin(roam.h), Math.cos(roam.h)) : Math.atan2(-pDir.x, -pDir.z)) + Math.PI / 2;
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
    const stop = roam.on ? null : beats.find((b) => u >= b.u0 && u < b.u1);
    const gap = stop ? (u - stop.u0) / (stop.u1 - stop.u0) : 0;
    const gapShape = stop ? Math.pow(Math.sin(gap * Math.PI), 0.7) : 0;
    /* In tappa la camera sta dalla parte opposta al luogo, con il pulmino
       davanti e il luogo dietro. Dentro l'aula resta in scia, bassa. */
    const orbitSide = stop && !stop.through ? -stop.side : 1;
    const orbit = stop?.through ? 0 : stop?.spec.view?.orbit ?? 1.15;
    const intro = 1 - smooth(0.2, INTRO_UNITS, u);
    let theta = lerp(0.2, 1.38, intro) + orbitSide * gapShape * orbit;
    theta += pointerSmooth.x * 0.05;
    const R = Math.min((lerp(10.5, 9.6, intro) + gapShape * (stop?.through ? -1 : 4.5)) * fit, lerp(40, stop?.through ? 9 : 17, gapShape));
    const height = Math.max(1.5, lerp(3.3, 2.1, intro) - gapShape * 1.4) + pointerSmooth.y * -0.2;
    const view = stop?.spec.view;
    const radius = view ? lerp(R, view.r, gapShape) : R;
    camera.position
      .copy(pBus)
      .addScaledVector(pDir, -Math.cos(theta) * radius)
      .addScaledVector(pRight, Math.sin(theta) * radius);
    camera.position.y = pBus.y + (view ? lerp(height, view.h, gapShape) : height);
    pLook.copy(pBus).addScaledVector(pDir, lerp(4.5, 0, intro));
    pLook.y = pBus.y + lerp(1.8, 1.4, intro);
    if (stop && !stop.through) pLook.lerp(stop.centre, gapShape * (view ? 0.72 : camera.aspect < 1 ? 0.22 : 0.6));
    /* Lontano dalle tappe: il navigatore. Camera alta dietro il pallino blu. */
    const navK = nav.update({ s, u, t, dt, pBus, pDir, active: !roam.on && !stop && u > INTRO_UNITS && u < finale, roaming: roam.on });
    bus.root.visible = navK < 0.5;
    if (navK > 0) {
      const ease = navK * navK * (3 - 2 * navK);
      vNav.copy(pBus).addScaledVector(pDir, camera.aspect < 1 ? -30 : -36).setY(pBus.y + (camera.aspect < 1 ? 46 : 38));
      camera.position.lerp(vNav, ease);
      vNav.copy(pBus).addScaledVector(pDir, 20);
      pLook.lerp(vNav, ease);
    }

    for (const b of beats) {
      const away = Math.hypot(b.place[0] - pBus.x, b.place[1] - pBus.z);
      b.entry.group.visible = away < (isPhone ? 300 : 430);
      /* I luoghi salgono piano dopo piano mentre ci si avvicina, come l'Emma. */
      const grow = 1 - smooth(isPhone ? 170 : 230, isPhone ? 290 : 410, away);
      /* Quelli a mattoncini si montano pezzo per pezzo, gli altri salgono. */
      if (b.entry.setBuild) b.entry.setBuild(grow);
      else b.entry.group.scale.y = Math.max(0.001, easeInOut(grow));
      if (b.entry.mover) {
        const e = b.entry;
        e.mover.position.x = e.moverBase + (roam.on ? Math.sin(t * 0.3) : lerp(-1, 1, clamp((u - b.u0) / (b.u1 - b.u0), 0, 1))) * e.moverRange;
      }
    }

    /* Finale: la camera arretra e guarda il muro di foto. */
    const finaleT = smooth(finale + 0.2, finale + 2.6, u) * (1 - easeInOut(roam.blend));
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
    arch.position.y = archLifted.y + Math.max(finaleT * finaleT, roam.blend) * 34;

    camera.fov = 46 + speed * 9 + gapShape * (stop?.through ? 8 : 12);
    camera.updateProjectionMatrix();
    camera.lookAt(pLook);
    camera.rotateZ(Math.sin(t * 0.4) * 0.006 - clamp(velocity * 0.01, -0.03, 0.03));
    camera.getWorldDirection(camForward);
    camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);

    /* Il sole basso allungherebbe le ombre all'infinito: per loro si ferma più in alto. */
    vC.set(skyLook.x, Math.max(skyLook.y, 0.5), skyLook.z).normalize();
    /* La foschia: in viaggio vicina, come una cartolina; alla tappa e col
       navigatore si allontana, così i luoghi veri tengono colore e contrasto. */
    const clear = Math.max(gapShape * (stop && !stop.through ? 1 : 0.4), navK * 0.6);
    world.fog.near = lerp(70, 210, clear);
    world.fog.far = lerp(330, 900, clear);
    /* Alla tappa meno luce piatta e più sole: i modelli prendono forma. */
    const stopLight = gapShape * (stop && !stop.through ? 1 : 0);
    hemi.intensity *= lerp(1, 0.75, stopLight);
    key.intensity *= lerp(1, 1.3, stopLight);
    seaMat.uniforms.uFogNear.value = world.fog.near;
    seaMat.uniforms.uFogFar.value = world.fog.far;
    /* Alla tappa l'ombra stringe sul luogo: stessa mappa, metà spazio, ombre
       nitide sui modelli veri. In viaggio torna larga intorno al pallino. */
    const shadowStop = stop && !stop.through ? stop : null;
    const wantExt = shadowStop ? Math.max(70, (CLEARING[shadowStop.landmark] ?? 70) + 30) : 170;
    shadowExt += (wantExt - shadowExt) * (1 - Math.exp(-dt * 3));
    if (Math.abs(key.shadow.camera.right - shadowExt) > 0.5) {
      key.shadow.camera.left = key.shadow.camera.bottom = -shadowExt;
      key.shadow.camera.right = key.shadow.camera.top = shadowExt;
      key.shadow.camera.updateProjectionMatrix();
    }
    vNav.copy(pBus);
    if (shadowStop) vNav.lerp(shadowStop.centre, gapShape).setY(pBus.y);
    key.position.copy(vNav).addScaledVector(vC, 300);
    key.target.position.copy(vNav);
    /* Il mondo sta fermo: l'ombra si ricalcola ogni tanto, non a ogni fotogramma. */
    shadowTick = (shadowTick + 1) % (isPhone ? 10 : 4);
    if (!shadowTick) renderer.shadowMap.needsUpdate = true;
    airUniforms.uCamera.value.copy(camera.position);
    airUniforms.uTime.value = t;
    wind.value = t;
    skyUniforms.uTime.value = t;
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
    const thanked = party.thanks >= 1 && u > total - 0.2;
    if (thanked !== roam.turnDone) {
      roam.turnDone = thanked;
      onThanks?.(thanked);
    }

    /* Solo per le prove: la camera dall'alto su un luogo, senza foto. */
    if (peek) {
      const b = beats.find((x) => x.landmark === peek.landmark);
      b.entry.group.updateMatrixWorld(true);
      camera.position.copy(b.entry.group.localToWorld(vLocal.set(...peek.from)));
      camera.lookAt(b.entry.group.localToWorld(vB.set(0, 10, 0)));
      for (const p of prints) p.mesh.visible = false;
      if (world.fog) {
        world.fog.near = 4000;
        world.fog.far = 9000;
      }
    }
    renderer.render(world, camera);
  }

  /* ---------- Avvio ---------- */
  window.addEventListener("resize", resize);
  if (window.matchMedia("(hover: hover)").matches) {
    window.addEventListener("pointermove", (e) => {
      pointer.set((e.clientX / Math.max(vw, 1)) * 2 - 1, (e.clientY / Math.max(vh, 1)) * 2 - 1);
    }, { passive: true });
  }

  resize();
  bakeSkyLights();
  world.environmentIntensity = 0.42;
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
    /* Al traguardo c'è da scegliere: la scritta aspetta la foto o Salta. */
    askForSelfie() {
      party.patience = Infinity;
    },
    skipSelfie() {
      party.patience = 0;
    },
    /* La guida libera. */
    enterRoam() {
      if (roam.on) return;
      placeBus(end);
      roam.sky = beats[beats.length - 1].u1;
      roam.snap = true;
      roam.on = true;
    },
    exitRoam() {
      roam.on = false;
      roam.v = roam.gas = roam.steer = 0;
    },
    drive(gas, steer) {
      roam.gas = gas;
      roam.steer = steer;
    },
    /* Per le prove: guarda un luogo da un punto del suo sistema, o smetti (null). */
    peek(landmark, from = [0, 260, 320]) {
      peek = landmark ? { landmark, from } : null;
    },
    /* Porta il viaggio davanti a un luogo: serve a provarli uno a uno. */
    goTo(landmark) {
      const b = beats.find((x) => x.landmark === landmark);
      if (b) want = stops.indexOf((b.u0 + b.u1) / 2);
    },
    /* Salta davanti a un luogo della mappa. */
    jumpTo(landmark) {
      const b = beats.find((x) => x.landmark === landmark);
      if (!b) return;
      placeBus(b.s - BEAT_ROAD);
      roam.snap = true;
      roam.sky = b.u1;
    },
    get bus() {
      return roam;
    },
    /* La strada, per la cartina. */
    lines() {
      return legs.map((l) => ({ city: l.city, points: l.xs.filter((_, i) => i % 12 === 0).map((x, i) => [x, l.zs[i * 12]]) }));
    },
    /* Il tocco su Play è il primo passo. */
    advance() {
      step(1);
    },
    /* Per le prove: salta a un punto esatto del viaggio, e dice quanto è navigatore. */
    seek(x) {
      waitingMusic = true;
      u = target = x;
    },
    get navAmount() {
      return nav.amount;
    },
    /* Per le prove: quante texture e geometrie stanno nella memoria grafica. */
    get memory() {
      return { ...renderer.info.memory };
    },
    /* Le piante della mappa del navigatore, per la cartina di Esplora. */
    get footprints() {
      return nav.footprints;
    },
    get beatsInfo() {
      return beats.map((b) => ({ landmark: b.landmark, u0: b.u0, u1: b.u1, s: b.s }));
    },
    /* La musica c'è: il pulmino può muoversi. */
    release() {
      waitingMusic = false;
    },
  };
}
